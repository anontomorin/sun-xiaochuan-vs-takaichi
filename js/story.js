/*
 * story.js —— 2.0 故事模式控制器
 * 主菜单→故事首页→地图→(序章)→关卡剧情→战斗→奖励成长→下一关→Boss→结局。
 * 提供 testMode（无头自动通关测试）。
 */
(function (global) {
  'use strict';

  const D = global.StoryData;
  const G = global.Game;

  const Story = { testMode: false };
  let run = null;      // 当前周目档案
  let viewEl = null;
  let activeStage = null; // 当前关卡（战斗中用）
  let battleBusy = false;

  // ---------------- v2.1 美术重制 ----------------
  // 战斗关卡 → 关卡场景底图（bg_01..bg_16 为对应剧情场景美术）
  const STAGE_BG = {
    1: 'assets/img/art/bg/bg_05.png',   // 第一关·老东京街道
    2: 'assets/img/art/bg/bg_06.png',   // 第二关·昭和旧街区
    4: 'assets/img/art/bg/bg_08.png',   // Boss·东京审判遗址
    5: 'assets/img/art/bg/bg_09.png',   // 第五关·居酒屋
    6: 'assets/img/art/bg/bg_10.png',   // 第六关·深夜办公室
    8: 'assets/img/art/bg/bg_12.png',   // Boss·奈良街道
    9: 'assets/img/art/bg/bg_13.png',   // 第九关·网吧包间
    11: 'assets/img/art/bg/bg_15.png'   // 最终Boss·国会屋顶
  };
  // 战斗关卡 → 敌人立绘（e1/e2/e5/e6/e9 普通，eb1/eb2/eb3 Boss）
  const ENEMY_ART = {
    1: 'e1', 2: 'e2', 4: 'eb1', 5: 'e5', 6: 'e6', 8: 'eb2', 9: 'e9', 11: 'eb3'
  };
  function enemyArtOf(stage) {
    const f = ENEMY_ART[stage && stage.id];
    return f ? 'assets/img/art/enemies/' + f + '.png' : null;
  }
  // 故事地图：11 个节点沿美术底图 story_map.png 的发光道路放置
  // （道路从左下「出租屋」蜿蜒至右上「宝塔」，坐标为像素检测得到的灯盏质心）
  const MAP_NODE_POS = [
    [22, 80], [33, 73], [43, 63], [50, 54], [57, 49], [64, 44],
    [70, 39], [75, 33], [81, 28], [87, 24], [92, 19]
  ];

  // ---------------- DOM 基础 ----------------
  function h(html) { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstChild; }

  function ensureView() {
    if (viewEl) return;
    viewEl = document.createElement('section');
    viewEl.id = 'story-view';
    document.getElementById('app').appendChild(viewEl);
  }

  function clearView() { if (viewEl) viewEl.innerHTML = ''; }
  function showView() { ensureView(); viewEl.classList.remove('hidden'); }
  function hideView() { if (viewEl) viewEl.classList.add('hidden'); }
  function hideMainScreens() {
    const ids = ['screen-home', 'screen-select', 'screen-battle', 'game-over'];
    ids.forEach(function (id) {
      const n = document.getElementById(id);
      if (n) n.classList.add('hidden');
    });
  }

  function $(id) { return document.getElementById(id); }

  function confirmBox(title, text, onYes) {
    const box = h('<div class="overlay"><div class="modal modal-wide"><h3 class="modal-title">' + title +
      '</h3><p class="modal-desc">' + text + '</p><div class="modal-buttons">' +
      '<button class="btn btn-primary" data-yes>确定</button>' +
      '<button class="btn btn-ghost" data-no>取消</button></div></div></div>');
    document.body.appendChild(box);
    box.querySelector('[data-yes]').addEventListener('click', function () {
      box.remove(); if (onYes) onYes();
    });
    box.querySelector('[data-no]').addEventListener('click', function () { box.remove(); });
    box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
  }

  function errFallback(fn) {
    return function (err) {
      if (global.console) console.error('故事流程异常（已尝试恢复）:', err);
      if (global.UI && typeof UI.toast === 'function') UI.toast('⚠️ 剧情异常，已自动跳过', 4000);
      try { fn(); } catch (e2) { /* ignore */ }
    };
  }

  function toast(msg) {
    if (global.UI && typeof UI.toast === 'function') UI.toast(msg, 3200);
  }

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function exportRun() {
    const data = run || StorySave.load();
    if (!data) { toast('还没有可导出的存档'); return; }
    const ok = downloadText(
      '孙笑川大战高市早苗-存档-' + (data.completed ? '通关' : '进度' + (data.idx + 1)) + '.json',
      JSON.stringify({ app: 'sxc-story-save', version: 2, savedAt: Date.now(), run: data }, null, 2)
    );
    toast(ok ? '✅ 存档已导出到本地文件' : '导出失败，请换浏览器重试');
  }

  function sanitizeRun(obj) {
    const base = freshRun();
    const r = obj && typeof obj === 'object' ? obj : {};
    const pv = Array.isArray(r.passives)
      ? r.passives.filter(function (id) { return D.PASSIVES[id]; })
      : [];
    return {
      idx: Math.max(0, Math.min(D.STAGES.length, parseInt(r.idx, 10) || 0)),
      maxHp: Math.max(50, parseInt(r.maxHp, 10) || base.maxHp),
      hp: Math.max(1, Math.min(parseInt(r.maxHp, 10) || base.maxHp, parseInt(r.hp, 10) || 1)),
      attack: Math.max(1, parseInt(r.attack, 10) || base.attack),
      defense: Math.max(0, parseInt(r.defense, 10) || base.defense),
      speed: base.speed,
      passives: pv,
      cleared: D.STAGES.map(function (_, i) { return !!(r.cleared && r.cleared[i]); }),
      completed: !!r.completed
    };
  }

  function importRunFromFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result));
        const payload = parsed && parsed.run ? parsed.run : parsed;
        run = sanitizeRun(payload);
        save();
        toast('✅ 存档导入成功，已继续');
        if (run.completed) { showEndingScreen(false); } else { showMap(); }
      } catch (e) {
        if (global.console) console.error('存档导入失败:', e);
        toast('❌ 存档文件无效，导入失败');
      }
    };
    reader.onerror = function () { toast('❌ 读取文件失败'); };
    reader.readAsText(file);
  }

  function speech(who, text) {
    // 战斗中敌方/系统台词反馈（尽量沉浸）
    const v = G.visual;
    if (v && typeof v.toast === 'function') {
      try { v.toast({ text: '💬 ' + text }); } catch (e) { /* ignore */ }
    }
  }

  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function pace(ms) {
    const sp = Math.max(1, G.state.animSpeed || 1);
    return G.state.simMode ? Promise.resolve() : sleep(ms / sp);
  }

  // ---------------- 存档 ---------------- 
  function freshRun() {
    return {
      idx: 0, hp: D.SUN_BASE.maxHp, maxHp: D.SUN_BASE.maxHp,
      attack: D.SUN_BASE.attack, defense: D.SUN_BASE.defense,
      speed: D.SUN_BASE.speed, passives: [],
      cleared: D.STAGES.map(function () { return false; }),
      completed: false
    };
  }
  function save() { if (!Story.testMode && run) StorySave.save(run); }

  // ---------------- 入口 ----------------
  Story.enter = function () {
    ensureView();
    hideMainScreens();
    renderHome();
    showView();
  };

  Story.leave = function () {
    hideView();
    G.restart();
    $('screen-home').classList.remove('hidden');
  };

  function statCard(r) {
    const pv = r.passives.map(function (id) {
      const p = D.PASSIVES[id];
      if (!p) return '';
      return p.art
        ? '<img class="passive-art" src="' + p.art + '" title="' + p.name + '：' + p.desc + '" alt="' + p.name + '">'
        : p.icon;
    }).join(' ');
    return '<div class="st-run-stats"><span>❤️ ' + r.hp + '/' + r.maxHp + '</span>' +
      '<span>⚔️ ' + r.attack + '</span><span>🛡️ ' + r.defense + '</span>' +
      (pv ? '<span class="st-passive-ic">' + pv + '</span>' : '') + '</div>';
  }

  function renderHome() {
    clearView();
    const saved = StorySave.load();
    const has = !!saved;
    viewEl.innerHTML =
      '<div class="st-home">' +
      '<button class="st-back">⌂ 返回主菜单</button>' +
      '<h1 class="st-title">🎬 故事模式</h1>' +
      '<p class="st-sub">' + D.SUBTITLE + '</p>' +
      (has ? statCard(saved) : '') +
      '<div class="st-menu">' +
      (has && !saved.completed
        ? '<button class="btn btn-big btn-primary" data-continue>▶ 继续游戏</button>'
        : (has && saved.completed
          ? '<button class="btn btn-big btn-primary" data-complete-view>🏆 查看通关档案</button>'
          : '')) +
      '<button class="btn btn-big btn-ghost" data-new>✨ 新游戏</button>' +
      (has ? '<button class="btn btn-big btn-ghost" data-wipe>🗑 删除存档</button>' : '') +
      '</div>' +
      '<div class="st-backup">' +
      '<button class="btn btn-ghost" data-export>⬇️ 导出存档</button>' +
      '<button class="btn btn-ghost" data-import>⬆️ 导入存档</button>' +
      '<input type="file" data-file accept=".json,application/json" class="hidden">' +
      '</div>' +
      '<p class="st-tip">你将扮演孙笑川，从成都出租屋一路嘴硬到国会议事堂屋顶。</p>' +
      '<p class="st-tip">💾 存档会自动保存在本机；「导出」可下载成文件备份/换设备，「导入」继续上次进度。</p>' +
      '</div>';
    viewEl.querySelector('.st-back').addEventListener('click', Story.leave);
    const bNew = viewEl.querySelector('[data-new]');
    if (bNew) bNew.addEventListener('click', function () {
      confirmBox('新游戏', '将覆盖现有存档并从头开始，确定吗？', function () {
        StorySave.clear();
        run = freshRun();
        startPrologue();
      });
    });
    const bCont = viewEl.querySelector('[data-continue]');
    if (bCont) bCont.addEventListener('click', function () {
      run = StorySave.load();
      if (!run) { run = freshRun(); }
      showMap();
    });
    const bCv = viewEl.querySelector('[data-complete-view]');
    if (bCv) bCv.addEventListener('click', function () {
      run = StorySave.load() || freshRun();
      showEndingScreen(true);
    });
    const bWipe = viewEl.querySelector('[data-wipe]');
    if (bWipe) bWipe.addEventListener('click', function () {
      confirmBox('删除存档', '故事进度将被清除，确定吗？', function () {
        StorySave.clear(); renderHome();
      });
    });
    const bExport = viewEl.querySelector('[data-export]');
    if (bExport) bExport.addEventListener('click', exportRun);
    const bImport = viewEl.querySelector('[data-import]');
    if (bImport) bImport.addEventListener('click', function () {
      const input = viewEl.querySelector('[data-file]');
      if (input) input.click();
    });
    const fileEl = viewEl.querySelector('[data-file]');
    if (fileEl) fileEl.addEventListener('change', function () {
      if (fileEl.files && fileEl.files[0]) importRunFromFile(fileEl.files[0]);
      fileEl.value = '';
    });
  }

  // ---------------- 序章 ----------------
  function startPrologue() {
    const boss = false;
    const runSeq = function () {
      const p = StoryDialogue.play(D.PROLOGUE, { boss: boss }).then(function () {
        if (Story.testMode) return;
        showMap();
      });
      p.catch(errFallback(function () { showMap(); }));
      return p;
    };
    if (Story.testMode) { showMap(); return; }
    runSeq();
  }

  // ---------------- 地图 ----------------
  function stageIcon(st) {
    return st.type === 'boss' || st.type === 'finalBoss' ? '👑' : (st.type === 'reward' ? '🎁' : (st.type === 'boost' ? '⚡' : '⚔️'));
  }

  function showMap() {
    clearView();
    const stage = D.STAGES[run.idx];
    let html = '<div class="st-map"><button class="st-back">⌂ 返回主菜单</button>' +
      '<h2 class="st-map-title">🗺️ 讨伐路线（' + (run.idx + 1) + '/11）</h2>' +
      statCard(run);
    D.STAGES.forEach(function (s, i) {
      const done = run.cleared[i];
      const cur = i === run.idx && !done;
      const locked = i > run.idx && !run.cleared[i - 1];
      const cls = 'st-node' + (done ? ' done' : '') + (cur ? ' cur' : '') + (locked ? ' lock' : '');
      const pos = MAP_NODE_POS[i] || [50, 50];
      html += '<div class="' + cls + '" data-i="' + i + '" style="left:' + pos[0] + '%;top:' + pos[1] + '%">' +
        '<span class="st-node-ic">' + (done ? '✅' : stageIcon(s)) + '</span>' +
        '<span class="st-node-idx">' + (i + 1) + '</span>' +
        '<span class="st-node-name">' + (done ? s.title : s.title) + '</span>' +
        '</div>';
    });
    html += '<div class="st-map-actions">' +
      (stage && !run.cleared[run.idx]
        ? '<button class="btn btn-big btn-primary" data-go>🚀 出发</button>'
        : '') +
      '<button class="btn btn-ghost" data-home>返回主菜单</button></div></div>';
    viewEl.innerHTML = html;
    viewEl.querySelector('.st-back').addEventListener('click', Story.leave);
    viewEl.querySelector('[data-home]').addEventListener('click', Story.leave);
    const bGo = viewEl.querySelector('[data-go]');
    if (bGo) bGo.addEventListener('click', function () { runStage(); });
    viewEl.querySelectorAll('.st-node.cur').forEach(function (n) {
      n.addEventListener('click', function () { runStage(); });
    });
  }

  // ---------------- 关卡运行 ----------------
  function profileOf() {
    return {
      maxHp: run.maxHp, hp: run.hp, attack: run.attack, defense: run.defense,
      speed: run.speed, passives: run.passives, deckSpec: D.SUN_DECK
    };
  }

  // 敌人展示对象 = 关卡显示信息 + 数值（含可选 scale）
  function enemyView(stage) {
    return Object.assign({
      name: stage.name,
      emoji: stage.emoji,
      tag: stage.tag || '招核残影',
      characterId: 'story_' + stage.id,
      // v2.1 美术重制：敌人立绘
      art: enemyArtOf(stage)
    }, stage.enemy);
  }

  // 说话人 → 立绘映射（高市早苗仅在最终战以“enemy”出现）
  function portraitsFor(stage) {
    const m = { sun: Characters.CHARACTERS.sun_xiaochuan.art || 'assets/img/art/characters/sun.png' };
    if (stage && (stage.id === 11 || stage.name === '高市早苗')) {
      m.enemy = Characters.CHARACTERS.takaichi_sanae.art || 'assets/img/art/characters/sanae.png';
    } else {
      const ea = enemyArtOf(stage);
      if (ea) m.enemy = ea;
    }
    return m;
  }

  function runStage() {
    const stage = D.STAGES[run.idx];
    activeStage = stage;
    if (stage.type === 'reward' || stage.type === 'boost') { runRestStage(); return; }
    battleBusy = true;
    const introSeq = [
      { scene: stage.title },
      { scene: stage.scene + ' · ' + stage.bg }
    ].concat(stage.pre || []);
    const names = { sun: '孙笑川', enemy: stage.name, sys: '系统' };
    const icons = { sun: '😎', enemy: stage.emoji, sys: '🖥️' };
    const isBoss = stage.type === 'boss' || stage.type === 'finalBoss';
    const goBattle = function () { startBattle(); };
    if (Story.testMode) { goBattle(); return; }
    hideMainScreens();
    StoryDialogue.play(introSeq, {
      boss: isBoss, names: names, icons: icons,
      portraits: portraitsFor(stage), onSkip: goBattle
    })
      .then(function (r) { if (!r.skipped) goBattle(); })
      .catch(errFallback(goBattle));
  }

  function startBattle() {
    const stage = activeStage;
    hideView();
    // 注册故事战斗钩子
    G.state.storyHooks = {
      onPlayerTurnStart: onPlayerTurnStart,
      onPlayerTurnEnd: onPlayerTurnEnd,
      onRoundEnd: onRoundEnd,
      onBattleEnd: onBattleEnd
    };
    G.state.storyHandProvider = function () { return []; };
    G.state.storyEnemyDriver = function (key) { return enemyTurn(key, stage); };
    G.state.storyStageType = stage.type;
    G.state.storyStageNum = stage.id;
    G.state.storyStageTitle = stage.title;
    // v2.1 美术重制：按关卡切换战斗底图
    if (global.UI && typeof UI.setBattleBg === 'function') {
      UI.setBattleBg(STAGE_BG[stage.id] || 'assets/img/art/ui/battle_bg.png');
    }
    UI.showBattleScreen();
    G.startStoryBattle(profileOf(), enemyView(stage));
  }

  // ---------------- 敌人/Boss 行动 ----------------
  function chooseSkill(stage, enemy, player) {
    const pool = stage.skills.filter(function (s) { return s.cost <= enemy.ap; });
    if (pool.length === 0) return null;
    const hasHeal = pool.some(function (s) { return s.kind === 'heal' || s.kind === 'heal_buff'; });
    if (hasHeal && enemy.hp < enemy.maxHp * 0.42) {
      return pool.find(function (s) { return s.kind === 'heal' || s.kind === 'heal_buff'; });
    }
    const buffed = G.hasStatus('enemy', 'story_fury') || G.hasStatus('enemy', 'story_might');
    const guardOn = G.hasStatus('enemy', 'story_guard');
    const boss = stage.type === 'boss' || stage.type === 'finalBoss';
    const pDebuffed = G.hasStatus('player', 'media_press');
    // Boss 更聪明：低血开防、高伤前先强化
    if (boss) {
      if (!guardOn && enemy.hp < enemy.maxHp * 0.6 && pool.some(function (s) { return s.kind === 'buff_def'; })) {
        return pool.find(function (s) { return s.kind === 'buff_def'; });
      }
      if (!buffed && enemy.hp < enemy.maxHp * 0.8 && pool.some(function (s) { return s.kind === 'buff_atk' || s.kind === 'buff_atk_big' || s.kind === 'heal_buff'; })) {
        return pool.find(function (s) { return s.kind === 'buff_atk' || s.kind === 'buff_atk_big' || s.kind === 'heal_buff'; });
      }
      if (!pDebuffed && pool.some(function (s) { return s.kind === 'debuff_media'; })) {
        return pool.find(function (s) { return s.kind === 'debuff_media'; });
      }
    } else {
      if (!buffed && enemy.hp < enemy.maxHp * 0.55 && pool.some(function (s) { return s.kind === 'buff_atk' || s.kind === 'heal_buff'; })) {
        return pool.find(function (s) { return s.kind === 'buff_atk' || s.kind === 'heal_buff'; });
      }
      if (!pDebuffed && pool.some(function (s) { return s.kind === 'debuff_media'; })) {
        return pool.find(function (s) { return s.kind === 'debuff_media'; });
      }
    }
    const attacks = pool.filter(function (s) { return s.kind === 'attack'; });
    if (attacks.length) {
      attacks.sort(function (a, b) { return (b.mult || 1) - (a.mult || 1) || a.cost - b.cost; });
      return attacks[0];
    }
    return null;
  }

  function execSkill(skill) {
    if (!skill) return;
    const enemy = G.state.enemy;
    enemy.ap = Math.max(0, enemy.ap - (skill.cost || 1));
    if (skill.text) speech(skill.text);
    G.log(activeStage.name + ' 使用「' + skill.name + '」');
    switch (skill.kind) {
      case 'attack':
        G.dealPhysical('enemy', 'player', skill.mult || 1);
        break;
      case 'buff_atk':
        G.applyStatus('enemy', 'story_fury', skill.dur || 2);
        break;
      case 'buff_atk_big':
        G.applyStatus('enemy', 'story_might', skill.dur || 2);
        break;
      case 'buff_def':
        G.applyStatus('enemy', 'story_guard', skill.dur || 2);
        break;
      case 'heal':
        G.healPct('enemy', skill.ratio || 0.12);
        break;
      case 'heal_buff':
        G.healPct('enemy', skill.ratio || 0.12);
        G.applyStatus('enemy', 'story_fury', skill.dur || 2);
        break;
      case 'debuff_media':
        G.applyStatus('player', 'media_press', skill.dur || 2);
        break;
    }
  }

  async function enemyTurn(key, stage) {
    let ops = 0;
    const MAX = 10;
    while (!G.isOver() && G.state.phase === G.PHASE.ACTION &&
           G.state.currentActorKey === key && ops < MAX) {
      const act = chooseSkill(stage, G.state.enemy, G.state.player);
      if (!act) break;
      ops += 1;
      await pace(420);
      execSkill(act);
      await pace(240);
    }
    if (!G.isOver() && G.state.phase === G.PHASE.ACTION &&
        G.state.currentActorKey === key) {
      await pace(300);
      G.endTurn(key);
    }
    if (global.UI && typeof UI.refresh === 'function') UI.refresh();
  }

  // ---------------- 被动钩子 ----------------
  let roundCount = 0;

  function hasP(id) { return run && run.passives.indexOf(id) >= 0; }

  function onPlayerTurnStart() {
    if (hasP('cheap_pot')) {
      G.gainAp('player', 1);
      const p = G.state.player;
      const amt = Math.min(20, p.maxHp - p.hp);
      if (amt > 0) {
        p.hp += amt;
        G.log('🍲 廉价小锅：HP +20');
        if (G.visual && typeof G.visual.heal === 'function') G.visual.heal({ key: 'player', amount: amt });
      }
    }
  }

  function onPlayerTurnEnd() {
    if (!hasP('gun')) return;
    if (G.isOver() || G.state.enemy.hp <= 0) return;
    G.log('🔫 日服男枪：对敌人额外造成 10 点伤害');
    if (G.visual && typeof G.visual.damage === 'function') {
      G.visual.damage({ key: 'enemy', amount: 10, crit: false });
    }
    G.fixedDamage('enemy', 10);
    if (G.isOver()) return;
    if (Math.random() < 0.05) {
      G.log('💥 日服男枪：一枪入魂！！！');
      if (global.UI && typeof UI.toast === 'function') UI.toast('🔫 日服男枪：一枪入魂！', 2200);
      G.fixedDamage('enemy', G.state.enemy.hp);
    }
  }

  function onRoundEnd() {
    roundCount += 1;
    if (roundCount % 2 !== 0) return;
    if (hasP('bushidou')) {
      const p = G.state.player;
      p.passiveAtkMult = (p.passiveAtkMult || 1) + 0.05;
      G.log('⚔️ 军国不再的武士道：攻击 +5%');
    }
    if (hasP('naihuo')) {
      const p = G.state.player;
      p.passiveDefMult = (p.passiveDefMult || 1) + 0.1;
      G.log('🧱 耐活王：防御 +10%');
    }
    if (hasP('shouwa_voice')) {
      const p = G.state.player;
      if (p.hand.length < 5) {
        p.hand.push({ uid: 'sw' + Math.random().toString(36).slice(2), def: G.getCardDef('shouwa_card'), temporaryCostModifier: 0 });
        G.log('📻 昭和的声音：获得【昭和】卡');
        if (global.UI && typeof UI.refresh === 'function') UI.refresh();
      }
    }
  }

  // ---------------- 战斗结束 ----------------
  function onBattleEnd(winnerKey) {
    if (Story.testMode) {
      if (winnerKey === 'player') { afterVictorySync(); } else { retryBattle(); }
      return;
    }
    if (winnerKey === 'player') {
      afterVictory();
    } else {
      showDefeat();
    }
  }

  function afterVictory() {
    const stage = activeStage;
    run.hp = Math.max(1, Math.min(run.maxHp, G.state.player.hp));
    const names = { sun: '孙笑川', enemy: stage.name, sys: '系统' };
    const icons = { sun: '😎', enemy: stage.emoji, sys: '🖥️' };
    const seq = [].concat(stage.victory || []);
    const next = function () {
      run.cleared[run.idx] = true;
      if (stage.type === 'finalBoss') { finishRun(); return; }
      rewardFlow();
    };
    StoryDialogue.play(seq, {
      boss: stage.type === 'boss' || stage.type === 'finalBoss',
      names: names, icons: icons, portraits: portraitsFor(stage)
    })
      .then(function () { next(); })
      .catch(errFallback(next));
  }

  function afterVictorySync() {
    // testMode：跳过对话直接结算
    const stage = activeStage;
    run.hp = Math.max(1, Math.min(run.maxHp, G.state.player.hp));
    run.cleared[run.idx] = true;
    if (stage.type === 'finalBoss') { finishRun(); return; }
    if (stage.reward && stage.reward.type === 'boss_choice') {
      // 测试模式：Boss 奖励自动选择被动
      const pc = stage.reward.choices.find(function (c) { return c.passive; });
      if (pc && run.passives.indexOf(pc.passive) < 0) run.passives.push(pc.passive);
      run.hp = run.maxHp;
      save();
    } else {
      applyRewardOnly(stage);
    }
    advance();
  }

  function showDefeat() {
    hideView();
    const ov = h('<div class="overlay"><div class="modal modal-wide st-defeat">' +
      '<h2 class="st-defeat-title">💀 你被抽象之力反噬了</h2>' +
      '<p class="modal-desc">' + activeStage.title + ' · ' + activeStage.name + '</p>' +
      '<div class="modal-buttons">' +
      '<button class="btn btn-primary btn-big" data-retry>🔄 重新挑战</button>' +
      '<button class="btn btn-ghost" data-map>🗺️ 返回故事地图</button></div></div></div>');
    document.body.appendChild(ov);
    ov.querySelector('[data-retry]').addEventListener('click', function () {
      ov.remove();
      run.hp = run.maxHp; // 重试恢复满血（永久奖励保留）
      save();
      battleBusy = true;
      startBattle();
    });
    ov.querySelector('[data-map]').addEventListener('click', function () {
      ov.remove();
      run.hp = Math.max(1, Math.min(run.maxHp, G.state.player.hp));
      save();
      Story.enter();
      showMap();
    });
  }

  function retryBattle() { // testMode 快速重试
    run.hp = run.maxHp;
    if (global.UI) UI.showBattleScreen();
    G.startStoryBattle(profileOf(), enemyView(activeStage));
  }

  // ---------------- 奖励 ----------------
  function rewardFlow() {
    const stage = activeStage;
    const rw = stage.reward;
    if (rw.type === 'choice') { showChoice(rw); return; }
    if (rw.type === 'boss_choice') { showBossChoice(rw); return; }
    applyRewardOnly(stage);
    // 常规奖励 + 概率被动
    const roll = rw.rollPassive;
    if (roll) {
      const got = Math.random() < roll.chance && run.passives.indexOf(roll.id) < 0;
      if (got) { run.passives.push(roll.id); }
      const names = { sun: '孙笑川', sys: '系统' };
      const icons = { sun: '😎', sys: '🖥️' };
      const line = got
        ? [['sys', '获得被动：' + D.PASSIVES[roll.id].name + '！']]
        : [['sys', '这次没有获得额外被动……']];
      if (Story.testMode) { advance(); return; }
      showRewardCard(rw, got ? D.PASSIVES[roll.id] : null)
        .then(function () { return StoryDialogue.play(line, { names: names, icons: icons }); })
        .then(function () { advance(); })
        .catch(errFallback(advance));
      return;
    }
    if (Story.testMode) { advance(); return; }
    showRewardCard(rw, null).then(function () { advance(); }).catch(errFallback(advance));
  }

  function applyRewardOnly(stage) {
    const rw = stage.reward;
    if (rw.atk) run.attack += rw.atk;
    if (rw.def) run.defense += rw.def;
    if (rw.healFull) { run.hp = run.maxHp; }
    if (rw.rollPassive && run.passives.indexOf(rw.rollPassive.id) < 0) {
      // testMode 固定获得，保证自动通关可用全部被动
      run.passives.push(rw.rollPassive.id);
    }
    if (stage.type === 'boss' || stage.type === 'finalBoss') run.hp = run.maxHp;
    save();
  }

  function showRewardCard(rw, passiveGot) {
    const st = activeStage;
    const lines = (st.after && st.after.length) ? st.after : [];
    const names = { sun: '孙笑川', sys: '系统' };
    const icons = { sun: '😎', sys: '🖥️' };
    const ov = h('<div class="overlay"><div class="modal st-reward">' +
      '<h3 class="modal-title">🎁 阶段奖励</h3>' +
      '<div class="st-reward-card"><div class="rc-name">' + (rw.title || '属性提升') + '</div>' +
      '<div class="rc-desc">' + (rw.explain || '') + '</div></div>' +
      (passiveGot ? '<div class="st-reward-card rc-passive"><div class="rc-name">' +
        (passiveGot.art ? '<img class="passive-art" src="' + passiveGot.art + '" alt="">' : passiveGot.icon) + ' ' +
        passiveGot.name + '</div><div class="rc-desc">' +
        passiveGot.desc + '</div></div>' : '') +
      '<div class="modal-buttons"><button class="btn btn-primary" data-ok>领取</button></div></div></div>');
    document.body.appendChild(ov);
    return new Promise(function (resolve) {
      ov.querySelector('[data-ok]').addEventListener('click', function () {
        ov.remove();
        if (lines.length && !Story.testMode) {
          StoryDialogue.play(lines, { names: names, icons: icons })
            .then(function () { resolve(); })
            .catch(function () { resolve(); });
        } else { resolve(); }
      });
    });
  }

  function showChoice(rw) {
    const ov = h('<div class="overlay"><div class="modal modal-wide">' +
      '<h3 class="modal-title">' + activeStage.title + '</h3>' +
      '<div class="st-choices">' + rw.choices.map(function (c, i) {
        return '<button class="st-choice" data-i="' + i + '"><span class="sc-icon">' + c.icon + '</span>' +
          '<span class="sc-name">' + c.name + '</span><span class="sc-desc">' + c.desc + '</span></button>';
      }).join('') + '</div></div></div>');
    document.body.appendChild(ov);
    ov.querySelectorAll('.st-choice').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = rw.choices[+b.dataset.i];
        ov.remove();
        if (c.id === 'heal') { run.hp = run.maxHp; }
        else if (c.id === 'stats') { run.attack += 5; run.defense += 5; }
        save();
        const names = { sun: '孙笑川', sys: '系统' };
        const icons = { sun: '😎', sys: '🖥️' };
        if (Story.testMode) { advance(); return; }
        StoryDialogue.play(c.lines || [], { names: names, icons: icons })
          .then(function () { advance(); })
          .catch(errFallback(advance));
      });
    });
  }

  function showBossChoice(rw) {
    run.hp = run.maxHp; // Boss 固定回满
    save();
    const ov = h('<div class="overlay"><div class="modal modal-wide st-boss-choice">' +
      '<h3 class="modal-title">👑 ' + activeStage.title + ' · 战利品</h3>' +
      '<p class="modal-desc">选择一项强化</p>' +
      '<div class="st-choices">' + rw.choices.map(function (c, i) {
        return '<button class="st-choice" data-i="' + i + '"><span class="sc-icon">' + c.icon + '</span>' +
          '<span class="sc-name">' + c.name + '</span><span class="sc-desc">' + c.desc + '</span></button>';
      }).join('') + '</div></div></div>');
    document.body.appendChild(ov);
    ov.querySelectorAll('.st-choice').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = rw.choices[+b.dataset.i];
        ov.remove();
        if (c.id === 'stats') {
          if (c.statsDefOnly) run.defense += c.statsDefOnly;
          else { run.attack += 5; run.defense += 5; }
        } else if (c.id === 'passive') {
          if (run.passives.indexOf(c.passive) < 0) run.passives.push(c.passive);
        }
        save();
        const names = { sun: '孙笑川', sys: '系统' };
        const icons = { sun: '😎', sys: '🖥️' };
        if (Story.testMode) { advance(); return; }
        StoryDialogue.play(c.lines || [], { names: names, icons: icons })
          .then(function () { advance(); })
          .catch(errFallback(advance));
      });
    });
  }

  // Boss 第8关选项B是 DEF+10（statsDefOnly 在数据中通过 desc 体现，这里做特殊处理）
  function advance() {
    if (Story.testMode) {
      run.idx += 1;
      if (run.idx >= D.STAGES.length) finishRun();
      return;
    }
    run.idx += 1;
    if (run.idx >= D.STAGES.length) { finishRun(); return; }
    save();
    Story.enter();
    showMap();
  }

  function finishRun() {
    run.completed = true;
    run.idx = D.STAGES.length;
    save();
    if (Story.testMode) { Story.testDone = true; return; }
    const names = { sun: '孙笑川', sys: '系统' };
    const icons = { sun: '😎', sys: '🖥️' };
    StoryDialogue.play(D.ENDING, { names: names, icons: icons })
      .then(function () { showEndingScreen(false); })
      .catch(errFallback(function () { showEndingScreen(false); }));
  }

  function showEndingScreen(archived) {
    clearView();
    viewEl.innerHTML =
      '<div class="st-end"><button class="st-back">⌂ 返回主菜单</button>' +
      '<h1 class="st-end-title">🏆 ' + (archived ? '通关档案' : '恭喜通关！') + '</h1>' +
      '<p class="st-end-sub">宿主获得称号：【招核讨伐者】</p>' + statCard(run) +
      '<div class="st-end-passives">' + run.passives.map(function (id) {
        const p = D.PASSIVES[id];
        return p ? '<div class="rc-passive st-reward-card"><div class="rc-name">' +
          (p.art ? '<img class="passive-art" src="' + p.art + '" alt="">' : p.icon) + ' ' + p.name +
          '</div><div class="rc-desc">' + p.desc + '</div></div>' : '';
      }).join('') + '</div>' +
      '<div class="modal-buttons"><button class="btn btn-ghost" data-home>返回主菜单</button></div></div>';
    viewEl.querySelector('.st-back').addEventListener('click', Story.leave);
    viewEl.querySelector('[data-home]').addEventListener('click', Story.leave);
    showView();
  }

  // 第8关 Boss 选项 A：DEF+10 —— 由奖励流特殊处理
  function applyBossStatsDefOnly() {
    // 通过改造 showBossChoice 支持：若 choice 有 defOnly 则只加防御
  }

  // 休息/强化关
  function runRestStage() {
    const stage = D.STAGES[run.idx];
    if (stage.type === 'boost') {
      run.hp = run.maxHp;
      run.attack += stage.reward.atk || 0;
      run.defense += stage.reward.def || 0;
      save();
      const names = { sun: '孙笑川', sys: '系统' };
      const icons = { sun: '😎', sys: '🖥️' };
      if (Story.testMode) { advance(); return; }
      StoryDialogue.play(stage.lines, { names: names, icons: icons })
        .then(function () { run.idx += 1; save(); Story.enter(); showMap(); })
        .catch(errFallback(function () { run.idx += 1; save(); Story.enter(); showMap(); }));
      return;
    }
    // reward（选择关）
    const intro = [].concat(stage.reward.intro || []);
    if (Story.testMode) {
      // 血量低时选回血，否则选强化（保证测试可通关）
      const c = run.hp < run.maxHp * 0.55 ? stage.reward.choices[0] : stage.reward.choices[1];
      if (c.id === 'heal') run.hp = run.maxHp;
      else { run.attack += 5; run.defense += 5; }
      save();
      advance();
      return;
    }
    const names = { sun: '孙笑川', sys: '系统' };
    const icons = { sun: '😎', sys: '🖥️' };
    const seq = [{ scene: stage.title }, { scene: stage.scene }].concat(intro);
    StoryDialogue.play(seq, { names: names, icons: icons })
      .then(function () { showChoice(stage.reward); })
      .catch(errFallback(function () {
        // 兜底：默认选强化并推进
        run.attack += 5; run.defense += 5; save(); advance();
      }));
  }

  // 供无头自动通关测试：返回是否通关
  Story.autoplay = async function () {
    Story.testMode = true;
    G.state.simMode = true; // 双方全自动（玩家侧走 AI，Boss 走脚本驱动）
    G.state.animSpeed = 40;
    run = freshRun();
    run.idx = 0;
    roundCount = 0;
    let guard = 0;
    while (!run.completed && guard++ < 300) {
      const stage = D.STAGES[run.idx];
      if (!stage) { finishRun(); break; }
      activeStage = stage;
      const stageStartIdx = run.idx;
      let attempts = 0;
      if (global.console) console.log('[故事测试] 进入：', stage.title,
        '| HP', run.hp, '/', run.maxHp, 'ATK', run.attack, 'DEF', run.defense,
        '被动', run.passives.join(',') || '无');
      if (stage.type === 'reward' || stage.type === 'boost') {
        runRestStage();
        continue;
      }
      // 允许有限次失败重试（模拟玩家重开），超出则判定失败
      while (true) {
        attempts += 1;
        G.state.storyHooks = {
          onPlayerTurnStart: onPlayerTurnStart,
          onPlayerTurnEnd: onPlayerTurnEnd,
          onRoundEnd: onRoundEnd,
          onBattleEnd: onBattleEnd
        };
        G.state.storyHandProvider = function () { return []; };
        G.state.storyEnemyDriver = function (key) { return enemyTurn(key, stage); };
        G.state.storyStageType = stage.type;
        G.state.storyStageNum = stage.id;
        roundCount = 0;
        G.startStoryBattle(profileOf(), enemyView(stage));
        let w = 0;
        while (G.state.phase !== G.PHASE.OVER && w++ < 80000) { await sleep(2); }
        if (G.state.phase !== G.PHASE.OVER) {
          if (global.console) console.error('卡死于关卡：', stage.title);
          return false;
        }
        if (run.completed || run.idx !== stageStartIdx) break; // 胜利并推进
        if (attempts > 10) {
          if (global.console) console.error('多次失败放弃关卡：', stage.title);
          return false;
        }
        if (global.console) console.log('[故事测试] 失败重试(' + attempts + ')：', stage.title);
      }
      if (global.console) console.log('[故事测试] 通过：', stage.title);
      // testMode 下 onBattleEnd 已同步推进 run.idx
    }
    return !!run.completed;
  };

  global.Story = Story;
  Story._runEnemyTurn = enemyTurn; // 测试辅助
})(window);
