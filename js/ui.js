/*
 * ui.js
 * 全部 DOM 渲染 / 卡牌与 HP-AP UI / 日志 / 动画 / 弹层 / 音效。
 * 只负责展示，不包含战斗规则。
 */
(function (global) {
  'use strict';

  const UI = {};
  const TYPE_CLASS = {
    attack: 'ctype-attack', skill: 'ctype-skill', defense: 'ctype-defense',
    status: 'ctype-status', special: 'ctype-special'
  };

  let refs = {};
  const fxQueues = {}; // key -> 待播放动画队列（让同一目标的连击特效逐次拉开）

  function $(id) { return document.getElementById(id); }

  function cacheRefs() {
    refs = {
      homeScreen: $('screen-home'),
      selectScreen: $('screen-select'),
      battleScreen: $('screen-battle'),
      charCards: $('char-cards'),
      selectHint: $('select-hint'),
      btnStart: $('btn-start'),
      stage: $('stage'),
      turnBanner: $('turn-banner'),
      fxLayer: $('fx-layer'),
      turnBadge: $('turn-badge'),
      storyFlag: $('story-flag'),
      stageHint: $('stage-hint'),
      logList: $('log-list'),
      hand: $('hand'),
      handLabel: $('hand-label'),
      itemRow: $('item-row'),
      btnDiscardAp: $('btn-discard-ap'),
      btnPlay: $('btn-play'),
      btnEnd: $('btn-end'),
      btnAuto: $('btn-auto'),
      btnSpeed: $('btn-speed'),
      cardDetail: $('card-detail'),
      detailCard: $('detail-card'),
      detailInfo: $('detail-info'),
      btnDetailPlay: $('btn-detail-play'),
      btnDetailClose: $('btn-detail-close'),
      overflowOverlay: $('overflow-overlay'),
      overflowDesc: $('overflow-desc'),
      overflowList: $('overflow-list'),
      apdiscardOverlay: $('apdiscard-overlay'),
      apdiscardList: $('apdiscard-list'),
      rulesOverlay: $('rules-overlay'),
      devOverlay: $('dev-overlay'),
      gameOver: $('game-over'),
      goEmoji: $('go-emoji'),
      goTitle: $('go-title'),
      goDesc: $('go-desc'),
      toast: $('toast')
    };
    ['player', 'enemy'].forEach(function (key) {
      refs['avatar_' + key] = $('avatar-' + key);
      refs['stavatar_' + key] = $('stage-avatar-' + key);
      refs['name_' + key] = $('name-' + key);
      refs['stagName_' + key] = $('stage-name-' + key);
      refs['tag_' + key] = $('tag-' + key);
      refs['speed_' + key] = $('speed-' + key);
      refs['hpfill_' + key] = $('hpfill-' + key);
      refs['hptext_' + key] = $('hptext-' + key);
      refs['appips_' + key] = $('appips-' + key);
      refs['aptext_' + key] = $('aptext-' + key);
      refs['statuses_' + key] = $('statuses-' + key);
      refs['meta_' + key] = $('meta-' + key);
      refs['handcount_' + key] = $('handcount-' + key);
      refs['zone_' + key] = $('zone-' + key);
    });
  }

  // ------------------------------------------------------------------
  // 音效（Web Audio API 合成，无外部文件）
  // ------------------------------------------------------------------
  const sound = {
    enabled: true,
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, vol, delay) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol || 0.2, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    noise: function (dur, vol) {
      const ctx = this.ensure();
      if (!ctx) return;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = vol || 0.3;
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start();
    },
    play: function (name) {
      if (!this.enabled) return;
      switch (name) {
        case 'click': this.tone(720, 0.05, 'square', 0.08); break;
        case 'play': this.tone(520, 0.08, 'triangle', 0.18); break;
        case 'attack': this.noise(0.18, 0.32); this.tone(180, 0.12, 'square', 0.12); break;
        case 'hit': this.noise(0.1, 0.4); this.tone(120, 0.16, 'triangle', 0.3); break;
        case 'heal': this.tone(440, 0.12, 'sine', 0.18); this.tone(660, 0.16, 'sine', 0.16, 0.09); break;
        case 'status': this.tone(330, 0.1, 'sawtooth', 0.08); this.tone(420, 0.12, 'sawtooth', 0.08, 0.08); break;
        case 'win': this.tone(523, 0.14, 'triangle', 0.2); this.tone(659, 0.14, 'triangle', 0.2, 0.12);
                    this.tone(784, 0.2, 'triangle', 0.2, 0.24); this.tone(1046, 0.3, 'triangle', 0.22, 0.36); break;
        case 'lose': this.tone(400, 0.18, 'triangle', 0.18); this.tone(300, 0.18, 'triangle', 0.18, 0.16);
                     this.tone(200, 0.3, 'triangle', 0.18, 0.32); break;
        case 'deny': this.tone(200, 0.1, 'square', 0.1); break;
      }
    }
  };

  // ------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 头像 DOM：Emoji 兜底 + 美术立绘/本地照片覆盖（加载失败时自动回退）
  // 优先级：风格化美术立绘(art) > 本地照片(photo) > Emoji
  function avatarInnerHTML(def, role) {
    // 战斗对象是角色定义的副本，照片信息需实时从 Characters 取
    const live = (def && def.characterId && Characters.CHARACTERS[def.characterId]) || def || {};
    let img = '';
    if (live.art && live.artOk !== false) {
      img = '<img class="av-img' + (role ? ' ' + role : '') + '" src="' + esc(live.art) +
        '" alt="' + esc(live.name || '') + '" draggable="false">';
    } else if (live.photo && live.photoOk) {
      img = '<img class="av-img' + (role ? ' ' + role : '') + '" src="' + esc(live.photo) +
        '" alt="' + esc(live.name || '') + '" draggable="false">';
    }
    return '<span class="ph">' + esc(live.emoji || '') + '</span>' + img;
  }

  // 启动时探测本地立绘/照片是否存在（存在才用 <img>，避免破图闪烁）
  function probePhotos() {
    if (typeof Image === 'undefined') return;
    Object.keys(Characters.CHARACTERS).forEach(function (id) {
      const c = Characters.CHARACTERS[id];
      if (c.art) {
        const ia = new Image();
        ia.onload = function () {
          c.artOk = true;
          refreshPhotoSlots();
          if (Game.state && Game.state.player && Game.state.phase !== Game.PHASE.SELECT) {
            refresh();
          }
        };
        ia.onerror = function () { c.artOk = false; };
        ia.src = c.art;
      }
      if (!c.photo) return;
      const im = new Image();
      im.onload = function () {
        c.photoOk = true;
        refreshPhotoSlots();
        if (Game.state && Game.state.player && Game.state.phase !== Game.PHASE.SELECT) {
          refresh();
        }
      };
      im.onerror = function () { c.photoOk = false; };
      im.src = c.photo;
    });
  }

  // 照片加载完成后刷新静态头像位（首页 Logo / 选角卡）
  function refreshPhotoSlots() {
    const map = { 'av-sun': 'sun_xiaochuan', 'av-sanae': 'takaichi_sanae' };
    document.querySelectorAll('.logo-av').forEach(function (el) {
      const id = map[el.className.split(' ').find(function (k) { return map[k]; })];
      if (!id) return;
      const c = Characters.CHARACTERS[id];
      if (c && c.photoOk) el.innerHTML = avatarInnerHTML(c, 'logo');
    });
    document.querySelectorAll('.char-card').forEach(function (el) {
      const id = el.dataset.char;
      const c = Characters.CHARACTERS[id];
      if (!c || !c.photoOk) return;
      const cell = el.querySelector('.char-emoji');
      if (cell) cell.innerHTML = avatarInnerHTML(c);
    });
  }

  function cardHtml(def, opts) {
    const o = opts || {};
    const meta = CardData.TYPE_META[def.type] || { label: '未知', icon: '?' };
    const cost = o.cost !== undefined ? o.cost : def.cost;
    const costClass = o.modified ? (o.cost > def.cost ? ' cost-up' : (o.cost < def.cost ? ' cost-down' : '')) : '';
    return '<div class="card ' + (TYPE_CLASS[def.type] || '') + (o.selected ? ' selected' : '') +
      (o.playable ? ' playable' : '') + (o.dim ? ' dim' : '') + '" data-index="' + o.index + '">' +
      '<span class="card-cost' + costClass + '" title="实际费用">' + cost + '</span>' +
      '<span class="card-type-icon" title="' + meta.label + '">' + meta.icon + '</span>' +
      '<div class="card-name">' + esc(def.name) + '</div>' +
      '<div class="card-desc">' + esc(def.desc) + '</div>' +
      '<div class="card-type-label">' + meta.label + '</div>' +
      '</div>';
  }

  function canAct() {
    const G = Game;
    return G.state.phase === G.PHASE.ACTION &&
           G.state.currentActorKey === 'player' &&
           !G.state.isProcessing &&
           !G.isOver();
  }

  // ------------------------------------------------------------------
  // 渲染：战斗主界面
  // ------------------------------------------------------------------
  function renderTurnInfo() {
    const G = Game;
    if (!G.state.player) return;
    const actor = G.state[G.state.currentActorKey];
    const round = G.currentRound();
    refs.turnBadge.textContent = actor
      ? '第 ' + round + ' 回合 · ' + actor.emoji + ' ' + actor.name + '行动'
      : '';

    let hint = '';
    if (G.isOver()) {
      hint = '对局结束';
    } else if (G.state.phase === G.PHASE.OVERFLOW) {
      hint = '⚠️ 手牌超限，请选择要弃掉的牌';
    } else if (actor && G.hasStatus(actor.key, 'abstract')) {
      hint = '🌀 ' + actor.name + ' 陷入抽象化，正在发疯…';
    } else if (actor && actor.key === 'enemy') {
      hint = '🤖 AI（' + actor.name + '）思考中…';
    } else if (actor && actor.key === 'player' && G.state.playerAuto) {
      hint = '🤖 自动托管中…（点「自动战斗」可取消，下一回合恢复手动）';
    } else if (actor && actor.key === 'player' && G.state.isProcessing) {
      hint = '🤖 托管正在收尾…（下一回合恢复手动）';
    } else if (actor) {
      hint = '🎮 你的回合：点击手牌选择，再点「出牌」';
    }
    refs.stageHint.textContent = hint;

    ['player', 'enemy'].forEach(function (key) {
      const zone = refs['zone_' + key];
      if (!zone) return;
      zone.classList.toggle('active-turn', !!actor && actor.key === key && !G.isOver());
    });
  }

  function renderZone(key) {
    const actor = Game.state[key];
    if (!actor) return;

    refs['name_' + key].textContent = actor.name;
    refs['stagName_' + key].textContent = actor.name;
    refs['avatar_' + key].innerHTML = avatarInnerHTML(actor);
    refs['stavatar_' + key].innerHTML = avatarInnerHTML(actor);
    refs['tag_' + key].textContent = actor.tagline;
    const effSp = (Game.effectiveSpeed && Game.effectiveSpeed(key)) || actor.speed;
    const spTxt = effSp === actor.speed
      ? '速度 ' + actor.speed
      : '速度 ' + actor.speed + '（' + effSp + '）';
    // v2.1c：速度/攻防并入 meta 行，zone-head 只留名字+tag
    refs['speed_' + key].textContent = '';

    // v2.1b 沉浸版：zone 铺角色立绘底（立绘 > 照片 > 无）
    // v2.2：按美术文件设置 --zone-pos，把脸部中心对齐到立绘可见区
    const live = (actor.characterId && Characters.CHARACTERS[actor.characterId]) || actor || {};
    const artSrc = (live.art && live.artOk !== false) ? live.art : '';
    const zone = refs['zone_' + key];
    if (zone) {
      if (artSrc) {
        // CSS url() 相对 css/style.css 解析，页面相对路径需补 ../ 前缀
        const cssRel = artSrc.replace(/^assets\//, '../assets/');
        zone.style.setProperty('--zone-art', 'url("' + cssRel + '")');
        // 脸部中心（图纵坐标 %）→ background-position y（图高 150% 时 上裁=3×(fc-18.7)%）
        const fname = String(artSrc).split('/').pop();
        const ZONE_FACE = {
          'sun.png': 26, 'sanae.png': 30,           // 角色半身立绘：脸中上
          'e1.png': 38, 'e2.png': 34, 'e5.png': 34, 'e6.png': 34, 'e9.png': 34,
          'eb1.png': 34, 'eb2.png': 34, 'eb3.png': 34 // 敌人：头部整体偏下
        };
        const fc = ZONE_FACE[fname] != null ? ZONE_FACE[fname] : 30;
        const pos = Math.max(0, Math.min(100, (fc - 18.7) * 3)).toFixed(1);
        zone.style.setProperty('--zone-pos', pos + '%');
      } else {
        zone.style.removeProperty('--zone-art');
        zone.style.removeProperty('--zone-pos');
      }
    }

    const hpPct = Math.max(0, Math.min(100, actor.hp / actor.maxHp * 100));
    refs['hpfill_' + key].style.width = hpPct + '%';
    refs['hptext_' + key].textContent = actor.hp + ' / ' + actor.maxHp;
    if (hpPct < 30) refs['hpfill_' + key].classList.add('low');
    else refs['hpfill_' + key].classList.remove('low');

    refs['aptext_' + key].textContent = actor.ap + ' / ' + actor.maxAp;
    const pips = [];
    for (let i = 0; i < actor.maxAp; i++) {
      pips.push('<span class="pip' + (i < actor.ap ? ' on' : '') + '"></span>');
    }
    refs['appips_' + key].innerHTML = pips.join('');

    // 状态
    const statusHtml = actor.statuses.map(function (s) {
      const d = Game.getStatusDef(s.id);
      if (!d) return '';
      const dur = s.duration === null || s.duration === undefined ? '' : '<i class="dur">×' + s.duration + '</i>';
      return '<span class="status-chip ' + (d.kind === 'negative' ? 'neg' : 'pos') +
        '" data-status="' + s.id + '" data-key="' + key + '" title="' + esc(d.desc + '（剩余' + (dur ? s.duration + ' 回合' : '直到自己的下回合开始') + '）') + '">' +
        d.icon + esc(d.name) + dur + '</span>';
    }).join('');
    refs['statuses_' + key].innerHTML = statusHtml || '<span class="no-status">无状态</span>';

    // 手牌/牌库/弃牌数量（meta 行合并速度与攻防）
    refs['handcount_' + key].textContent = '🂠 ' + actor.hand.length;
    const counts = '⚡ ' + spTxt + ' · 攻 ' + actor.attack + ' · 防 ' + actor.defense +
      '　｜　牌库 ' + actor.deck.length + ' · 弃牌堆 ' + actor.discardPile.length +
      (actor.discardUsedThisTurn ? ' · 已弃牌换AP' : '');
    refs['meta_' + key].textContent = counts;
  }

  function renderHand() {
    const G = Game;
    const hand = G.state.player ? G.state.player.hand : [];
    if (hand.length === 0) {
      refs.hand.innerHTML = '<div class="hand-empty">手牌为空（回合开始会抽牌）</div>';
      refs.handLabel.textContent = '你的手牌（' + hand.length + '/5）';
      return;
    }
    const selected = G.state.selectedCardIndex;
    const canPlay = canAct();
    const html = hand.map(function (card, i) {
      const actual = G.calculateCardCost('player', card);
      const opts = {
        index: i,
        cost: actual,
        modified: actual !== card.def.cost,
        selected: canPlay && selected === i,
        playable: canPlay && actual <= G.state.player.ap
      };
      return cardHtml(card.def, opts);
    }).join('');
    refs.hand.innerHTML = html;
    refs.handLabel.textContent = '你的手牌（' + hand.length + '/5）' +
      (G.state.player.discardUsedThisTurn ? '' : '');
  }

  function renderItems() {
    const G = Game;
    const actor = G.state.player;
    if (!actor) return;
    const blocked = G.hasStatus('player', 'dog_fans_siege');
    if (actor.items.length === 0) {
      refs.itemRow.innerHTML = '<div class="no-items">道具已用完</div>';
      return;
    }
    const html = actor.items.map(function (item, i) {
      const d = Characters.ITEM_DEFS[item.defId];
      const art = d.art ? '<img class="item-art" src="' + esc(d.art) + '" alt="">' : '';
      return '<div class="item-chip' + (blocked ? ' blocked' : '') + '" data-index="' + i + '" title="' +
        esc(d.desc + (blocked ? '（狗粉丝围攻：禁用道具）' : '（使用后立即结束回合）')) + '">' +
        art +
        '<span class="item-name">' + esc(d.name) + '</span></div>';
    }).join('');
    refs.itemRow.innerHTML = html;
  }

  function renderButtons() {
    const G = Game;
    const actor = G.state.player;
    const active = canAct();
    if (!actor) return;

    refs.btnEnd.disabled = !active;
    refs.btnDiscardAp.disabled = !active || actor.discardUsedThisTurn || actor.hand.length === 0;

    let playOk = false;
    if (active && G.state.selectedCardIndex !== null) {
      const card = actor.hand[G.state.selectedCardIndex];
      if (card) {
        playOk = G.calculateCardCost('player', card) <= actor.ap;
      }
    }
    refs.btnPlay.disabled = !playOk;
    refs.btnPlay.textContent = playOk ? '🗡️ 出牌' : '🗡️ 出牌（AP不足）';
  }

  // 自动战斗 / 速度 按钮状态
  function updateAutoBar() {
    const G = Game;
    if (!refs.btnAuto || !G.state.player) return;
    const auto = !!G.state.playerAuto;
    const finishing = !auto && !G.isOver() &&
      G.state.currentActorKey === 'player' && G.state.isProcessing &&
      G.state.phase === G.PHASE.ACTION;
    refs.btnAuto.textContent = auto ? '🤖 托管中' : (finishing ? '⌛ 本回合收尾' : '🤖 自动战斗');
    refs.btnAuto.classList.toggle('on', auto);
    refs.btnSpeed.textContent = '⏩ ' + (G.state.animSpeed || 1) + 'x';
    refs.btnSpeed.disabled = G.isOver();
    refs.btnAuto.disabled = G.isOver();
  }

  // 故事模式界面标识（右上角阶段/Boss 徽章、Boss 区域高亮）
  function updateStoryChrome() {
    const G = Game;
    if (!refs.storyFlag) return;
    if (G.state.storyActive && G.state.player) {
      const type = G.state.storyStageType || 'battle';
      const boss = type === 'boss' || type === 'finalBoss';
      refs.storyFlag.textContent = '🎬 故事' + (G.state.storyStageNum ? ' · ' + G.state.storyStageNum : '') +
        (boss ? ' · 👑 BOSS' : '');
      refs.storyFlag.classList.toggle('boss', boss);
      refs.storyFlag.classList.remove('hidden');
      const z = refs.zone_enemy;
      if (z) z.classList.toggle('boss-zone', boss);
    } else {
      refs.storyFlag.classList.add('hidden');
      const z = refs.zone_enemy;
      if (z) z.classList.remove('boss-zone');
    }
  }

  function renderLog() {
    const G = Game;
    const items = G.state.logs.map(function (line) {
      const isPlayer = /孙笑川/.test(line) && G.state.player &&
        G.state.player.characterId === 'sun_xiaochuan';
      return '<div class="log-line' + (isPlayer ? ' me' : '') + '">' + esc(line) + '</div>';
    }).join('');
    refs.logList.innerHTML = items;
    refs.logList.scrollTop = refs.logList.scrollHeight;
  }

  // 刷新全部战斗 UI
  function refresh() {
    const G = Game;
    if (!G.state.player) return;
    // 非玩家可操作时自动收起卡牌详情弹层
    if (G.state.phase !== G.PHASE.ACTION ||
        G.state.currentActorKey !== 'player' ||
        G.state.isProcessing ||
        G.isOver()) {
      refs.cardDetail.classList.add('hidden');
    }
    renderTurnInfo();
    renderZone('player');
    renderZone('enemy');
    renderHand();
    renderItems();
    renderButtons();
    renderLog();
    updateAutoBar();
    updateStoryChrome();
    syncOverlay();
  }

  // ------------------------------------------------------------------
  // 弹层
  // ------------------------------------------------------------------
  function openDetail(index) {
    const G = Game;
    const actor = G.state.player;
    if (!actor || index === null || index < 0 || index >= actor.hand.length) return;
    const card = actor.hand[index];
    const def = card.def;
    const actual = G.calculateCardCost('player', card);
    const afford = actual <= actor.ap;
    refs.detailCard.innerHTML = cardHtml(def, {
      index: index, cost: actual, modified: actual !== def.cost
    });
    const meta = CardData.TYPE_META[def.type];
    const modNote = actual !== def.cost
      ? '<p class="detail-note">实际费用 ' + actual + '（基础 ' + def.cost + '，含临时修正）</p>'
      : '';
    refs.detailInfo.innerHTML = '<p class="detail-name">' + esc(def.name) + '</p>' +
      '<p class="detail-type">' + meta.icon + ' ' + meta.label + ' · 费用 ' + def.cost + '</p>' +
      '<p class="detail-desc">' + esc(def.desc) + '</p>' + modNote +
      '<p class="detail-ap' + (afford ? ' ok' : ' bad') + '">' +
      (afford ? '当前 AP 足够' : '当前 AP 不足（需要 ' + actual + '）') + '</p>';
    refs.btnDetailPlay.disabled = !afford || !canAct();
    refs.cardDetail.classList.remove('hidden');
  }

  function closeDetail() {
    refs.cardDetail.classList.add('hidden');
  }

  function syncOverlay() {
    const G = Game;
    if (G.state.phase === G.PHASE.OVERFLOW) {
      refs.overflowOverlay.classList.remove('hidden');
      renderOverflowChooser();
    } else {
      refs.overflowOverlay.classList.add('hidden');
    }
  }

  function renderOverflowChooser() {
    const G = Game;
    const hand = G.state.player.hand;
    const pending = G.state.pendingOverflowDiscards;
    refs.overflowDesc.textContent = '还需弃掉 ' + pending + ' 张（手牌上限 5）';
    refs.overflowList.innerHTML = hand.map(function (card, i) {
      return cardHtml(card.def, { index: i, cost: G.calculateCardCost('player', card) });
    }).join('');
  }

  function showApDiscard() {
    const G = Game;
    const hand = G.state.player.hand;
    if (hand.length === 0) return;
    refs.apdiscardList.innerHTML = hand.map(function (card, i) {
      return cardHtml(card.def, { index: i, cost: G.calculateCardCost('player', card) });
    }).join('');
    refs.apdiscardOverlay.classList.remove('hidden');
  }

  function hideApDiscard() {
    refs.apdiscardOverlay.classList.add('hidden');
  }

  function showRules() { refs.rulesOverlay.classList.remove('hidden'); }
  function hideRules() { refs.rulesOverlay.classList.add('hidden'); }

  function showGameOver(payload) {
    const G = Game;
    const winnerKey = payload.winnerKey || G.state.winnerKey;
    const win = winnerKey === 'player';
    const winner = G.state[winnerKey];
    const loser = G.state[G.otherKey(winnerKey)];
    refs.goEmoji.textContent = win ? '🎉' : '💀';
    refs.goTitle.textContent = win ? '胜利！' : '失败';
    refs.goDesc.textContent = winner.name + '获胜！' + loser.name + ' HP 归零。';
    // v2.1 美术重制：结算背景切换为 胜利/失败 美术图
    const art = refs.gameOver ? refs.gameOver.querySelector('.go-art') : null;
    if (art) {
      art.classList.toggle('art-win', win);
      art.classList.toggle('art-lose', !win);
    }
    refs.gameOver.classList.remove('hidden');
    sound.play(win ? 'win' : 'lose');
  }

  function toast(text, ms) {
    refs.toast.textContent = text;
    refs.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { refs.toast.classList.add('hidden'); }, ms || 1800);
  }

  // ------------------------------------------------------------------
  // 动画
  // ------------------------------------------------------------------
  function animAvatar(key, cls) {
    [refs['avatar_' + key], refs['stavatar_' + key]].forEach(function (el) {
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth; // 强制 reflow 以重启动画
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, 600);
    });
  }

  function floatText(key, text, type) {
    const box = refs['zone_' + key];
    if (!box) return;
    const host = box.querySelector('.avatar-box') || box;
    const span = document.createElement('span');
    span.className = 'float-text ' + (type || '');
    span.textContent = text;
    host.appendChild(span);
    setTimeout(function () { span.remove(); }, 1000);
  }

  // 同类视觉事件排队：连续伤害（如三支箭）逐次播放，更有打击感
  function queueFx(key, fn) {
    if (!fxQueues[key]) fxQueues[key] = [];
    fxQueues[key].push(fn);
    pumpFx(key);
  }

  function pumpFx(key) {
    const q = fxQueues[key];
    if (!q || q.length === 0) {
      delete fxQueues[key];
      return;
    }
    const fn = q.shift();
    try { fn(); } catch (e) { /* 视觉错误不阻塞逻辑 */ }
    setTimeout(function () { pumpFx(key); }, 165);
  }

  // 在全屏特效层生成一个临时元素
  function fx(className, html, lifeMs, styleObj) {
    const layer = refs.fxLayer || document.body;
    const el = document.createElement('div');
    el.className = 'fx-el ' + className;
    el.innerHTML = html;
    if (styleObj) {
      Object.keys(styleObj).forEach(function (k) { el.style[k] = styleObj[k]; });
    }
    layer.appendChild(el);
    setTimeout(function () { el.remove(); }, lifeMs || 900);
    return el;
  }

  // 回合开始横幅（节奏提示）
  let bannerTimer = null;
  function showTurnBanner(key) {
    const G = Game;
    if (!refs.turnBanner || !G.state[key]) return;
    const actor = G.state[key];
    refs.turnBanner.innerHTML =
      '<span class="tb-emoji">' + actor.emoji + '</span>' +
      '<span class="tb-name">' + esc(actor.name) + '</span>' +
      '<span class="tb-suffix">的回合 · 第 ' + G.currentRound() + ' 回合</span>';
    refs.turnBanner.classList.remove('hidden', 'show');
    void refs.turnBanner.offsetWidth;
    refs.turnBanner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      refs.turnBanner.classList.remove('show');
    }, 1050);
  }

  // 角色头像出现光环（状态/治疗提示）
  function avatarRing(key, type) {
    const box = refs['zone_' + key];
    if (!box) return;
    const host = box.querySelector('.avatar-box') || box;
    const ring = document.createElement('span');
    ring.className = 'avatar-ring ' + (type || '');
    host.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 750);
  }

  // 屏幕震动 + 受击闪红（大伤害）
  function screenImpact(amount) {
    if (refs.battleScreen) {
      refs.battleScreen.classList.remove('screen-shake');
      void refs.battleScreen.offsetWidth;
      refs.battleScreen.classList.add('screen-shake');
      setTimeout(function () { refs.battleScreen.classList.remove('screen-shake'); }, 480);
    }
    fx('hit-flash' + (amount >= 45 ? ' heavy' : ''), '', 420);
  }

  // AI/敌方亮牌：在头像旁展示即将打出的卡
  const lastReveal = {};
  function castReveal(key, def) {
    if (!def) return;
    const now = Date.now();
    if (lastReveal[key] && now - lastReveal[key] < 800) return; // 去重（AI 播报 + 打出钩子）
    lastReveal[key] = now;
    const box = refs['zone_' + key];
    if (!box) return;
    const host = box.querySelector('.avatar-box') || box;
    const el = document.createElement('div');
    const cost = def.cost;
    el.className = 'cast-reveal';
    el.innerHTML =
      '<div class="mini-card ctype-' + (TYPE_CLASS[def.type] ? def.type : '') + '">' +
      '<span class="mc-cost">' + cost + '</span>' +
      '<span class="mc-icon">' + (CardData.TYPE_META[def.type] ? CardData.TYPE_META[def.type].icon : '') + '</span>' +
      '<span class="mc-name">' + esc(def.name) + '</span>' +
      '</div>';
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 980);
  }

  // 出牌爆发特效（中央舞台）
  function playBurst(def) {
    const meta = CardData.TYPE_META[def.type] || { icon: '⚔️', label: '' };
    fx('play-burst', '<span class="burst-icon">' + meta.icon + '</span>' +
      '<span class="burst-name">' + esc(def.name) + '</span>', 780);
  }

  function critFx() {
    fx('crit-text', '<span>💥 暴击！</span>', 950);
  }

  // 胜利礼花
  function confetti(n) {
    const colors = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ec4899'];
    for (let i = 0; i < n; i++) {
      fx('confetti', '', 4300, {
        left: (Math.random() * 100) + 'vw',
        top: '-3vh',
        background: colors[i % colors.length],
        animationDelay: (Math.random() * 0.8) + 's',
        animationDuration: (1.6 + Math.random() * 1.4) + 's',
        transform: 'rotate(' + (Math.random() * 360) + 'deg)'
      });
    }
  }

  function hookVisuals() {
    const G = Game;
    G.visual.log = function () {
      if (refs.logList) renderLog();
    };
    G.visual.attack = function (p) {
      queueFx('atk-' + p.key, function () {
        animAvatar(p.key, 'anim-attack');
        sound.play('attack');
      });
    };
    G.visual.damage = function (p) {
      if (p.crit) critFx();
      queueFx('dmg-' + p.key, function () {
        animAvatar(p.key, 'anim-hit');
        floatText(p.key, '-' + p.amount + (p.crit ? '!💥' : ''), p.crit ? 'crit' : 'dmg');
        sound.play('hit');
      });
      if (p.amount >= 25) {
        setTimeout(function () { screenImpact(p.amount); }, 20);
      }
    };
    G.visual.heal = function (p) {
      queueFx('dmg-' + p.key, function () {
        avatarRing(p.key, 'ring-heal');
        floatText(p.key, '+' + p.amount, 'heal');
        sound.play('heal');
      });
    };
    G.visual.status = function (p) {
      const d = G.getStatusDef(p.statusId);
      if (d) {
        queueFx('st-' + p.key, function () {
          avatarRing(p.key, d.kind === 'negative' ? 'ring-neg' : 'ring-pos');
          floatText(p.key, d.icon + ' ' + d.name, 'status');
          sound.play('status');
        });
      }
    };
    G.visual.playCard = function (p) {
      sound.play('play');
      const card = p.card;
      if (card && card.def) {
        playBurst(card.def);
        if (p.key === 'enemy') castReveal('enemy', card.def);
      }
      if (p.key === 'player') {
        refs.hand.classList.remove('hand-pulse');
        void refs.hand.offsetWidth;
        refs.hand.classList.add('hand-pulse');
      } else {
        setTimeout(function () { animAvatar('enemy', 'anim-cast'); }, 180);
      }
    };
    G.visual.item = function (p) {
      sound.play('heal');
      if (p.key === 'enemy') {
        fx('item-fx', '🧰', 800);
      }
    };
    G.visual.statusBlock = function () {
      sound.play('deny');
      toast('🌏 「台湾有事」阻止了技能牌！');
    };
    G.visual.toast = function (p) { toast(p.text); };
    G.visual.gameOver = function (p) {
      showGameOver(p);
      if (p && p.winnerKey === 'player') confetti(28);
    };
    G.visual.overflow = function () {
      sound.play('deny');
    };
    G.visual.turn = function (p) {
      showTurnBanner(p.key);
    };
    G.visual.draw = function () {
      // 抽牌时的小反馈
    };
    G.visual.battleStart = function () {
      toast('⚔️ 战斗开始！');
    };
  }

  function showSelectScreen() {
    refs.battleScreen.classList.add('hidden');
    refs.homeScreen.classList.add('hidden');
    refs.devOverlay && refs.devOverlay.classList.add('hidden');
    refs.selectScreen.classList.remove('hidden');
    refs.gameOver.classList.add('hidden');
  }

  function showBattleScreen() {
    refs.homeScreen.classList.add('hidden');
    refs.selectScreen.classList.add('hidden');
    refs.battleScreen.classList.remove('hidden');
    refs.gameOver.classList.add('hidden');
  }

  function showHomeScreen() {
    refs.battleScreen.classList.add('hidden');
    refs.selectScreen.classList.add('hidden');
    refs.gameOver.classList.add('hidden');
    refs.homeScreen.classList.remove('hidden');
  }

  UI.init = function () {
    cacheRefs();
    hookVisuals();
    probePhotos();
  };

  UI.refresh = refresh;
  UI.canAct = canAct;
  UI.openDetail = openDetail;
  UI.closeDetail = closeDetail;
  UI.showApDiscard = showApDiscard;
  UI.hideApDiscard = hideApDiscard;
  UI.showRules = showRules;
  UI.hideRules = hideRules;
  UI.toast = toast;
  UI.castReveal = castReveal;
  UI.showSelectScreen = showSelectScreen;
  UI.showBattleScreen = showBattleScreen;
  UI.showHomeScreen = showHomeScreen;
  UI.sound = sound;
  UI.esc = esc;
  UI.cardHtml = cardHtml;

  // v2.1 美术重制：切换战斗底图（自由对战=战斗大厅，故事=对应关卡场景）
  UI.setBattleBg = function (src) {
    const el = $('battle-bg');
    if (!el) return;
    if (src) {
      el.style.backgroundImage = 'url("' + src + '")';
    } else {
      el.style.backgroundImage = '';
    }
  };

  global.UI = UI;
})(window);
