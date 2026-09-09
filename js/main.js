/*
 * main.js —— 2.0 主控制器
 * 主菜单（故事/自由对战/图鉴/说明/设置）→ 各入口；保留自由对战事件绑定。
 */
(function (global) {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const CardData = global.CardData;
  const Characters = global.Characters;
  const Game = global.Game;
  const UI = global.UI;

  let selectedCharId = null;

  // ------------------------------------------------------------------
  // 角色选择（自由对战）
  // ------------------------------------------------------------------
  function resetSelectUI() {
    selectedCharId = null;
    $('btn-start').disabled = true;
    $('select-hint').textContent = '👆 点击角色卡选择你要使用的角色';
    document.querySelectorAll('.char-card').forEach(function (el) {
      el.classList.remove('selected');
    });
  }

  function renderCharacterSelect() {
    const container = $('char-cards');
    const html = Object.keys(Characters.CHARACTERS).map(function (id) {
      const c = Characters.CHARACTERS[id];
      const total = c.deckSpec.reduce(function (sum, d) { return sum + d.count; }, 0);
      return '<div class="char-card" data-char="' + id + '">' +
        '<div class="char-emoji">' + (c.art
          ? '<img class="av-img" src="' + c.art + '" alt="' + c.name + '">'
          : c.emoji) + '</div>' +
        '<div class="char-name">' + c.name + '</div>' +
        '<div class="char-tag">' + c.tagline + '</div>' +
        '<ul class="char-stats">' +
        '<li><span>HP</span><b>' + c.maxHp + '</b></li>' +
        '<li><span>攻击</span><b>' + c.attack + '</b></li>' +
        '<li><span>防御</span><b>' + c.defense + '</b></li>' +
        '<li><span>速度</span><b>' + c.speed + '</b></li>' +
        '</ul>' +
        '<div class="char-deck">' + total + ' 张牌组</div>' +
        '</div>';
    }).join('');
    container.innerHTML = html;
    container.addEventListener('click', function (e) {
      const cardEl = e.target.closest('.char-card');
      if (!cardEl) return;
      selectCharacter(cardEl.dataset.char);
    });
  }

  function selectCharacter(id) {
    selectedCharId = id;
    document.querySelectorAll('.char-card').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.char === id);
    });
    const aiCharId = id === 'sun_xiaochuan' ? 'takaichi_sanae' : 'sun_xiaochuan';
    const ai = Characters.CHARACTERS[aiCharId];
    $('select-hint').textContent =
      '你选择了 ' + Characters.CHARACTERS[id].name + ' ' + Characters.CHARACTERS[id].emoji +
      '　｜　🤖 AI 将使用 ' + ai.name + ' ' + ai.emoji;
    $('btn-start').disabled = false;
    UI.sound.play('click');
  }

  function startFreeBattle() {
    if (!selectedCharId) { UI.toast('请先选择角色'); return; }
    // v2.1 美术重制：自由对战使用战斗大厅底图
    if (typeof UI.setBattleBg === 'function') {
      UI.setBattleBg('assets/img/art/ui/battle_bg.png');
    }
    UI.showBattleScreen();
    Game.restart();
    const auto = $('cb-auto') ? $('cb-auto').checked : false;
    Game.startBattle(selectedCharId, { auto: auto });
  }

  // ------------------------------------------------------------------
  // 图鉴
  // ------------------------------------------------------------------
  let codexMode = 'cards';

  function openCodex(mode) {
    codexMode = mode || 'cards';
    $('codex-overlay').classList.remove('hidden');
    $('codex-tab-cards').classList.toggle('on', codexMode === 'cards');
    $('codex-tab-status').classList.toggle('on', codexMode === 'status');
    renderCodex();
    UI.sound.play('click');
  }

  function deckCounts() {
    const map = {};
    Object.keys(Characters.CHARACTERS).forEach(function (cid) {
      Characters.CHARACTERS[cid].deckSpec.forEach(function (d) {
        map[d.id] = (map[d.id] || 0) + d.count;
      });
    });
    return map;
  }

  function renderCodex() {
    const listEl = $('codex-list');
    const prevEl = $('codex-preview');
    prevEl.classList.add('hidden');
    if (codexMode === 'cards') {
      const counts = deckCounts();
      const html = Object.keys(CardData.CARD_DEFS).map(function (id) {
        const def = CardData.CARD_DEFS[id];
        const meta = CardData.TYPE_META[def.type] || {};
        const cnt = counts[id] || 0;
        return '<div class="codex-item codex-card ctype-' + def.type + '" data-id="' + id + '">' +
          '<span class="cx-cost">' + def.cost + '</span>' +
          '<div class="cx-name">' + (meta.icon || '') + ' ' + def.name + '</div>' +
          '<div class="cx-sub">' + (meta.label || def.type) + (cnt ? ' · 牌组×' + cnt : ' · 被动/事件牌') + '</div>' +
          '<div class="cx-desc">' + def.desc + '</div>' +
          '</div>';
      }).join('');
      listEl.innerHTML = html || '暂无卡牌';
    } else {
      const html = Object.keys(CardData.STATUS_DEFS).map(function (id) {
        const d = CardData.STATUS_DEFS[id];
        const cat = d.category || (d.kind === 'buff' ? '增益' : '负面');
        const dur = d.untilOwnTurn ? '持续至自己下回合开始' : ('默认 ' + (d.duration || 2) + ' 回合');
        return '<div class="codex-item codex-status" data-id="' + id + '">' +
          '<div class="cx-name">' + d.icon + ' ' + d.name + '</div>' +
          '<div class="cx-sub">' + (d.kind === 'buff' ? '增益' : '负面') + ' · ' + dur +
          (d.category ? ' · 同类不叠加' : '') + '</div>' +
          '<div class="cx-desc">' + d.desc + '</div>' +
          '</div>';
      }).join('');
      listEl.innerHTML = html || '暂无状态';
    }
  }

  function bindCodexEvents() {
    $('codex-tab-cards').addEventListener('click', function () { openCodex('cards'); });
    $('codex-tab-status').addEventListener('click', function () { openCodex('status'); });
    $('codex-close').addEventListener('click', function () { $('codex-overlay').classList.add('hidden'); });
    $('codex-overlay').addEventListener('click', function (e) {
      if (e.target === $('codex-overlay')) $('codex-overlay').classList.add('hidden');
    });
    $('codex-list').addEventListener('click', function (e) {
      const item = e.target.closest('.codex-item');
      if (!item) return;
      const id = item.dataset.id;
      const prev = $('codex-preview');
      if (codexMode === 'cards') {
        const def = CardData.CARD_DEFS[id];
        if (!def) return;
        prev.innerHTML = '<div class="codex-prev-inner">' + UI.cardHtml(def, { cost: def.cost }) +
          '<button class="btn btn-ghost" data-close-prev>关闭</button></div>';
      } else {
        const d = CardData.STATUS_DEFS[id];
        if (!d) return;
        prev.innerHTML = '<div class="codex-prev-inner codex-prev-status"><span class="ps-icon">' + d.icon + '</span>' +
          '<b>' + d.name + '</b><p>' + d.desc + '</p>' +
          '<button class="btn btn-ghost" data-close-prev>关闭</button></div>';
      }
      prev.classList.remove('hidden');
      const close = prev.querySelector('[data-close-prev]');
      if (close) close.addEventListener('click', function () { prev.classList.add('hidden'); });
    });
  }

  // ------------------------------------------------------------------
  // 设置
  // ------------------------------------------------------------------
  const TYPING = [{ ms: 24, name: '普通' }, { ms: 10, name: '快' }, { ms: 3, name: '极速' }];
  let typingIdx = 0;

  function bindSettingsEvents() {
    const sync = function () {
      $('set-sound').textContent = UI.sound.enabled ? '开启 🔊' : '关闭 🔇';
      $('set-typing').textContent = TYPING[typingIdx].name;
      $('set-speed').textContent = (Game.state.animSpeed || 1) + 'x';
    };
    $('btn-settings').addEventListener('click', function () { sync(); $('settings-overlay').classList.remove('hidden'); UI.sound.play('click'); });
    $('set-close').addEventListener('click', function () { $('settings-overlay').classList.add('hidden'); });
    $('settings-overlay').addEventListener('click', function (e) {
      if (e.target === $('settings-overlay')) $('settings-overlay').classList.add('hidden');
    });
    $('set-sound').addEventListener('click', function () {
      UI.sound.enabled = !UI.sound.enabled;
      sync(); UI.sound.play('click');
    });
    $('set-typing').addEventListener('click', function () {
      typingIdx = (typingIdx + 1) % TYPING.length;
      if (global.StoryDialogue) StoryDialogue.setSpeed(TYPING[typingIdx].ms);
      sync(); UI.sound.play('click');
    });
    $('set-speed').addEventListener('click', function () {
      const cur = Game.state.animSpeed || 1;
      Game.state.animSpeed = cur >= 4 ? 1 : cur * 2;
      sync(); UI.sound.play('click');
    });
  }

  // 全局错误上屏：任何运行异常都会以 Toast 显示，方便定位与自愈
  function bindErrorTrap() {
    if (!global.addEventListener) return;
    global.addEventListener('error', function (ev) {
      if (UI && typeof UI.toast === 'function') {
        UI.toast('⚠️ 运行错误：' + ((ev && ev.message) || '未知错误'), 6000);
      }
    });
    global.addEventListener('unhandledrejection', function (ev) {
      const m = (ev && ev.reason && ev.reason.message) || '异步错误';
      if (UI && typeof UI.toast === 'function') UI.toast('⚠️ ' + m, 6000);
    });
  }

  // ------------------------------------------------------------------
  // 战斗交互（自由对战 + 故事战斗共用）
  // ------------------------------------------------------------------
  function bindBattleEvents() {
    $('hand').addEventListener('click', function (e) {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const index = parseInt(cardEl.dataset.index, 10);
      if (!UI.canAct()) return;
      const wasSelected = Game.state.selectedCardIndex === index;
      Game.playerSelectCard(index);
      if (wasSelected) {
        UI.closeDetail();
      } else if (Game.state.selectedCardIndex === index &&
                 Game.state.phase === Game.PHASE.ACTION && !Game.isOver()) {
        UI.openDetail(index);
      }
      UI.sound.play('click');
    });

    $('btn-play').addEventListener('click', function () {
      if (!UI.canAct()) return;
      Game.playerPlaySelected();
      UI.closeDetail();
    });
    $('btn-detail-play').addEventListener('click', function () {
      if (!UI.canAct()) return;
      Game.playerPlaySelected();
      UI.closeDetail();
    });
    $('btn-detail-close').addEventListener('click', function () { UI.closeDetail(); });

    $('btn-end').addEventListener('click', function () {
      if (!UI.canAct()) return;
      UI.sound.play('click');
      Game.playerEndTurn();
      UI.refresh();
    });

    $('btn-discard-ap').addEventListener('click', function () {
      if (!UI.canAct()) return;
      const G = Game;
      if (G.state.player.discardUsedThisTurn) { UI.toast('本回合已经使用过「弃牌换 AP」'); return; }
      if (G.state.player.hand.length === 0) { UI.toast('没有手牌可以弃'); return; }
      UI.sound.play('click');
      UI.showApDiscard();
    });
    $('apdiscard-list').addEventListener('click', function (e) {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const index = parseInt(cardEl.dataset.index, 10);
      const res = Game.playerDiscardForAp(index);
      if (res.ok) {
        UI.sound.play('heal');
        UI.hideApDiscard();
        Game.refreshUI();
      } else if (res.reason === 'used') {
        UI.toast('本回合已经使用过');
      }
    });
    $('btn-apdiscard-cancel').addEventListener('click', function () { UI.hideApDiscard(); });

    $('item-row').addEventListener('click', function (e) {
      const chip = e.target.closest('.item-chip');
      if (!chip) return;
      if (!UI.canAct()) return;
      const index = parseInt(chip.dataset.index, 10);
      const res = Game.useItem('player', index);
      if (res && !res.ok && res.reason === 'siege') {
        UI.toast('「狗粉丝围攻」下无法使用道具');
      }
      Game.refreshUI();
    });

    $('overflow-list').addEventListener('click', function (e) {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const G = Game;
      if (G.state.phase !== G.PHASE.OVERFLOW) return;
      const index = parseInt(cardEl.dataset.index, 10);
      if (index < 0 || index >= G.state.player.hand.length) return;
      UI.sound.play('click');
      G.discardCardAt('player', index, '为腾出手牌空间弃掉「' + G.state.player.hand[index].def.name + '」');
      G.state.pendingOverflowDiscards = Math.max(0, G.state.pendingOverflowDiscards - 1);
      if (G.state.pendingOverflowDiscards === 0) G.onOverflowDone();
      Game.refreshUI();
    });

    document.addEventListener('click', function (e) {
      const chip = e.target.closest('.status-chip');
      if (!chip) return;
      const statusId = chip.dataset.status;
      const d = Game.getStatusDef(statusId);
      if (!d) return;
      const key = chip.dataset.key;
      const dur = Game.getStatusDuration(key, statusId);
      const durText = d.untilOwnTurn ? '直到自己下回合开始' : '剩余 ' + dur + ' 回合';
      UI.toast(d.icon + ' ' + d.name + '：' + d.desc + '（' + durText + '）', 2600);
    });

    $('btn-auto').addEventListener('click', function () {
      if (Game.isOver()) return;
      Game.setPlayerAuto(!Game.state.playerAuto);
      UI.sound.play('click');
      UI.refresh();
    });
    $('btn-speed').addEventListener('click', function () {
      if (Game.isOver()) return;
      const cur = Game.state.animSpeed || 1;
      Game.state.animSpeed = cur >= 4 ? 1 : cur * 2;
      UI.sound.play('click');
      UI.refresh();
    });
  }

  // ------------------------------------------------------------------
  // 首页 / 通用
  // ------------------------------------------------------------------
  function bindHomeEvents() {
    $('btn-free').addEventListener('click', function () {
      resetSelectUI();
      UI.showSelectScreen();
      UI.sound.play('click');
    });
    $('btn-story').addEventListener('click', function () {
      UI.sound.play('click');
      global.Story.enter();
    });
    $('btn-codex').addEventListener('click', function () { openCodex('cards'); });
    $('btn-status-codex').addEventListener('click', function () { openCodex('status'); });

    $('btn-start').addEventListener('click', startFreeBattle);

    $('btn-rules').addEventListener('click', function () { UI.showRules(); UI.sound.play('click'); });
    $('btn-rules-close').addEventListener('click', function () { UI.hideRules(); });
    $('rules-overlay').addEventListener('click', function (e) {
      if (e.target === $('rules-overlay')) UI.hideRules();
    });

    $('btn-dev-statement').addEventListener('click', function () {
      $('dev-overlay').classList.remove('hidden');
      UI.sound.play('click');
    });
    $('btn-dev-close').addEventListener('click', function () {
      $('dev-overlay').classList.add('hidden');
    });
    $('dev-overlay').addEventListener('click', function (e) {
      if (e.target === $('dev-overlay')) $('dev-overlay').classList.add('hidden');
    });

    $('btn-home-back').addEventListener('click', function () {
      resetSelectUI();
      UI.showHomeScreen();
      UI.sound.play('click');
    });
    $('btn-restart').addEventListener('click', function () {
      Game.restart();
      resetSelectUI();
      UI.showSelectScreen();
      UI.sound.play('click');
    });

    $('btn-sound').addEventListener('click', function () {
      UI.sound.enabled = !UI.sound.enabled;
      this.textContent = UI.sound.enabled ? '🔊' : '🔇';
      UI.sound.play('click');
    });

    document.addEventListener('pointerdown', function once() {
      UI.sound.ensure();
      document.removeEventListener('pointerdown', once);
    });
  }

  // ------------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------------
  function boot() {
    UI.init();
    renderCharacterSelect();
    bindBattleEvents();
    bindHomeEvents();
    bindCodexEvents();
    bindSettingsEvents();
    bindErrorTrap();
    UI.showHomeScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
