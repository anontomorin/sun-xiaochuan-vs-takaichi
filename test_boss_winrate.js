/*
 * 东条英机Boss胜率测试脚本
 * 模拟故事模式第4关自动战斗，统计胜率
 */
'use strict';

// 模拟浏览器环境
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = {
  createElement: () => ({ innerHTML: '', classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], remove: () => {} }),
  getElementById: () => null,
  body: { appendChild: () => {} }
};
global.console = console;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.Promise = Promise;
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
global.Blob = function () {};

// 按依赖顺序加载JS文件
const jsDir = path.join(__dirname, 'js');
const files = ['cards.js', 'characters.js', 'data.js', 'game.js', 'ai.js', 'story.js'];
files.forEach(f => {
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  // 使用eval在全局作用域执行
  eval.call(global, code);
});

const G = global.Game;
const D = global.StoryData;
const Story = global.Story;

// 获取story.js内部函数的引用（通过autoplay间接使用）
// 我们需要直接构造战斗环境

async function simulateOneBattle(playerProfile, stage) {
  // 重置游戏状态
  G.restart();
  G.state.simMode = true;
  G.state.animSpeed = 40;

  // 设置故事钩子（无被动，第4关前没有被动）
  G.state.storyHooks = {
    onPlayerTurnStart: () => {},
    onPlayerTurnEnd: () => {},
    onRoundEnd: () => {},
    onBattleEnd: (winnerKey) => {
      G.state._testWinner = winnerKey;
    }
  };
  G.state.storyHandProvider = () => [];

  // 敌人行动驱动（复制story.js的enemyTurn逻辑）
  const chooseSkill = (stage, enemy, player) => {
    const pool = stage.skills.filter(s => s.cost <= enemy.ap);
    if (pool.length === 0) return null;
    const hasHeal = pool.some(s => s.kind === 'heal' || s.kind === 'heal_buff');
    if (hasHeal && enemy.hp < enemy.maxHp * 0.42) {
      return pool.find(s => s.kind === 'heal' || s.kind === 'heal_buff');
    }
    const buffed = G.hasStatus('enemy', 'story_fury') || G.hasStatus('enemy', 'story_might');
    const guardOn = G.hasStatus('enemy', 'story_guard');
    const boss = stage.type === 'boss' || stage.type === 'finalBoss';
    const pDebuffed = G.hasStatus('player', 'media_press');
    if (boss) {
      if (!guardOn && enemy.hp < enemy.maxHp * 0.6 && pool.some(s => s.kind === 'buff_def')) {
        return pool.find(s => s.kind === 'buff_def');
      }
      if (!buffed && enemy.hp < enemy.maxHp * 0.8 && pool.some(s => s.kind === 'buff_atk' || s.kind === 'buff_atk_big' || s.kind === 'heal_buff')) {
        return pool.find(s => s.kind === 'buff_atk' || s.kind === 'buff_atk_big' || s.kind === 'heal_buff');
      }
      if (!pDebuffed && pool.some(s => s.kind === 'debuff_media')) {
        return pool.find(s => s.kind === 'debuff_media');
      }
    }
    const attacks = pool.filter(s => s.kind === 'attack');
    if (attacks.length) {
      attacks.sort((a, b) => (b.mult || 1) - (a.mult || 1) || a.cost - b.cost);
      return attacks[0];
    }
    return null;
  };

  const execSkill = (skill) => {
    if (!skill) return;
    const enemy = G.state.enemy;
    enemy.ap = Math.max(0, enemy.ap - (skill.cost || 1));
    G.log(stage.name + ' 使用「' + skill.name + '」');
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
  };

  G.state.storyEnemyDriver = async (key) => {
    let ops = 0;
    const MAX = 10;
    while (!G.isOver() && G.state.phase === G.PHASE.ACTION &&
           G.state.currentActorKey === key && ops < MAX) {
      const act = chooseSkill(stage, G.state.enemy, G.state.player);
      if (!act) break;
      ops += 1;
      execSkill(act);
    }
    if (!G.isOver() && G.state.phase === G.PHASE.ACTION &&
        G.state.currentActorKey === key) {
      G.endTurn(key);
    }
  };

  // 开始战斗
  const enemyDef = Object.assign({
    name: stage.name,
    emoji: stage.emoji,
    tag: stage.tag,
    characterId: 'story_' + stage.id
  }, stage.enemy);

  G.startStoryBattle(playerProfile, enemyDef);

  // 等待战斗结束（simMode下AI是异步的，需要轮询）
  let guard = 0;
  while (G.state.phase !== G.PHASE.OVER && guard++ < 100000) {
    await new Promise(r => setImmediate(r));
  }

  return G.state.winnerKey === 'player';
}

async function runTests(numRuns, playerProfile, stage) {
  let wins = 0;
  const results = [];
  for (let i = 0; i < numRuns; i++) {
    const won = await simulateOneBattle(playerProfile, stage);
    results.push(won);
    if (won) wins++;
    if ((i + 1) % 100 === 0) {
      console.log(`  进度: ${i + 1}/${numRuns}, 当前胜率: ${(wins / (i + 1) * 100).toFixed(1)}%`);
    }
  }
  return { wins, total: numRuns, winRate: wins / numRuns };
}

async function main() {
  const stage4 = D.STAGES.find(s => s.id === 4);
  console.log('=== 东条英机Boss配置 ===');
  console.log('HP:', stage4.enemy.hp, 'ATK:', stage4.enemy.atk, 'DEF:', stage4.enemy.def, 'SPD:', stage4.enemy.speed);
  console.log('技能:', JSON.stringify(stage4.skills, null, 2));

  // 模拟玩家到达第4关时的属性
  // 初始: hp260 atk30 def15 spd35
  // 第1关奖励: atk+5 def+5
  // 第2关奖励: atk+5 def+5
  // 第3关奖励关: testMode下HP>=55%选强化(atk+5 def+5)，否则回血
  // 假设玩家满血到达第4关（Boss前通常会回血或状态较好）
  const playerProfiles = [
    { name: '满血强化路线(atk45 def30)', profile: { maxHp: 260, hp: 260, attack: 45, defense: 30, speed: 35, passives: [], deckSpec: D.SUN_DECK } },
    { name: '满血回血路线(atk40 def25)', profile: { maxHp: 260, hp: 260, attack: 40, defense: 25, speed: 35, passives: [], deckSpec: D.SUN_DECK } },
    { name: '70%血强化路线(atk45 def30)', profile: { maxHp: 260, hp: 182, attack: 45, defense: 30, speed: 35, passives: [], deckSpec: D.SUN_DECK } },
  ];

  const NUM_RUNS = 500;

  for (const { name, profile } of playerProfiles) {
    console.log(`\n=== 测试场景: ${name} ===`);
    console.log(`玩家属性: HP${profile.hp}/${profile.maxHp} ATK${profile.attack} DEF${profile.defense} SPD${profile.speed}`);
    const result = await runTests(NUM_RUNS, profile, stage4);
    console.log(`结果: ${result.wins}/${result.total} 胜, 胜率 ${(result.winRate * 100).toFixed(1)}%`);
  }
}

main().catch(err => {
  console.error('测试出错:', err);
  process.exit(1);
});
