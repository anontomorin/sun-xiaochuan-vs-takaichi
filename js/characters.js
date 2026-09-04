/*
 * characters.js
 * 角色基础数据：孙笑川 / 高市早苗
 * 负责：角色基础属性、角色牌组规格、通用道具定义
 * 纯数据 + 少量创建函数，不依赖其它文件。
 */
(function (global) {
  'use strict';

  // 两个可选角色。deckSpec 为「卡牌ID + 数量」，进入战斗时展开成独立卡牌实例。
  const CHARACTERS = {
    sun_xiaochuan: {
      id: 'sun_xiaochuan',
      name: '孙笑川',
      emoji: '😎',
      // 本地头像照片（放到 assets/img/ 下即可启用；缺省自动回退 Emoji）
      photo: 'assets/img/sun_xiaochuan.png',
      tagline: '嘴炮输出 · 网络梗 · 爆发',
      maxHp: 500,
      attack: 39,
      defense: 20,
      speed: 35,
      deckSpec: [
        { id: 'abstract_combo', count: 3 },
        { id: 'elegant', count: 2 },
        { id: 'shouting', count: 2 },
        { id: 'cyber_storm', count: 1 },
        { id: 'emperor_blessing', count: 1 },
        { id: 'ultimate_rap', count: 1 },
        { id: 'dead_pig', count: 2 },
        { id: 'dog_fans', count: 1 },
        { id: 'master', count: 1 },
        { id: 'abstract_bible', count: 1 },
        { id: 'scam', count: 1 },
        { id: 'rush', count: 2 },
        { id: 'dont_hurry', count: 2 }
      ]
    },

    takaichi_sanae: {
      id: 'takaichi_sanae',
      name: '高市早苗',
      emoji: '👩‍💼',
      photo: 'assets/img/takaichi_sanae.png',
      tagline: '政治强人 · 防守 · 经济攻击',
      maxHp: 550,
      attack: 32,
      defense: 30,
      speed: 30,
      deckSpec: [
        { id: 'policy_debate', count: 3 },
        { id: 'tax_warning', count: 3 },
        { id: 'three_arrows', count: 1 },
        { id: 'political_shelter', count: 1 },
        { id: 'tax_storm', count: 1 },
        { id: 'political_correctness', count: 2 },
        { id: 'history_revision', count: 1 },
        { id: 'hawkish', count: 1 },
        { id: 'female_pm', count: 1 },
        { id: 'taiwan_issue', count: 1 },
        { id: 'consumption_tax', count: 1 },
        { id: 'decisive', count: 2 },
        { id: 'red_tape', count: 2 }
      ]
    }
  };

  // 通用道具（双方开局各随机携带 2 个）
  const ITEM_DEFS = {
    red_packet: {
      id: 'red_packet',
      name: '回血红包',
      icon: '🧧',
      desc: '恢复最大 HP 的 30%（不超过最大 HP）。'
    },
    purify_spray: {
      id: 'purify_spray',
      name: '净化喷雾',
      icon: '💦',
      desc: '移除所有负面状态。'
    },
    energy_coffee: {
      id: 'energy_coffee',
      name: '能量咖啡',
      icon: '☕',
      desc: '恢复 2 AP（不超过 10）。'
    }
  };

  global.Characters = {
    CHARACTERS: CHARACTERS,
    ITEM_DEFS: ITEM_DEFS
  };
})(window);
