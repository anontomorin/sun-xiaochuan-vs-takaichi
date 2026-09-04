/*
 * ai.js
 * 规则型 AI：按严格优先级决策（保命→斩杀→收割→防守→压制→常规攻击），
 * 附带 20% 随机扰动，单回合最多 10 次操作，不会死循环。
 */
(function (global) {
  'use strict';

  const sleep = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  // 每张卡的期望倍率（仅用于 AI 估算伤害；三支箭按合计 1.2）
  const EST_MULT = {
    abstract_combo: 1.0, elegant: 1.3, shouting: 0.5, cyber_storm: 1.5,
    ultimate_rap: 2.0, abstract_bible: 0.3,
    policy_debate: 1.0, tax_warning: 0.5, three_arrows: 1.2, tax_storm: 2.0,
    hawkish: 1.2, taiwan_issue: 0.3
  };

  const ULTIMATE_IDS = { sun_xiaochuan: 'ultimate_rap', takaichi_sanae: 'tax_storm' };
  const LINK_STATUS = { sun_xiaochuan: 'abstract', takaichi_sanae: 'tax_burden' };
  const HEAL_SPELLS = { sun_xiaochuan: 'emperor_blessing', takaichi_sanae: 'political_shelter' };
  const HEAL_ITEM = 'red_packet';
  const SPRAY_ITEM = 'purify_spray';
  const COFFEE_ITEM = 'energy_coffee';

  // 演出节奏（毫秒，仅真人游玩时生效；simMode 下自动跳过，不影响测试速度）
  const RHYTHM = {
    thinkFirst: 780,   // AI 接手时的“思考”停顿
    thinkOp: 360,      // 每次决策后的短暂思考
    reveal: 400,       // 亮牌展示时长
    recover: 280,      // 一次操作后的收招停顿
    item: 360,         // 道具操作停顿
    endTurn: 540       // 结束回合前的停顿
  };

  function jitter(base) {
    return base + Math.random() * 220;
  }

  function estMult(cardDef, foeKey) {
    let m = EST_MULT[cardDef.id] || 0;
    if (cardDef.id === 'ultimate_rap' && Game.hasStatus(foeKey, 'abstract')) m = 4.0;
    return m;
  }

  // 期望伤害（随机系数取 1.0）
  function estDamage(atkKey, foeKey, cardDef) {
    const atk = Game.currentAttack(atkKey);
    const def = Game.currentDefense(foeKey);
    const inc = Game.incomingDamageMultiplier(foeKey);
    return Math.max(1, Math.floor((atk - def) * estMult(cardDef, foeKey) * inc));
  }

  // 最低伤害（随机系数取 0.9，不考虑暴击），用于判定必杀
  function minDamage(atkKey, foeKey, cardDef) {
    const atk = Game.currentAttack(atkKey);
    const def = Game.currentDefense(foeKey);
    const inc = Game.incomingDamageMultiplier(foeKey);
    return Math.max(1, Math.floor((atk - def) * estMult(cardDef, foeKey) * 0.9 * inc));
  }

  function playableIndex(key, card) {
    const hand = Game.state[key].hand;
    const i = hand.indexOf(card);
    if (i < 0) return -1;
    return Game.calculateCardCost(key, card) <= Game.state[key].ap ? i : -1;
  }

  function itemIndex(key, itemId) {
    return Game.state[key].items.findIndex(function (it) { return it.defId === itemId; });
  }

  // 压制阶段候选项：按优先级排序的 { cardId, condition }
  function pressureCandidates(charId, ai, foe) {
    const foeKey = foe.key;
    const lists = {
      sun_xiaochuan: [
        { cardId: 'shouting', cond: function () { return !Game.hasStatus(foeKey, 'shut_up'); } },
        { cardId: 'elegant', cond: function () { return !Game.hasStatus(foeKey, 'shut_up'); } },
        { cardId: 'abstract_bible', cond: function () { return !Game.hasStatus(foeKey, 'abstract'); } },
        { cardId: 'cyber_storm', cond: function () { return !Game.hasStatus(foeKey, 'cyber_storm'); } },
        { cardId: 'dog_fans', cond: function () {
          return foe.hand.length >= 2 || (foe.hand.length === 0 && !Game.hasStatus(foeKey, 'dog_fans_siege'));
        } }
      ],
      takaichi_sanae: [
        { cardId: 'tax_warning', cond: function () { return !Game.hasStatus(foeKey, 'tax_warning'); } },
        { cardId: 'history_revision', cond: function () { return foe.hand.length > 0; } },
        { cardId: 'taiwan_issue', cond: function () { return !Game.hasStatus(foeKey, 'taiwan_issue'); } },
        { cardId: 'hawkish', cond: function () { return !Game.hasStatus(foeKey, 'hawkish'); } },
        { cardId: 'three_arrows', cond: function () { return !Game.hasStatus(foeKey, 'tax_burden'); } },
        { cardId: 'history_revision', cond: function () {
          return foe.hand.length === 0 && !Game.hasStatus(foeKey, 'cyber_break');
        } }
      ]
    };
    return (lists[charId] || []).filter(function (c) {
      const card = Game.getCardDef(c.cardId);
      return card && c.cond();
    });
  }

  // 按严格优先级挑选一个动作；返回 null 表示“本轮没有合适动作”
  function decide(key) {
    const G = Game;
    const ai = G.state[key];
    const foe = G.state[G.otherKey(key)];
    const foeKey = foe.key;
    const charId = ai.characterId;

    // ---------- 0. 必杀优先级（任何能确杀的进攻优先） ----------
    const lethal = ai.hand.find(function (c) {
      if (c.def.type !== 'attack') return false;
      const i = playableIndex(key, c);
      if (i < 0) return false;
      return minDamage(key, foeKey, c.def) >= foe.hp;
    });
    if (lethal) return { type: 'play', index: playableIndex(key, lethal) };

    // ---------- P1 保命：HP < 30% ----------
    if (ai.hp < ai.maxHp * 0.3) {
      const healId = HEAL_SPELLS[charId];
      if (healId) {
        const card = ai.hand.find(function (c) { return c.def.id === healId; });
        const i = card ? playableIndex(key, card) : -1;
        if (i >= 0) return { type: 'play', index: i };
      }
      // 没有可用的回血技能 → 尝试回血红包（道具会结束回合）
      if (!Game.hasStatus(key, 'dog_fans_siege')) {
        const hi = itemIndex(key, HEAL_ITEM);
        if (hi >= 0) return { type: 'item', index: hi };
      }
    }

    // ---------- P2 斩杀：AP>=5 + 终极奥义 + 敌方HP<50% 或处于联动状态 ----------
    const ultId = ULTIMATE_IDS[charId];
    if (ultId && ai.ap >= 5) {
      const ult = ai.hand.find(function (c) { return c.def.id === ultId; });
      const ui = ult ? playableIndex(key, ult) : -1;
      const link = LINK_STATUS[charId];
      if (ui >= 0 && (foe.hp < foe.maxHp * 0.5 || (link && Game.hasStatus(foeKey, link)))) {
        return { type: 'play', index: ui };
      }
    }

    // ---------- P3 收割：敌方处于增伤状态 → 优先高伤害牌（费用>=3 倍率最高） ----------
    if (Game.hasStatus(foeKey, 'cyber_storm') || Game.hasStatus(foeKey, 'consumption_storm')) {
      const candidates = ai.hand
        .map(function (c, i) {
          return { card: c, index: i, cost: Game.calculateCardCost(key, c), dmg: estDamage(key, foeKey, c.def) };
        })
        .filter(function (x) {
          return x.card.def.type === 'attack' &&
                 x.card.def.cost >= 3 &&
                 x.card.def.id !== ultId &&
                 x.cost <= ai.ap;
        });
      if (candidates.length > 0) {
        candidates.sort(function (a, b) { return b.dmg - a.dmg || a.cost - b.cost; });
        return { type: 'play', index: candidates[0].index };
      }
    }

    // ---------- P4 防守：HP < 40% 且持有防御牌 ----------
    if (ai.hp < ai.maxHp * 0.4) {
      const defCard = ai.hand.find(function (c) { return c.def.type === 'defense'; });
      const di = defCard ? playableIndex(key, defCard) : -1;
      if (di >= 0) return { type: 'play', index: di };
    }

    // ---------- P5 压制：优先施加敌方缺少的负面状态 ----------
    const press = pressureCandidates(charId, ai, foe);
    for (let i = 0; i < press.length; i++) {
      const card = Game.getCardDef(press[i].cardId);
      const pi = playableIndex(key, card);
      if (pi >= 0) return { type: 'play', index: pi };
    }

    // ---------- P6 常规攻击：费用低 → 伤害高 → 附加效果 ----------
    const attacks = ai.hand
      .map(function (c, i) {
        return {
          card: c, index: i,
          cost: Game.calculateCardCost(key, c),
          dmg: estDamage(key, foeKey, c.def),
          hasEffect: c.def.critDraw || false
        };
      })
      .filter(function (x) {
        return x.card.def.type === 'attack' && x.card.def.id !== ultId && x.cost <= ai.ap;
      });
    if (attacks.length > 0) {
      attacks.sort(function (a, b) {
        if (a.cost !== b.cost) return a.cost - b.cost;       // 费用低
        if (b.dmg !== a.dmg) return b.dmg - a.dmg;           // 伤害高
        return (b.hasEffect ? 1 : 0) - (a.hasEffect ? 1 : 0); // 附加效果
      });
      // 20% 随机扰动：从其它可用进攻里随机换一张（不破坏明显保命逻辑）
      if (Math.random() < 0.2 && ai.hp >= ai.maxHp * 0.35 && attacks.length > 1) {
        return { type: 'play', index: attacks[Math.floor(Math.random() * attacks.length)].index };
      }
      return { type: 'play', index: attacks[0].index };
    }

    // ---------- 净化喷雾：血量偏低且带负面状态 ----------
    if (!Game.hasStatus(key, 'dog_fans_siege') && ai.hp < ai.maxHp * 0.55) {
      const hasNegative = ai.statuses.some(function (s) {
        const d = Game.getStatusDef(s.id);
        return d && d.kind === 'negative';
      });
      const si = hasNegative ? itemIndex(key, SPRAY_ITEM) : -1;
      if (si >= 0) return { type: 'item', index: si };
    }

    // ---------- 兜底：打一张可用且不强制结束回合的牌（费用最低） ----------
    const fallback = ai.hand
      .map(function (c, i) { return { card: c, index: i, cost: Game.calculateCardCost(key, c) }; })
      .filter(function (x) {
        return x.card.def.type !== 'defense' && x.cost <= ai.ap;
      })
      .sort(function (a, b) { return a.cost - b.cost; });
    if (fallback.length > 0) {
      return { type: 'play', index: fallback[0].index };
    }

    return null;
  }

  function execute(key, action) {
    if (action.type === 'play') {
      Game.attemptPlayCard(key, action.index);
    } else if (action.type === 'item') {
      Game.useItem(key, action.index);
    } else if (action.type === 'discardForAp') {
      Game.aiDiscardForAp(key, action.index);
    }
    if (global.UI && typeof UI.refresh === 'function') UI.refresh();
  }

  // 单个 AI 回合：最多 10 次操作，结束后自动结束回合
  async function startTurn(key) {
    const G = Game;
    if (G.isOver()) return;
    // 先在事件循环上让出一次：防止回合链在同步路径下无限加深调用栈
    if (G.state.simMode) {
      await Promise.resolve();
    } else {
      await sleep(RHYTHM.thinkFirst); // AI 接手：先“思考”一会儿
    }

    let ops = 0;
    const MAX_OPS = 10;
    let firstAction = true;

    try {
      while (!G.isOver() &&
             G.state.phase === G.PHASE.ACTION &&
             G.state.currentActorKey === key &&
             ops < MAX_OPS) {

        const action = decide(key);
        if (!action) {
          // 无合适动作：先尝试能量咖啡，再按 20% 概率弃牌换 AP，否则结束回合
          const ai = G.state[key];
          let endedByItem = false;
          if (!G.hasStatus(key, 'dog_fans_siege')) {
            const ci = itemIndex(key, COFFEE_ITEM);
            if (ci >= 0 && ai.ap <= 6) {
              ops += 1;
              if (!G.state.simMode) await sleep(jitter(RHYTHM.item));
              execute(key, { type: 'item', index: ci });
              endedByItem = true;
            }
          }
          if (!endedByItem && !ai.discardUsedThisTurn && ai.hand.length >= 3 && Math.random() < 0.2) {
            ops += 1;
            if (!G.state.simMode) await sleep(jitter(RHYTHM.thinkOp));
            const ri = Math.floor(Math.random() * ai.hand.length);
            execute(key, { type: 'discardForAp', index: ri });
            continue; // 多获得 1 AP 后再试一轮
          }
          break;
        }

        ops += 1;
        if (G.state.simMode) {
          execute(key, action);
          continue;
        }

        // ---- 真人观战节奏：思考 → 亮牌 → 结算 → 收招 ----
        if (action.type === 'play') {
          const card = G.state[key].hand[action.index];
          if (firstAction) {
            await sleep(jitter(420));       // 首张牌前的掂量
            firstAction = false;
          } else {
            await sleep(jitter(300));
          }
          // 敌方头像旁亮出将要打出的牌
          if (card && global.UI && typeof UI.castReveal === 'function') {
            UI.castReveal(key, card.def);
          }
          await sleep(jitter(RHYTHM.reveal));
          execute(key, action);
          await sleep(jitter(RHYTHM.recover));
        } else if (action.type === 'item') {
          await sleep(jitter(RHYTHM.item));
          execute(key, action);
          await sleep(260);
        } else {
          await sleep(jitter(RHYTHM.thinkOp));
          execute(key, action);
          await sleep(200);
        }
      }
    } catch (err) {
      // 任何意外错误都不能让 AI 卡死：记录后照常结束回合
      if (global.console) console.error('AI 回合异常:', err);
      try { G.log('🤖 AI 决策异常，提前结束回合'); } catch (e) { /* ignore */ }
    }

    try {
      if (!G.isOver() &&
          G.state.phase === G.PHASE.ACTION &&
          G.state.currentActorKey === key) {
        if (!G.state.simMode) await sleep(jitter(RHYTHM.endTurn));
        G.endTurn(key);
      }
      if (global.UI && typeof UI.refresh === 'function') UI.refresh();
    } catch (err2) {
      if (global.console) console.error('AI 收尾异常:', err2);
    }
  }

  global.AI = {
    startTurn: startTurn
  };
})(window);
