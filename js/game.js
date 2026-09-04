/*
 * game.js
 * 单一游戏状态源 + 完整战斗规则引擎：
 * 回合系统 / AP / 抽牌弃牌 / 伤害 / 状态 / 道具 / 胜负 / 卡牌结算。
 * 纯逻辑模块：不直接操作 DOM（视觉回调通过 Game.visual 注入）。
 */
(function (global) {
  'use strict';

  // 状态机相位
  const PHASE = {
    SELECT: 'character-select', // 角色选择（main.js 处理）
    TURN_START: 'turn-start',   // 回合开始处理中
    OVERFLOW: 'hand-overflow',  // 玩家手牌超限，等待弃牌
    ACTION: 'action',           // 出牌阶段
    TURN_END: 'turn-end',       // 回合结算中
    OVER: 'game-over'
  };

  const ACTOR_KEYS = ['player', 'enemy'];
  const HAND_LIMIT = 5;
  const AP_MAX = 10;
  const LOG_LIMIT = 10;
  // 伤害标度：把「(攻-防)×倍率」放大到与 HP/治疗匹配的量级，保证对局在约 15~20 回合内结束。
  // 只放大伤害量级，不影响公式结构、随机系数、暴击、状态增减伤等全部规则。
  const DMG_SCALE = 3.9;

  // 每回合结束触发的状态效果（game 里按状态 ID 处理，数据定义在 cards.js）
  const END_TURN_EFFECT = {
    dead_pig: 'healPct',
    shelter: 'loseAp',
    dog_fans_siege: 'fixedDmg'
  };

  const state = {
    phase: PHASE.SELECT,
    turnSeq: 0,          // 累计行动次数（用于日志回合数与“本回合刚施加”判定）
    firstActorKey: null, // 先手
    currentActorKey: null,
    winnerKey: null,
    player: null,
    enemy: null,
    logs: [],
    selectedCardIndex: null,
    isProcessing: false,
    pendingOverflowDiscards: 0,
    overflowResume: 'action', // 超限弃牌完成后：'action' | 'endTurn' | 'enterAction'
    abstractInProgress: false, // 抽象化自动行为执行中
    abstractTimer: null,       // 抽象化行为的延时句柄（重开/结束时取消）
    playerAuto: false,         // 自动战斗：玩家侧由 AI 托管
    animSpeed: 1,              // 观战/托管速度倍率（1/2/4）
    simMode: false             // 测试模式：玩家也由 AI 接管
  };

  const visual = {}; // 由 ui.js 注入动画钩子

  // ------------------------------------------------------------------
  // 小工具
  // ------------------------------------------------------------------
  function rand(min, max) { return min + Math.random() * (max - min); }
  function chance(p) { return Math.random() < p; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function otherKey(key) { return key === 'player' ? 'enemy' : 'player'; }
  function currentRound() { return Math.ceil(state.turnSeq / 2); }
  function getCardDef(id) { return CardData.getCard(id); }
  function getStatusDef(id) { return CardData.getStatus(id); }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function refreshUI() {
    if (global.UI && typeof UI.refresh === 'function') UI.refresh();
  }

  function emitVisual(name, payload) {
    if (visual && typeof visual[name] === 'function') {
      try { visual[name](payload); } catch (e) { /* 视觉错误不阻塞逻辑 */ }
    }
  }

  // 日志（最多保留 10 条，新日志在底部）
  function log(msg) {
    state.logs.push('[回合' + currentRound() + '] ' + msg);
    if (state.logs.length > LOG_LIMIT) state.logs.shift();
    emitVisual('log');
  }

  // ------------------------------------------------------------------
  // 角色 / 牌组构造
  // ------------------------------------------------------------------
  function createDeck(characterId) {
    const spec = Characters.CHARACTERS[characterId].deckSpec;
    const deck = [];
    let uid = 0;
    spec.forEach(function (entry) {
      const def = getCardDef(entry.id);
      if (!def) return;
      for (let i = 0; i < entry.count; i++) {
        deck.push({ uid: 'c' + (++uid), def: def, temporaryCostModifier: 0 });
      }
    });
    return deck;
  }

  function randomItems() {
    const ids = Object.keys(Characters.ITEM_DEFS);
    shuffle(ids);
    return ids.slice(0, 2).map(function (id) { return { defId: id }; });
  }

  function createActor(key, characterId) {
    const def = Characters.CHARACTERS[characterId];
    return {
      key: key,
      characterId: characterId,
      name: def.name,
      emoji: def.emoji,
      tagline: def.tagline,
      hp: def.maxHp,
      maxHp: def.maxHp,
      attack: def.attack,
      defense: def.defense,
      speed: def.speed,
      ap: 0,
      maxAp: AP_MAX,
      deck: createDeck(characterId),
      discardPile: [],
      hand: [],
      statuses: [],
      items: randomItems(),
      discardUsedThisTurn: false,
      costReduction: 0
    };
  }

  // ------------------------------------------------------------------
  // 状态工具
  // ------------------------------------------------------------------
  function hasStatus(key, statusId) {
    return state[key].statuses.some(function (s) { return s.id === statusId; });
  }

  function getStatusDuration(key, statusId) {
    const s = state[key].statuses.find(function (x) { return x.id === statusId; });
    return s ? s.duration : 0;
  }

  // 施加状态：同 ID 或同类（攻击/防御增降益）新覆盖旧，不叠加
  function applyStatus(targetKey, statusId, duration) {
    if (state.phase === PHASE.OVER) return false;
    const target = state[targetKey];
    const def = getStatusDef(statusId);
    if (!def) return false;

    const cur = target.statuses.find(function (s) { return s.id === statusId; });
    if (cur) {
      // 刷新持续时间（新覆盖旧）
      cur.duration = (def.untilOwnTurn) ? null : (duration || def.duration || 2);
      cur.appliedAtSeq = state.turnSeq;
      log(target.name + '的「' + def.name + '」刷新为 ' + displayDuration(cur) + ' 回合');
    } else {
      // 同类不叠加：移除同类别旧状态
      if (def.category) {
        target.statuses = target.statuses.filter(function (s) {
          const d = getStatusDef(s.id);
          return !d.category || d.category !== def.category;
        });
      }
      target.statuses.push({
        id: statusId,
        duration: (def.untilOwnTurn) ? null : (duration || def.duration || 2),
        appliedAtSeq: state.turnSeq
      });
      log(target.name + '获得「' + def.name + '」');
    }
    emitVisual('status', { key: targetKey, statusId: statusId });
    checkDeath();
    refreshUI();
    return true;
  }

  function displayDuration(st) {
    return st.duration === null || st.duration === undefined ? '' : st.duration;
  }

  function removeStatus(key, statusId, silent) {
    const target = state[key];
    const idx = target.statuses.findIndex(function (s) { return s.id === statusId; });
    if (idx < 0) return false;
    const def = getStatusDef(statusId);
    target.statuses.splice(idx, 1);
    if (!silent) log(target.name + '的「' + def.name + '」效果结束');
    refreshUI();
    return true;
  }

  // 实时属性：基础值 × 状态倍率乘积
  function statModifier(target, statName) {
    let m = 1;
    target.statuses.forEach(function (s) {
      const def = getStatusDef(s.id);
      if (def && def.mods && def.mods[statName]) m *= def.mods[statName];
    });
    return m;
  }

  function currentAttack(key) { return Math.round(state[key].attack * statModifier(state[key], 'attack')); }
  function currentDefense(key) { return Math.round(state[key].defense * statModifier(state[key], 'defense')); }

  // 目标受到的伤害总倍率（增伤/减伤叠加后统一应用）
  function incomingDamageMultiplier(key) {
    let m = 1;
    state[key].statuses.forEach(function (s) {
      const def = getStatusDef(s.id);
      if (def && def.mods && def.mods.incoming) m *= def.mods.incoming;
    });
    return m;
  }

  // ------------------------------------------------------------------
  // AP
  // ------------------------------------------------------------------
  function gainAp(key, amount) {
    const actor = state[key];
    const before = actor.ap;
    actor.ap = clamp(actor.ap + amount, 0, AP_MAX);
    const gained = actor.ap - before;
    if (gained > 0) log(actor.name + '获得 ' + gained + ' AP');
    emitVisual('ap', { key: key });
    refreshUI();
    return gained;
  }

  function loseAp(key, amount) {
    const actor = state[key];
    const before = actor.ap;
    actor.ap = clamp(actor.ap - amount, 0, AP_MAX);
    const lost = before - actor.ap;
    if (lost > 0) log(actor.name + '失去 ' + lost + ' AP');
    emitVisual('ap', { key: key });
    refreshUI();
    return lost;
  }

  // ------------------------------------------------------------------
  // 抽牌 / 弃牌
  // ------------------------------------------------------------------
  function drawOne(key, silent) {
    const actor = state[key];
    if (actor.deck.length === 0) {
      if (actor.discardPile.length === 0) {
        if (!silent) log(actor.name + '牌组与弃牌堆均为空，无法抽牌');
        return null;
      }
      actor.deck = shuffle(actor.discardPile);
      actor.discardPile = [];
      if (!silent) log(actor.name + '的弃牌堆洗回牌组（' + actor.deck.length + ' 张）');
    }
    const card = actor.deck.pop();
    actor.hand.push(card);
    if (!silent) log(actor.name + '抽到「' + card.def.name + '」');
    return card;
  }

  // 抽 n 张，随后处理手牌上限
  function drawCards(key, n) {
    const actor = state[key];
    const before = actor.hand.length;
    for (let i = 0; i < n; i++) {
      if (state.phase === PHASE.OVER) return;
      drawOne(key, false);
    }
    if (actor.hand.length > before) {
      emitVisual('draw', { key: key });
      refreshUI();
    }
    enforceHandLimit(key);
  }

  // 手牌上限处理：>5 时 AI/抽象化自动弃掉费用最高的牌；玩家进入选择界面
  function enforceHandLimit(key) {
    const actor = state[key];
    const over = actor.hand.length - HAND_LIMIT;
    if (over <= 0) return;

    if (key === 'player' && !state.simMode && !state.playerAuto && !state.abstractInProgress &&
        (state.phase === PHASE.ACTION || state.phase === PHASE.TURN_START)) {
      // 玩家手动选择弃牌
      state.phase = PHASE.OVERFLOW;
      state.pendingOverflowDiscards = over;
      state.overflowResume = state.overflowResume || 'enterAction';
      state.isProcessing = true;
      emitVisual('overflow', { key: key });
      refreshUI();
      return;
    }
    // AI / 抽象化 / 测试模式：自动弃掉最高费用（同费随机）
    for (let i = 0; i < over; i++) {
      autoDiscardHighest(key);
    }
    refreshUI();
  }

  function autoDiscardHighest(key) {
    const actor = state[key];
    if (actor.hand.length === 0) return;
    let worstCost = -1;
    for (let i = 1; i < actor.hand.length; i++) {
      const c = calculateCardCost(key, actor.hand[i]);
      if (c > worstCost) worstCost = c;
    }
    // 费用相同时随机选择其中一张
    const ties = [];
    actor.hand.forEach(function (card, i) {
      if (calculateCardCost(key, card) === worstCost) ties.push(i);
    });
    const pick = ties[Math.floor(Math.random() * ties.length)];
    discardCardAt(key, pick, '手牌超出上限，自动弃掉「' + actor.hand[pick].def.name + '」');
  }

  function discardCardAt(key, handIndex, logMsg) {
    const actor = state[key];
    if (handIndex < 0 || handIndex >= actor.hand.length) return;
    const card = actor.hand.splice(handIndex, 1)[0];
    actor.discardPile.push(card);
    if (logMsg) log(logMsg);
    refreshUI();
  }

  // 强制随机弃掉对方一张手牌（狗粉丝召唤）
  function forceDiscardRandom(key) {
    const actor = state[key];
    if (actor.hand.length === 0) return false;
    const i = Math.floor(Math.random() * actor.hand.length);
    const card = actor.hand[i];
    discardCardAt(key, i, '狗粉丝迫使' + actor.name + '弃掉手牌「' + card.def.name + '」');
    return true;
  }

  // 真实费用 = max(0, 基础费用 + 临时修正 - 本回合费用减免)
  function calculateCardCost(key, card) {
    const actor = state[key];
    const base = card.def.cost;
    const mod = card.temporaryCostModifier || 0;
    return Math.max(0, base + mod - actor.costReduction);
  }

  // ------------------------------------------------------------------
  // 伤害 / 治疗 / 胜负
  // ------------------------------------------------------------------
  function isOver() { return state.phase === PHASE.OVER; }

  // 物理伤害：攻击方当前攻击 - 防守方当前防御，乘倍率与随机系数
  function dealPhysical(atkKey, defKey, mult, opts) {
    if (isOver()) return 0;
    opts = opts || {};
    const atk = currentAttack(atkKey);
    const def = currentDefense(defKey);
    const randomCoef = rand(0.9, 1.1);
    let raw = (atk - def) * mult * randomCoef * DMG_SCALE;

    // 状态倍率：先增伤/减伤，再考虑暴击
    const incoming = incomingDamageMultiplier(defKey);
    const crit = chance(0.05); // 基础暴击率 5%
    let damage = raw * incoming * (crit ? 1.5 : 1);
    damage = Math.max(1, Math.floor(damage));

    if (crit) {
      log('💥 暴击！' + state[atkKey].name + '对' + state[defKey].name + '造成 ' + damage + ' 点伤害');
      if (opts.critDraw) {
        log(state[atkKey].name + '因暴击额外抽 1 张牌');
        drawCards(atkKey, 1);
      }
    } else {
      log(state[atkKey].name + '对' + state[defKey].name + '造成 ' + damage + ' 点伤害');
    }

    emitVisual('attack', { key: atkKey });
    emitVisual('damage', { key: defKey, amount: damage, crit: crit });
    state[defKey].hp -= damage;
    checkDeath();
    refreshUI();
    return damage;
  }

  // 固定伤害：无视攻防
  function fixedDamage(key, amount) {
    if (isOver()) return 0;
    const actor = state[key];
    actor.hp -= amount;
    log(actor.name + '受到 ' + amount + ' 点固定伤害');
    emitVisual('damage', { key: key, amount: amount });
    checkDeath();
    refreshUI();
    return amount;
  }

  // 治疗：按最大 HP 比例（向下取整），不超过最大 HP
  function healPct(key, pct) {
    if (isOver()) return 0;
    const actor = state[key];
    const amount = Math.min(Math.floor(actor.maxHp * pct), actor.maxHp - actor.hp);
    if (amount > 0) {
      actor.hp += amount;
      log(actor.name + '恢复 ' + amount + ' HP');
      emitVisual('heal', { key: key, amount: amount });
    } else {
      log(actor.name + '生命值已满，治疗无效');
    }
    checkDeath();
    refreshUI();
    return amount;
  }

  function checkDeath() {
    if (isOver()) return;
    if (state.player.hp <= 0) {
      endGame('enemy');
    } else if (state.enemy.hp <= 0) {
      endGame('player');
    }
  }

  // ------------------------------------------------------------------
  // 卡牌打出（玩家 / AI / 抽象化共用）
  // ------------------------------------------------------------------
  function attemptPlayCard(key, handIndex) {
    if (isOver()) return { ok: false, reason: 'over' };
    if (state.phase !== PHASE.ACTION) return { ok: false, reason: 'phase' };
    if (key !== state.currentActorKey) return { ok: false, reason: 'not-your-turn' };

    const actor = state[key];
    if (handIndex < 0 || handIndex >= actor.hand.length) return { ok: false, reason: 'index' };
    const card = actor.hand[handIndex];
    const actualCost = calculateCardCost(key, card);

    // 台湾有事：技能牌 25% 使用失败（不扣 AP、不移除卡牌）
    if (card.def.type === 'skill' && hasStatus(key, 'taiwan_issue')) {
      if (chance(0.25)) {
        log('「台湾有事」生效：' + actor.name + '使用技能牌「' + card.def.name + '」失败');
        emitVisual('statusBlock', { key: key });
        refreshUI();
        return { ok: false, reason: 'taiwan-blocked' };
      }
    }

    if (actor.ap < actualCost) {
      log(actor.name + 'AP 不足，无法使用「' + card.def.name + '」');
      return { ok: false, reason: 'ap' };
    }

    // 支付 → 移出手牌 → 进入弃牌堆
    actor.ap -= actualCost;
    if (actualCost > 0) log(actor.name + '消耗 ' + actualCost + ' AP');
    log(actor.name + '打出「' + card.def.name + '」');
    actor.hand.splice(handIndex, 1);
    actor.discardPile.push(card);

    emitVisual('playCard', { key: key, card: card });
    refreshUI();

    // 立即执行卡牌效果（伤害→状态→治疗/AP→检查死亡）
    try {
      card.def.effect(GameApi, key);
    } catch (e) {
      log('卡牌「' + card.def.name + '」结算出错：' + e.message);
    }

    if (isOver()) return { ok: true, card: card };

    // 抽牌可能造成手牌超限（玩家暂停选择，结束后按 overflowResume 继续）
    if (state.phase === PHASE.OVERFLOW) {
      state.overflowResume = card.def.forceEndTurn ? 'endTurn' : 'action';
      return { ok: true, card: card, suspended: true };
    }

    // 防御牌：立即结束当前回合
    if (card.def.forceEndTurn) {
      log(actor.name + '使用了防御牌，立即结束回合');
      endTurn(key);
      return { ok: true, card: card, endedTurn: true };
    }

    refreshUI();
    return { ok: true, card: card };
  }

  // ------------------------------------------------------------------
  // 回合流程
  // ------------------------------------------------------------------
  function startBattle(playerCharId, opts) {
    opts = opts || {};
    const enemyCharId = playerCharId === 'sun_xiaochuan' ? 'takaichi_sanae' : 'sun_xiaochuan';
    state.player = createActor('player', playerCharId);
    state.enemy = createActor('enemy', enemyCharId);
    state.logs = [];
    state.turnSeq = 0;
    state.winnerKey = null;
    state.selectedCardIndex = null;
    state.pendingOverflowDiscards = 0;
    state.isProcessing = false;
    state.abstractInProgress = false;
    if (state.abstractTimer) clearTimeout(state.abstractTimer);
    state.abstractTimer = null;
    state.playerAuto = !!opts.auto;
    state.animSpeed = Math.max(1, opts.speed || 1);
    state.phase = PHASE.TURN_START;

    log('战斗开始！' + state.player.name + ' VS ' + state.enemy.name);

    // 先手：速度高者先行动；相同则玩家先手
    const pSpeed = state.player.speed, eSpeed = state.enemy.speed;
    state.firstActorKey = pSpeed > eSpeed ? 'player' : (eSpeed > pSpeed ? 'enemy' : 'player');
    log((state.firstActorKey === 'player' ? state.player.name : state.enemy.name) +
        ' 速度更高，获得先手');

    // 洗牌 + 起始抽 3 张
    shuffle(state.player.deck);
    shuffle(state.enemy.deck);
    drawCards('player', 3);
    drawCards('enemy', 3);

    emitVisual('battleStart');
    startTurn(state.firstActorKey);
  }

  function startTurn(key) {
    if (isOver()) return;
    state.phase = PHASE.TURN_START;
    state.currentActorKey = key;
    state.turnSeq += 1;
    state.selectedCardIndex = null;
    state.overflowResume = 'enterAction';

    const actor = state[key];
    // 重置本回合临时数据
    actor.discardUsedThisTurn = false;
    actor.costReduction = 0;

    log('------ ' + actor.name + ' 的回合开始（第 ' + currentRound() + ' 回合）------');
    emitVisual('turn', { key: key, round: currentRound() });

    // 处理回合开始状态：防御状态在角色自己下一回合开始时移除
    const toRemove = actor.statuses.filter(function (s) {
      const def = getStatusDef(s.id);
      return def && def.untilOwnTurn;
    });
    toRemove.forEach(function (s) {
      const def = getStatusDef(s.id);
      actor.statuses = actor.statuses.filter(function (x) { return x.id !== s.id; });
      log(actor.name + '的「' + def.name + '」在回合开始时消失');
    });
    refreshUI();

    // 获得 AP：+3；增税负担额外 -1（最低获得 0）
    let apGain = 3;
    const taxed = hasStatus(key, 'tax_burden');
    if (taxed) apGain -= 1;
    apGain = Math.max(0, apGain);
    actor.ap = clamp(actor.ap + apGain, 0, AP_MAX);
    log(actor.name + '获得 ' + apGain + ' AP' + (taxed ? '（增税负担 -1）' : ''));
    refreshUI();

    // 抽 2 张
    drawCards(key, 2);

    if (isOver()) return;
    if (state.phase === PHASE.OVERFLOW) {
      // 玩家需要先弃牌（UI 完成后调用 onOverflowDone）
      return;
    }
    enterActionPhase(key);
  }

  function enterActionPhase(key) {
    if (isOver()) return;
    state.phase = PHASE.ACTION;
    state.currentActorKey = key;
    refreshUI();

    // 抽象化：进入出牌阶段时自动执行随机行为，玩家/AI 均不可手动操作
    if (hasStatus(key, 'abstract')) {
      runAbstractTurn(key);
      return;
    }

    // 敌人 / 测试模式 / 玩家自动托管 → 全部交给 AI
    if (key === 'enemy' || state.simMode || (key === 'player' && state.playerAuto)) {
      runAITurn(key);
      return;
    }

    // 玩家手动回合
    state.isProcessing = false;
    refreshUI();
  }

  // 让 AI 托管一个真人角色的当前回合（带异常兜底）
  function runAITurn(key) {
    if (isOver()) return;
    state.isProcessing = true;
    refreshUI();
    if (global.AI && typeof AI.startTurn === 'function') {
      AI.startTurn(key).then(
        function () {
          state.isProcessing = false;
          refreshUI();
        },
        function () {
          // 兜底：即使 AI 异常也不能让回合卡死
          state.isProcessing = false;
          if (state.phase === PHASE.ACTION && state.currentActorKey === key && !isOver()) {
            endTurn(key);
          }
          refreshUI();
        }
      );
    } else {
      state.isProcessing = false;
      endTurn(key);
    }
  }

  // 开关玩家托管；开启时若正处于玩家行动阶段则立即接管
  function setPlayerAuto(on) {
    state.playerAuto = !!on;
    if (on && !state.simMode &&
        state.phase === PHASE.ACTION &&
        state.currentActorKey === 'player' &&
        !state.isProcessing && !isOver()) {
      runAITurn('player');
      return;
    }
    refreshUI();
  }

  // ------------------------------------------------------------------
  // 抽象化自动行为：50% 随机打出一张可用牌 / 30% 自伤 / 20% 跳过
  // ------------------------------------------------------------------
  function runAbstractTurn(key) {
    state.abstractInProgress = true;
    state.isProcessing = true;
    const actor = state[key];
    log('🌀 ' + actor.name + '陷入「抽象化」，无法正常操作！');
    refreshUI();

    const roll = Math.random();
    const act = roll < 0.5 ? 'play' : (roll < 0.8 ? 'self-damage' : 'skip');

    // 用 setTimeout 拆帧，避免阻塞太长（逻辑本身同步）
    state.abstractTimer = setTimeout(function () {
      state.abstractTimer = null;
      if (act === 'play') {
        const affordable = actor.hand
          .map(function (card, i) { return { card: card, i: i, cost: calculateCardCost(key, card) }; })
          .filter(function (x) { return x.cost <= actor.ap; });
        if (affordable.length === 0) {
          log(actor.name + '没有可用卡牌，跳过出牌');
        } else {
          const pick = affordable[Math.floor(Math.random() * affordable.length)];
          log('🎲 ' + actor.name + '随机自动打出「' + pick.card.def.name + '」');
          attemptPlayCard(key, pick.i);
        }
      } else if (act === 'self-damage') {
        log('🌀 抽象化发作：' + actor.name + '对自己造成 0.5 倍物理伤害');
        dealPhysical(key, key, 0.5);
      } else {
        log('🌀 抽象化发作：' + actor.name + '本次跳过出牌阶段');
      }

      state.abstractInProgress = false;
      if (!isOver() && state.phase === PHASE.ACTION && state.currentActorKey === key) {
        endTurn(key);
      } else if (!isOver()) {
        refreshUI();
      }
      state.isProcessing = false;
      refreshUI();
    }, state.simMode ? 0 : Math.max(60, Math.round(350 / Math.max(1, state.animSpeed))));
  }

  // 结束当前角色的回合
  function endTurn(key) {
    if (isOver()) return;
    if (state.phase !== PHASE.ACTION) return;
    if (key !== state.currentActorKey) return;
    state.phase = PHASE.TURN_END;
    const actor = state[key];

    log('------ ' + actor.name + ' 的回合结束 ------');

    // 回合结束状态：
    // 1) 拥有者自己的常规状态持续时间 -1（本回合刚施加的不减）
    // 2) 跨回合结束效果（死猪回复 / 庇护失AP / 狗粉丝围攻伤害）
    const endSeq = state.turnSeq;
    const own = state[key];
    own.statuses = own.statuses.filter(function (s) {
      const def = getStatusDef(s.id);
      if (def.untilOwnTurn) return true; // 防御状态在回合开始处理
      if (s.appliedAtSeq === endSeq) return true; // 本回合刚施加
      s.duration -= 1;
      if (s.duration <= 0) {
        log(own.name + '的「' + def.name + '」效果结束');
        return false;
      }
      return true;
    });

    // 双方状态每回合结束效果（跳过本回合刚施加的状态）
    ACTOR_KEYS.forEach(function (k) {
      const t = state[k];
      t.statuses.slice().forEach(function (s) {
        if (s.appliedAtSeq === endSeq) return;
        const def = getStatusDef(s.id);
        if (!def || !def.endTurn) return;
        const eff = END_TURN_EFFECT[s.id];
        if (!eff) return;
        if (def.endTurn.healPct) {
          healPct(k, def.endTurn.healPct);
        } else if (def.endTurn.loseAp) {
          loseAp(k, def.endTurn.loseAp);
        } else if (def.endTurn.fixedDmg) {
          fixedDamage(k, def.endTurn.fixedDmg);
        }
      });
    });

    if (isOver()) return;

    // 清理本回合临时数据
    actor.costReduction = 0;
    actor.discardUsedThisTurn = false;
    ACTOR_KEYS.forEach(function (k) {
      state[k].hand.forEach(function (c) { c.temporaryCostModifier = 0; });
    });

    // 检查死亡 → 切换角色
    checkDeath();
    if (isOver()) return;

    const next = otherKey(key);
    if (next === state.firstActorKey && !(state.turnSeq % 2 === 0)) {
      // 回到先手方时即进入新的一轮（round 由 turnSeq 计算）
    }
    refreshUI();
    startTurn(next);
  }

  // 玩家主动结束回合
  function playerEndTurn() {
    if (state.currentActorKey !== 'player') return;
    if (state.phase !== PHASE.ACTION) return;
    endTurn('player');
  }

  // ------------------------------------------------------------------
  // 弃牌换 AP（每回合一次）
  // ------------------------------------------------------------------
  function playerDiscardForAp(handIndex) {
    const actor = state.player;
    if (state.currentActorKey !== 'player' || state.phase !== PHASE.ACTION) return { ok: false };
    if (actor.discardUsedThisTurn) return { ok: false, reason: 'used' };
    if (actor.hand.length === 0) return { ok: false, reason: 'empty' };
    if (handIndex < 0 || handIndex >= actor.hand.length) return { ok: false, reason: 'index' };
    discardCardAt('player', handIndex, '弃牌换 AP：弃掉「' + actor.hand[handIndex].def.name + '」');
    actor.discardUsedThisTurn = true;
    gainAp('player', 1);
    refreshUI();
    return { ok: true };
  }

  function aiDiscardForAp(key, handIndex) {
    const actor = state[key];
    if (actor.discardUsedThisTurn) return { ok: false, reason: 'used' };
    if (actor.hand.length === 0) return { ok: false, reason: 'empty' };
    const i = (handIndex === undefined || handIndex === null)
      ? Math.floor(Math.random() * actor.hand.length)
      : handIndex;
    discardCardAt(key, i, '弃牌换 AP：弃掉「' + actor.hand[i].def.name + '」');
    actor.discardUsedThisTurn = true;
    gainAp(key, 1);
    refreshUI();
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // 道具
  // ------------------------------------------------------------------
  function useItem(key, itemIndex) {
    if (isOver()) return { ok: false, reason: 'over' };
    if (state.phase !== PHASE.ACTION || key !== state.currentActorKey) {
      return { ok: false, reason: 'phase' };
    }
    const actor = state[key];
    if (hasStatus(key, 'dog_fans_siege')) {
      log('「狗粉丝围攻」下无法使用道具');
      return { ok: false, reason: 'siege' };
    }
    if (itemIndex < 0 || itemIndex >= actor.items.length) return { ok: false, reason: 'index' };
    const item = actor.items[itemIndex];
    const def = Characters.ITEM_DEFS[item.defId];
    log(actor.name + '使用道具「' + def.name + '」');

    if (item.defId === 'red_packet') {
      healPct(key, 0.3);
    } else if (item.defId === 'purify_spray') {
      const removed = actor.statuses.filter(function (s) {
        const d = getStatusDef(s.id);
        return d && d.kind === 'negative';
      });
      removed.forEach(function (s) {
        const d = getStatusDef(s.id);
        actor.statuses = actor.statuses.filter(function (x) { return x.id !== s.id; });
        log(actor.name + '的「' + d.name + '」被净化');
      });
      if (removed.length === 0) log('没有可净化的负面状态');
      refreshUI();
    } else if (item.defId === 'energy_coffee') {
      gainAp(key, 2);
    }

    actor.items.splice(itemIndex, 1);
    emitVisual('item', { key: key });
    refreshUI();

    if (isOver()) return { ok: true, item: item };
    // 使用道具后立即结束当前回合
    log(actor.name + '使用道具后结束回合');
    endTurn(key);
    return { ok: true, item: item, endedTurn: true };
  }

  // ------------------------------------------------------------------
  // 玩家操作入口（UI 调用）
  // ------------------------------------------------------------------
  function playerSelectCard(index) {
    if (state.currentActorKey !== 'player' || state.phase !== PHASE.ACTION) return;
    if (index === state.selectedCardIndex) {
      // 再次点击已选择卡牌 = 直接尝试出牌
      playerPlaySelected();
      return;
    }
    state.selectedCardIndex = index;
    refreshUI();
  }

  function playerPlaySelected() {
    if (state.currentActorKey !== 'player') return;
    const i = state.selectedCardIndex;
    if (i === null || i < 0) return;
    const result = attemptPlayCard('player', i);
    if (result.ok) {
      state.selectedCardIndex = null;
      refreshUI();
    } else if (result.reason === 'ap') {
      emitVisual('toast', { text: 'AP 不足，无法出牌' });
    }
  }

  // 手牌超限弃牌完成后继续
  function onOverflowDone() {
    if (state.phase !== PHASE.OVERFLOW) return;
    state.pendingOverflowDiscards = 0;
    state.isProcessing = false;
    const resume = state.overflowResume;
    state.overflowResume = 'enterAction';
    if (resume === 'endTurn') {
      state.phase = PHASE.ACTION;
      endTurn(state.currentActorKey);
    } else if (resume === 'enterAction') {
      enterActionPhase(state.currentActorKey);
    } else {
      state.phase = PHASE.ACTION;
      if (state.playerAuto && !state.simMode && !isOver()) {
        runAITurn(state.currentActorKey); // 托管中：弃牌完成后继续自动出牌
      } else {
        refreshUI();
      }
    }
  }

  // ------------------------------------------------------------------
  // 胜负
  // ------------------------------------------------------------------
  function endGame(winnerKey) {
    if (state.phase === PHASE.OVER) return;
    state.phase = PHASE.OVER;
    state.winnerKey = winnerKey;
    state.isProcessing = true;
    const winner = state[winnerKey];
    const loser = state[otherKey(winnerKey)];
    log('🎉 ' + winner.name + ' 获胜！' + loser.name + ' HP 归零。');
    if (state.abstractTimer) clearTimeout(state.abstractTimer);
    state.abstractTimer = null;
    emitVisual('gameOver', { winnerKey: winnerKey });
  }

  function restart() {
    state.phase = PHASE.SELECT;
    state.player = null;
    state.enemy = null;
    state.logs = [];
    state.turnSeq = 0;
    state.currentActorKey = null;
    state.firstActorKey = null;
    state.winnerKey = null;
    state.selectedCardIndex = null;
    state.pendingOverflowDiscards = 0;
    state.isProcessing = false;
    state.abstractInProgress = false;
    if (state.abstractTimer) clearTimeout(state.abstractTimer);
    state.abstractTimer = null;
    state.playerAuto = false;
    state.animSpeed = 1;
  }

  // 公开 API（卡片效果通过 GameApi 访问结算函数）
  const GameApi = {
    state: state,
    visual: visual,

    // 工具
    PHASE: PHASE,
    HAND_LIMIT: HAND_LIMIT,
    AP_MAX: AP_MAX,
    isOver: isOver,
    otherKey: otherKey,
    foeKey: otherKey,
    log: log,
    chance: chance,
    rand: rand,
    shuffle: shuffle,
    currentRound: currentRound,
    refreshUI: refreshUI,

    // 角色 / 状态
    hasStatus: hasStatus,
    getStatusDuration: getStatusDuration,
    applyStatus: applyStatus,
    removeStatus: removeStatus,
    getStatusDef: getStatusDef,
    currentAttack: currentAttack,
    currentDefense: currentDefense,
    incomingDamageMultiplier: incomingDamageMultiplier,
    getCardDef: getCardDef,

    // AP / 抽弃牌 / 伤害治疗
    gainAp: gainAp,
    loseAp: loseAp,
    drawCards: drawCards,
    drawOne: drawOne,
    discardCardAt: discardCardAt,
    forceDiscardRandom: forceDiscardRandom,
    calculateCardCost: calculateCardCost,
    dealPhysical: dealPhysical,
    fixedDamage: fixedDamage,
    healPct: healPct,

    // 回合流程
    startBattle: startBattle,
    startTurn: startTurn,
    endTurn: endTurn,
    playerEndTurn: playerEndTurn,
    playerSelectCard: playerSelectCard,
    playerPlaySelected: playerPlaySelected,
    attemptPlayCard: attemptPlayCard,
    setPlayerAuto: setPlayerAuto,
    playerDiscardForAp: playerDiscardForAp,
    aiDiscardForAp: aiDiscardForAp,
    useItem: useItem,
    onOverflowDone: onOverflowDone,
    checkDeath: checkDeath,
    endGame: endGame,
    restart: restart,
    enemyKey: function () { return otherKey(state.currentActorKey); }
  };

  global.Game = GameApi;
})(window);
