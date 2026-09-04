/*
 * cards.js
 * 所有卡牌定义 + 卡牌效果 + 卡牌类型/费用 + 状态定义
 * 卡牌效果通过 Game（game.js 在运行时提供）执行伤害、状态、治疗等操作，
 * 因此本文件只负责「定义与描述」，具体结算逻辑在 game.js。
 */
(function (global) {
  'use strict';

  const CardData = {};
  const CARD_DEFS = {};   // id -> 卡牌定义
  const STATUS_DEFS = {}; // id -> 状态定义

  // 类型元数据（颜色由 CSS 控制，这里只做展示映射）
  const TYPE_META = {
    attack:  { label: '攻击', icon: '⚔️' },
    skill:   { label: '技能', icon: '✨' },
    defense: { label: '防御', icon: '🛡️' },
    status:  { label: '状态', icon: '🧪' },
    special: { label: '特殊', icon: '⭐' }
  };

  // ---------------------------------------------------------------------------
  // 状态定义
  // duration: 常规状态默认 2 回合（在拥有者自己的回合结束时 -1，归零移除）
  // untilOwnTurn: 特殊防御状态，在拥有者自己的下一回合开始时直接移除
  // category: 攻击/防御增降益的互斥类别（同类新状态覆盖旧状态，不叠加）
  // mods.attack / mods.defense: 实时计算当前攻/防的倍率
  // mods.incoming: 受到的伤害倍率（<1 减伤 / >1 增伤）
  // endTurn: { healPct | loseAp | fixedDmg } 每回合结束触发的效果
  // ---------------------------------------------------------------------------
  function defStatus(def) {
    STATUS_DEFS[def.id] = def;
    return def;
  }

  defStatus({
    id: 'abstract', name: '抽象化', icon: '🌀', kind: 'negative', duration: 2,
    desc: '进入出牌阶段时随机行为：50%随机自动打出一张可用卡牌；30%对自己造成0.5倍物理伤害；20%跳过本次出牌阶段。'
  });
  defStatus({
    id: 'tax_burden', name: '增税负担', icon: '🧾', kind: 'negative', duration: 2,
    desc: '速度-30%（仅显示）；每回合开始获得AP时额外-1（最低获得0）。'
  });
  defStatus({
    id: 'cyber_storm', name: '网暴风暴', icon: '🌊', kind: 'negative', duration: 2,
    mods: { incoming: 1.3 },
    desc: '受到伤害 +30%。'
  });
  defStatus({
    id: 'consumption_storm', name: '消费税风暴', icon: '🛒', kind: 'negative', duration: 2,
    mods: { incoming: 1.3 },
    desc: '受到伤害 +30%。'
  });
  defStatus({
    id: 'dead_pig', name: '死猪不怕开水烫', icon: '🐷', kind: 'buff', untilOwnTurn: true,
    mods: { incoming: 0.5 },
    endTurn: { healPct: 0.05 },
    desc: '受到伤害-50%；每回合结束恢复5%最大HP；在角色自己的下一回合开始时移除。'
  });
  defStatus({
    id: 'shelter', name: '政治庇护', icon: '🛡️', kind: 'buff', untilOwnTurn: true,
    mods: { incoming: 0.4 },
    endTurn: { loseAp: 1 },
    desc: '受到伤害-60%；每回合结束失去1 AP；在角色自己的下一回合开始时移除。'
  });
  defStatus({
    id: 'shut_up', name: '被喷到自闭', icon: '💢', kind: 'negative', duration: 2,
    category: 'attack_down', mods: { attack: 0.8 },
    desc: '攻击力 -20%。'
  });
  defStatus({
    id: 'sanctions', name: '经济制裁', icon: '💰', kind: 'negative', duration: 2,
    category: 'attack_down', mods: { attack: 0.8 },
    desc: '攻击力 -20%。'
  });
  defStatus({
    id: 'hawkish', name: '鹰派威慑', icon: '📉', kind: 'negative', duration: 1,
    category: 'attack_down', mods: { attack: 0.9 },
    desc: '攻击力 -10%。'
  });
  defStatus({
    id: 'tax_warning', name: '增税警告', icon: '🏛️', kind: 'negative', duration: 2,
    category: 'defense_down', mods: { defense: 0.8 },
    desc: '防御力 -20%。'
  });
  defStatus({
    id: 'cyber_break', name: '网暴破防', icon: '📵', kind: 'negative', duration: 2,
    category: 'defense_down', mods: { defense: 0.8 },
    desc: '防御力 -20%。'
  });
  defStatus({
    id: 'dog_fans_siege', name: '狗粉丝围攻', icon: '🐕', kind: 'negative', duration: 2,
    endTurn: { fixedDmg: 10 },
    desc: '每回合结束受到10点固定伤害；不能使用道具。'
  });
  defStatus({
    id: 'taiwan_issue', name: '台湾有事', icon: '🌏', kind: 'negative', duration: 2,
    desc: '每次尝试使用技能牌时：25%概率无法使用（不消耗AP、卡牌不进入弃牌堆）。'
  });
  defStatus({
    id: 'emperor_blessing', name: '天皇の祝福', icon: '👑', kind: 'buff', duration: 2,
    category: 'attack_up', mods: { attack: 1.2 },
    desc: '攻击力 +20%。'
  });
  defStatus({
    id: 'shelter_guard', name: '政治庇护·强化', icon: '🧱', kind: 'buff', duration: 2,
    category: 'defense_up', mods: { defense: 1.2 },
    desc: '防御力 +20%。'
  });

  // ---------------------------------------------------------------------------
  // 卡牌定义
  // effect(G, me)：me 是使用方 key（'player'|'enemy'），对手 key 用 G.foeKey(me) 获取。
  // forceEndTurn：防御牌专用，效果结算 + 抽 1 后立即结束当前回合。
  // critDraw：费用 1、无附加状态、暴击后额外抽 1 张（抽象话连击 / 政策辩论）。
  // ---------------------------------------------------------------------------
  function defCard(def) {
    CARD_DEFS[def.id] = def;
    return def;
  }

  // ============================== 孙笑川牌组 ==============================
  defCard({
    id: 'abstract_combo', name: '抽象话连击', cost: 1, type: 'attack', count: 4,
    desc: '造成 1.0 倍物理伤害。暴击时额外抽 1 张牌。',
    critDraw: true,
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 1.0, { critDraw: true });
    }
  });

  defCard({
    id: 'elegant', name: '儒雅随和', cost: 2, type: 'attack', count: 3,
    desc: '造成 1.3 倍物理伤害；20%概率使对方获得「被喷到自闭」（2回合）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 1.3);
      if (Math.random() < 0.2) {
        G.applyStatus(G.foeKey(me), 'shut_up', 2);
      }
    }
  });

  defCard({
    id: 'shouting', name: '你吼那么大声干什么嘛', cost: 2, type: 'skill', count: 2,
    desc: '造成 0.5 倍物理伤害；必定使对方获得「被喷到自闭」（2回合）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 0.5);
      G.applyStatus(G.foeKey(me), 'shut_up', 2);
    }
  });

  defCard({
    id: 'cyber_storm', name: '网暴风暴', cost: 3, type: 'attack', count: 2,
    desc: '造成 1.5 倍物理伤害；30%概率使对方获得「网暴风暴」（2回合，受到伤害+30%）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 1.5);
      if (Math.random() < 0.3) {
        G.applyStatus(G.foeKey(me), 'cyber_storm', 2);
      }
    }
  });

  defCard({
    id: 'emperor_blessing', name: '天皇の祝福', cost: 3, type: 'skill', count: 1,
    desc: '恢复最大 HP 的 20%；攻击力 +20%（2回合）。',
    effect: function (G, me) {
      G.healPct(me, 0.2);
      G.applyStatus(me, 'emperor_blessing', 2);
    }
  });

  defCard({
    id: 'ultimate_rap', name: '终极奥义·烫嘴rap', cost: 5, type: 'attack', count: 1,
    desc: '造成 2.0 倍物理伤害；若对方拥有「抽象化」，最终伤害翻倍（4.0倍）。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      const mult = G.hasStatus(foe, 'abstract') ? 4.0 : 2.0;
      G.dealPhysical(me, foe, mult);
    }
  });

  defCard({
    id: 'dead_pig', name: '死猪不怕开水烫', cost: 0, type: 'defense', count: 2,
    desc: '获得「死猪不怕开水烫」（受伤-50%）；抽 1 张牌；立即结束当前回合。',
    forceEndTurn: true,
    effect: function (G, me) {
      G.applyStatus(me, 'dead_pig');
      G.drawCards(me, 1);
    }
  });

  defCard({
    id: 'dog_fans', name: '狗粉丝召唤', cost: 2, type: 'status', count: 2,
    desc: '对方随机弃 1 张手牌；若对方无手牌，则使其获得「狗粉丝围攻」（2回合）。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      if (G.state[foe].hand.length > 0) {
        G.forceDiscardRandom(foe);
      } else {
        G.applyStatus(foe, 'dog_fans_siege', 2);
      }
    }
  });

  defCard({
    id: 'master', name: '带带大师兄', cost: 4, type: 'special', count: 1,
    desc: '本回合所有卡牌费用 -1（最低0）；抽 2 张牌。',
    effect: function (G, me) {
      G.state[me].costReduction = 1;
      G.drawCards(me, 2);
    }
  });

  defCard({
    id: 'abstract_bible', name: '抽象圣经', cost: 3, type: 'status', count: 1,
    desc: '造成 0.3 倍物理伤害；使对方获得「抽象化」（2回合）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 0.3);
      G.applyStatus(G.foeKey(me), 'abstract', 2);
    }
  });

  defCard({
    id: 'scam', name: '网恋被骗', cost: 2, type: 'special', count: 1,
    desc: '偷取对方 2 AP；若对方 AP 不足 2，改为造成 10 点固定伤害。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      if (G.state[foe].ap >= 2) {
        G.loseAp(foe, 2);
        G.gainAp(me, 2);
      } else {
        G.fixedDamage(foe, 10);
      }
    }
  });

  // ============================== 高市早苗牌组 ==============================
  defCard({
    id: 'policy_debate', name: '政策辩论', cost: 1, type: 'attack', count: 4,
    desc: '造成 1.0 倍物理伤害。暴击时额外抽 1 张牌。',
    critDraw: true,
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 1.0, { critDraw: true });
    }
  });

  defCard({
    id: 'tax_warning', name: '增税警告', cost: 2, type: 'skill', count: 3,
    desc: '造成 0.5 倍物理伤害；使对方获得「增税警告」（2回合，防御-20%）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 0.5);
      G.applyStatus(G.foeKey(me), 'tax_warning', 2);
    }
  });

  defCard({
    id: 'three_arrows', name: '安倍经济学三支箭', cost: 3, type: 'attack', count: 2,
    desc: '连续攻击 3 次，每次 0.4 倍物理伤害；每次 10%概率使对方获得「增税负担」（2回合）。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      for (let i = 0; i < 3; i++) {
        if (G.isOver()) return;
        G.dealPhysical(me, foe, 0.4);
        if (Math.random() < 0.1) {
          G.applyStatus(foe, 'tax_burden', 2);
        }
      }
    }
  });

  defCard({
    id: 'political_shelter', name: '政治庇护', cost: 3, type: 'skill', count: 1,
    desc: '恢复最大 HP 的 25%；防御力 +20%（2回合）。',
    effect: function (G, me) {
      G.healPct(me, 0.25);
      G.applyStatus(me, 'shelter_guard', 2);
    }
  });

  defCard({
    id: 'tax_storm', name: '终极奥义·消费税风暴', cost: 5, type: 'attack', count: 1,
    desc: '造成 2.0 倍物理伤害；若对方拥有「增税负担」，额外使其获得「消费税风暴」（2回合）。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      G.dealPhysical(me, foe, 2.0);
      if (G.hasStatus(foe, 'tax_burden')) {
        G.applyStatus(foe, 'consumption_storm', 2);
      }
    }
  });

  defCard({
    id: 'political_correctness', name: '政治正确', cost: 0, type: 'defense', count: 2,
    desc: '获得「政治庇护」（受伤-60%）；抽 1 张牌；立即结束当前回合。',
    forceEndTurn: true,
    effect: function (G, me) {
      G.applyStatus(me, 'shelter');
      G.drawCards(me, 1);
    }
  });

  defCard({
    id: 'history_revision', name: '历史修正', cost: 2, type: 'status', count: 2,
    desc: '对方有手牌：随机 1 张本回合费用 +2；无手牌：使其获得「网暴破防」（2回合）。',
    effect: function (G, me) {
      const foeKey = G.foeKey(me);
      const foe = G.state[foeKey];
      if (foe.hand.length > 0) {
        const target = foe.hand[Math.floor(Math.random() * foe.hand.length)];
        target.temporaryCostModifier = (target.temporaryCostModifier || 0) + 2;
        G.log('「历史修正」使对方手牌「' + target.def.name + '」本回合费用 +2');
      } else {
        G.applyStatus(foeKey, 'cyber_break', 2);
      }
    }
  });

  defCard({
    id: 'hawkish', name: '鹰派言论', cost: 2, type: 'attack', count: 2,
    desc: '造成 1.2 倍物理伤害；对方攻击力 -10%（1回合）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 1.2);
      G.applyStatus(G.foeKey(me), 'hawkish', 1);
    }
  });

  defCard({
    id: 'female_pm', name: '女性首相之路', cost: 4, type: 'special', count: 1,
    desc: '本回合所有卡牌费用 -1（最低0）；抽 2 张牌。',
    effect: function (G, me) {
      G.state[me].costReduction = 1;
      G.drawCards(me, 2);
    }
  });

  defCard({
    id: 'taiwan_issue', name: '台湾有事', cost: 3, type: 'status', count: 1,
    desc: '造成 0.3 倍物理伤害；使对方获得「台湾有事」（2回合，25%无法使用技能牌）。',
    effect: function (G, me) {
      G.dealPhysical(me, G.foeKey(me), 0.3);
      G.applyStatus(G.foeKey(me), 'taiwan_issue', 2);
    }
  });

  defCard({
    id: 'consumption_tax', name: '消费税上调', cost: 2, type: 'special', count: 1,
    desc: '偷取对方 2 AP；若对方 AP 不足 2，改为造成 10 点固定伤害。',
    effect: function (G, me) {
      const foe = G.foeKey(me);
      if (G.state[foe].ap >= 2) {
        G.loseAp(foe, 2);
        G.gainAp(me, 2);
      } else {
        G.fixedDamage(foe, 10);
      }
    }
  });

  // 工具
  CardData.CARD_DEFS = CARD_DEFS;
  CardData.STATUS_DEFS = STATUS_DEFS;
  CardData.TYPE_META = TYPE_META;

  CardData.getCard = function (id) { return CARD_DEFS[id]; };
  CardData.getStatus = function (id) { return STATUS_DEFS[id]; };
  CardData.allCards = function () {
    return Object.keys(CARD_DEFS).map(function (k) { return CARD_DEFS[k]; });
  };

  global.CardData = CardData;
})(window);
