/*
 * main.js
 * 游戏初始化：角色选择渲染、事件绑定、开始/重新开始。
 */
(function (global) {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  let selectedCharId = null;

  // 清空上一局的角色选择状态，回到“未选择”状态
  function resetSelectUI() {
    selectedCharId = null;
    $('btn-start').disabled = true;
    $('select-hint').textContent = '👆 点击角色卡选择你要使用的角色';
    document.querySelectorAll('.char-card').forEach(function (el) {
      el.classList.remove('selected');
    });
  }

  // ------------------------------------------------------------------
  // 角色选择
  // ------------------------------------------------------------------
  function renderCharacterSelect() {
    const container = $('char-cards');
    const html = Object.keys(Characters.CHARACTERS).map(function (id) {
      const c = Characters.CHARACTERS[id];
      const total = c.deckSpec.reduce(function (sum, d) { return sum + d.count; }, 0);
      return '<div class="char-card" data-char="' + id + '">' +
        '<div class="char-emoji">' + c.emoji + '</div>' +
        '<div class="char-name">' + c.name + '</div>' +
        '<div class="char-tag">' + c.tagline + '</div>' +
        '<ul class="char-stats">' +
        '<li><span>HP</span><b>' + c.maxHp + '</b></li>' +
        '<li><span>攻击</span><b>' + c.attack + '</b></li>' +
        '<li><span>防御</span><b>' + c.defense + '</b></li>' +
        '<li><span>速度</span><b>' + c.speed + '</b></li>' +
        '</ul>' +
        '<div class="char-deck">20 张牌组 · ' + total + ' 张</div>' +
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
    const cards = document.querySelectorAll('.char-card');
    cards.forEach(function (el) {
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

  function startBattle() {
    if (!selectedCharId) {
      UI.toast('请先选择角色');
      return;
    }
    UI.showBattleScreen();
    Game.restart();
    Game.startBattle(selectedCharId);
  }

  // ------------------------------------------------------------------
  // 战斗交互
  // ------------------------------------------------------------------
  function bindBattleEvents() {
    // 手牌：点击选择 / 再点已选则直接出牌
    $('hand').addEventListener('click', function (e) {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const index = parseInt(cardEl.dataset.index, 10);
      if (!UI.canAct()) return;

      const G = Game;
      const wasSelected = G.state.selectedCardIndex === index;
      G.playerSelectCard(index);

      if (wasSelected) {
        UI.closeDetail();
      } else if (G.state.selectedCardIndex === index &&
                 G.state.phase === G.PHASE.ACTION &&
                 !G.isOver()) {
        UI.openDetail(index);
      }
      UI.sound.play('click');
    });

    // 出牌按钮（底栏）
    $('btn-play').addEventListener('click', function () {
      if (!UI.canAct()) return;
      Game.playerPlaySelected();
      UI.closeDetail();
    });

    // 卡牌详情弹层出牌
    $('btn-detail-play').addEventListener('click', function () {
      if (!UI.canAct()) return;
      Game.playerPlaySelected();
      UI.closeDetail();
    });
    $('btn-detail-close').addEventListener('click', function () {
      UI.closeDetail();
    });

    // 结束回合
    $('btn-end').addEventListener('click', function () {
      if (!UI.canAct()) return;
      UI.sound.play('click');
      Game.playerEndTurn();
      UI.refresh();
    });

    // 弃牌换 AP
    $('btn-discard-ap').addEventListener('click', function () {
      if (!UI.canAct()) return;
      const G = Game;
      if (G.state.player.discardUsedThisTurn) {
        UI.toast('本回合已经使用过「弃牌换 AP」');
        return;
      }
      if (G.state.player.hand.length === 0) {
        UI.toast('没有手牌可以弃');
        return;
      }
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
    $('btn-apdiscard-cancel').addEventListener('click', function () {
      UI.hideApDiscard();
    });

    // 道具
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

    // 手牌超限弃牌
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
      if (G.state.pendingOverflowDiscards === 0) {
        G.onOverflowDone();
      }
      Game.refreshUI();
    });

    // 状态点击查看详情
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
  }

  // ------------------------------------------------------------------
  // 通用按钮
  // ------------------------------------------------------------------
  function bindCommonEvents() {
    // 首页 → 进入游戏 / 开发者声明 / 返回首页
    $('btn-play-now').addEventListener('click', function () {
      resetSelectUI();
      UI.showSelectScreen();
      UI.sound.play('click');
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

    $('btn-start').addEventListener('click', startBattle);

    $('btn-rules').addEventListener('click', function () {
      UI.showRules();
      UI.sound.play('click');
    });
    $('btn-rules-close').addEventListener('click', function () {
      UI.hideRules();
    });
    $('rules-overlay').addEventListener('click', function (e) {
      if (e.target === $('rules-overlay')) UI.hideRules();
    });

    $('btn-restart').addEventListener('click', function () {
      Game.restart();
      resetSelectUI();
      UI.showSelectScreen();
      UI.sound.play('click');
    });

    // 音效开关
    $('btn-sound').addEventListener('click', function () {
      UI.sound.enabled = !UI.sound.enabled;
      this.textContent = UI.sound.enabled ? '🔊' : '🔇';
      UI.sound.play('click');
    });

    // 第一次交互时解锁音频
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
    bindCommonEvents();
    UI.showHomeScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
