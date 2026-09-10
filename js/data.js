/*
 * data.js —— 2.0 故事模式数据模块
 * 集中管理：孙笑川初始档案/牌组、11 阶段（敌人数值+技能+剧情）、奖励与被动。
 * 对白格式：每一条 = [说话人, 文本]；说话人 sun/enemy/sys；
 *           {scene:'场景标题'} 表示场景标题卡；{fx:'flash'|'shake'|'crash'|'boss'|'auto_click'} 为演出效果。
 */
(function (global) {
  'use strict';

  const S = {};

  S.TITLE = '孙笑川大战高市早苗';
  S.SUBTITLE = '抽象之力 VS 招核残影';

  // 故事起始档案（第 1 关）
  S.SUN_BASE = { maxHp: 260, attack: 30, defense: 15, speed: 35 };
  // 文档 §7：孙笑川初始卡组（20 张）
  S.SUN_DECK = [
    { id: 'abstract_combo', count: 4 },
    { id: 'elegant', count: 3 },
    { id: 'shouting', count: 2 },
    { id: 'cyber_storm', count: 2 },
    { id: 'emperor_blessing', count: 1 },
    { id: 'ultimate_rap', count: 1 },
    { id: 'dead_pig', count: 2 },
    { id: 'dog_fans', count: 2 },
    { id: 'master', count: 1 },
    { id: 'abstract_bible', count: 1 },
    { id: 'scam', count: 1 }
  ];

  // 被动定义
  S.PASSIVES = {
    bushidou: { id: 'bushidou', name: '军国不再的武士道', icon: '⚔️', art: 'assets/img/art/icons/passive_bushidou.webp',
      desc: '每 2 个战斗回合：攻击力 +5%（向上取整，本场内叠加）。' },
    shouwa_voice: { id: 'shouwa_voice', name: '昭和的声音', icon: '📻', art: 'assets/img/art/icons/passive_showa.webp',
      desc: '每 2 个战斗回合：获得 1 张【昭和】卡（1AP，攻击力+50% 持续 2 回合）。' },
    cheap_pot: { id: 'cheap_pot', name: '廉价小锅', icon: '🍲', art: 'assets/img/art/icons/passive_pot.webp',
      desc: '每回合开始：AP +1、HP +20。' },
    gun: { id: 'gun', name: '日服男枪', icon: '🔫', art: 'assets/img/art/icons/passive_gun.webp',
      desc: '每回合对敌人额外造成 10 点伤害，并有 5% 概率直接秒杀。' },
    naihuo: { id: 'naihuo', name: '耐活王', icon: '🧱', art: 'assets/img/art/icons/passive_turtle.webp',
      desc: '每 2 个战斗回合：防御力 +10%（向上取整，本场内叠加）。' }
  };

  // ---------------------------------------------------------------
  // 11 个阶段
  // skills.kind: attack / buff_atk / buff_def / heal / debuff_media
  // reward.type: stats / stats_roll / boss_choice / boost
  // ---------------------------------------------------------------
  S.STAGES = [
    {
      id: 1, type: 'battle', title: '第一关：优越的士兵', scene: '老东京街道',
      bg: '东京旧街，两侧贴满“大东亚共荣”旧海报。',
      name: '优越的士兵', emoji: '🪖', tag: '老旧军装残影',
      enemy: { hp: 150, atk: 20, def: 15, speed: 28 },
      skills: [
        { name: '优越冲锋', cost: 2, kind: 'attack', mult: 1.0, text: '低等存在！接受帝国的铁蹄吧！' },
        { name: '血统傲慢', cost: 1, kind: 'buff_atk', dur: 2, text: '我可是高贵的帝国军人！' }
      ],
      pre: [
        ['enemy', '你这种人，也敢踏入帝国的土地？'],
        ['sun', '哟，第一关就开始摆优越感了？'],
        ['sun', '你谁啊？路边 NPC 也敢跟孙哥叫板？'],
        { fx: 'flash' }
      ],
      victory: [
        ['enemy', '唔……帝国的……荣光……'],
        ['sys', '敌方残影已清除。']
      ],
      reward: {
        title: '攻击力 +5 / 防御力 +5', explain: '【嘴硬铁拳】【防弹脸皮】', atk: 5, def: 5
      },
      after: [
        ['sys', '获得被动意义上的成长：攻击力 +5、防御力 +5。'],
        ['sun', '这就开始加属性了？不错。至少挨骂的时候更抗揍了。']
      ]
    },
    {
      id: 2, type: 'battle', title: '第二关：共荣的士兵', scene: '昭和旧街区',
      bg: '墙壁上写着“八纮一宇”，残影高举武器。',
      name: '共荣的士兵', emoji: '🪖', tag: '狂热残影',
      enemy: { hp: 200, atk: 25, def: 20, speed: 30 },
      skills: [
        { name: '狂热冲锋', cost: 2, kind: 'attack', mult: 1.5, text: '为了帝国！为了共荣！' },
        { name: '共荣号令', cost: 1, kind: 'buff_atk', dur: 2, text: '板载！！！' }
      ],
      pre: [
        ['enemy', '为了帝国！为了共荣！'],
        ['sun', '你吼那么大声干什么嘛！共荣？'],
        ['sun', '你们先把福岛核食吃干净，再来说共荣。老子在成都吃个辣子鸡都比你有精神。'],
        ['enemy', '板载！！！'],
        ['sun', '你在这一口一个板载。板你莱莱个腿。'],
        { fx: 'flash' }
      ],
      victory: [
        ['sys', '攻击力 +5。防御力 +5。'],
        ['sun', '攻击防御什么的随便加。关键是我嘴巴已经开始热了。']
      ],
      reward: { title: '攻击力 +5 / 防御力 +5', explain: '嘴炮值稳步上升', atk: 5, def: 5 },
      after: []
    },
    {
      id: 3, type: 'reward', title: '奖励关：抽象小卖部', scene: '招核空间·奇怪小卖部',
      bg: '货架上摆着辣子鸡、泡面和发着红光的罐子。',
      name: '抽象小卖部', emoji: '🏪',
      reward: {
        type: 'choice',
        intro: [['sys', '检测到宿主生命能量不足。请选择补给方案。']],
        choices: [
          { id: 'heal', name: '回血', icon: '🍗',
            desc: '生命/能量回满。买一份辣子鸡。',
            lines: [['sun', '满血复活。辣得老子想立刻冲进国会把高市早苗的假发扯下来。']] },
          { id: 'stats', name: '强化', icon: '💪',
            desc: '攻击 +5、防御 +5。',
            lines: [['sun', '力量不够，嘴也白搭。'], ['sun', '（拿激光笔照自己眼睛）痛。但值得。']] }
        ]
      }
    },
    {
      id: 4, type: 'boss', title: 'Boss：东条英机', scene: '东京审判遗址废墟',
      bg: '断壁残垣间，一个军装残影矗立。',
      name: '东条英机', emoji: '🥸', tag: '招核残影·战争执念体',
      enemy: { hp: 290, atk: 35, def: 17, speed: 30 },
      skills: [
        { name: '玉碎冲锋', cost: 2, kind: 'attack', mult: 1.52, text: '帝国军人，宁死不退！' },
        { name: '军令如山', cost: 1, kind: 'buff_def', dur: 2, text: '听令！防御阵型！' },
        { name: '帝国残影', cost: 1, kind: 'heal_buff', ratio: 0.08, dur: 2, text: '帝国的残影，不会消亡……' }
      ],
      pre: [
        ['enemy', '帝国不会亡……大东亚共荣是正义伟业……'],
        ['sun', '东条桑。你就是那个把国家带成焦土的“帝国之脑”？'],
        ['sun', '我看你脖子上顶的是个装饰品。还正义伟业？你让整个国家陪你玉碎。'],
        ['sun', '你碎完了还嘴硬。今天孙哥给你补一节历史课。课名叫——《别惹你孙哥》。'],
        { fx: 'boss' }
      ],
      victory: [
        ['enemy', '玉碎……冲锋……'],
        ['sun', '你冲个锤子。'],
        ['sun', '（挥出）带带重拳！鬼畜循环！'],
        ['enemy', '唔……帝国……不会……'],
        ['sys', 'Boss 残影崩解。']
      ],
      reward: {
        type: 'boss_choice',
        choices: [
          { id: 'stats', name: '属性强化', icon: '⚔️', desc: '攻击 +5、防御 +5',
            lines: [['sun', '力量，我要力量。']] },
          { id: 'passive', name: '军国不再的武士道', icon: '⚔️',
            desc: S.PASSIVES.bushidou.desc, passive: 'bushidou',
            lines: [['sun', '武士道？一脚踢开。还是拿来垫泡面吧。'],
                    ['sys', '获得被动：军国不再的武士道。']] }
        ],
        after: []
      }
    },
    {
      id: 5, type: 'battle', title: '第五关：昭和男儿', scene: '旧式居酒屋',
      bg: '神风头带、旧学生制服的肌肉男挡住去路。',
      name: '昭和男儿', emoji: '💪', tag: '狂热旧魂',
      enemy: { hp: 300, atk: 45, def: 25, speed: 30 },
      skills: [
        { name: '板载冲锋', cost: 2, kind: 'attack', mult: 1.9, text: '板载！昭和之魂不灭！' },
        { name: '昭和根性', cost: 1, kind: 'buff_atk', dur: 2, text: '让敌人见识大和男儿的根性！' }
      ],
      pre: [
        ['enemy', '板载！昭和之魂不灭！让敌人见识大和男儿的根性！'],
        ['sun', '你这身打扮。我以为昭和男儿都进博物馆了。'],
        { fx: 'flash' }
      ],
      victory: [
        ['sun', '昭和结束了。你也该下班了。'],
        ['enemy', '……板……载……'],
        { scene: '老唱片突然开始转动……' },
        ['sun', '什么声音？这年代还有人放这个？'],
        ['sys', '50% 概率判定被动「昭和的声音」……']
      ],
      reward: { title: '攻击力 +5 / 防御力 +5', atk: 5, def: 5,
        rollPassive: { id: 'shouwa_voice', chance: 0.5 } },
      after: []
    },
    {
      id: 6, type: 'battle', title: '第六关：平成社畜', scene: '深夜东京办公室',
      bg: '堆满文件、报表与咖啡杯的格子间。',
      name: '平成社畜', emoji: '🧑‍💼', tag: 'KPI 受害者',
      enemy: { hp: 500, atk: 30, def: 40, speed: 26 },
      skills: [
        { name: '过劳死冲锋', cost: 2, kind: 'attack', mult: 1.5, text: '不能在这里倒下……' },
        { name: 'KPI 压迫', cost: 1, kind: 'debuff_media', dur: 2, text: '这个月的 KPI，你背！' },
        { name: '加班通知', cost: 1, kind: 'buff_def', dur: 2, text: '今晚全员通宵！' }
      ],
      pre: [
        ['enemy', '我加班了72小时……这个月的 KPI……不能在这里倒下……'],
        ['sun', '兄弟。你这不是 Boss。你这是劳动法的受害者。'],
        { fx: 'flash' }
      ],
      victory: [
        ['enemy', '我的 KPI……'],
        ['sun', 'KPI？人都没了还 KPI。'],
        { scene: '旁边的电饭锅发出微光……' },
        ['sun', '这锅比你有用。'],
        ['sys', '50% 概率判定被动「廉价小锅」……']
      ],
      reward: { title: '攻击力 +5 / 防御力 +5', atk: 5, def: 5,
        rollPassive: { id: 'cheap_pot', chance: 0.5 } },
      after: []
    },
    {
      id: 7, type: 'reward', title: '休息关：带带温泉', scene: '带带温泉旅馆',
      bg: '温泉门口霓虹灯闪烁：“带带温泉”。',
      name: '带带温泉', emoji: '♨️',
      reward: {
        type: 'choice',
        intro: [['sun', '打了这么久。终于知道给孙哥安排员工福利了。']],
        choices: [
          { id: 'heal', name: '泡汤回血', icon: '♨️', desc: '生命/能量回满。',
            lines: [['sun', '生命能量回满。嘴臭值 MAX。高市早苗，你孙哥现在浑身是劲儿。']] },
          { id: 'stats', name: '强化', icon: '💪', desc: '攻击 +5、防御 +5。',
            lines: [['sun', '泡完不能白泡。（做两个俯卧撑）攻击防御 +5。'],
                    ['sun', '我孙笑川现在不是普通人了。是肌肉孙哥。']] }
        ]
      }
    },
    {
      id: 8, type: 'boss', title: 'Boss：安倍晋三', scene: '奈良街道',
      bg: '黑色轿车与演讲台残影之间，西装残影正在演讲。',
      name: '安倍晋三', emoji: '🕴️', tag: '招核残影·经济执念体',
      enemy: { hp: 500, atk: 50, def: 40, speed: 34 },
      skills: [
        { name: '量化宽松', cost: 1, kind: 'heal', ratio: 0.15, text: '继续放水，经济总会好起来的。' },
        { name: '安保法', cost: 1, kind: 'buff_def', dur: 2, text: '为了安全，请配合检查。' },
        { name: '经济再生', cost: 2, kind: 'buff_atk', dur: 2, text: '为了经济复苏！' }
      ],
      pre: [
        ['enemy', '为了让日本再次强大。我推出了安倍经济学……你们为何不理解？'],
        ['sun', '三支箭？第一支射经济。第二支射股市。第三支射孙哥？'],
        ['sun', '你这经济学是不是学到一半去学射击了？'],
        ['enemy', '为了经济复苏！'],
        ['sun', '复苏个锤子。（抽象破防拳！）'],
        { fx: 'boss' }
      ],
      victory: [
        ['enemy', '……经济学……没有……错……'],
        ['sun', '行了，下去跟东条桑挤一挤吧。'],
        ['sys', 'Boss 残影崩解。']
      ],
      reward: {
        type: 'boss_choice',
        choices: [
          { id: 'stats', name: '铁壁强化', icon: '🛡️', desc: '防御 +10',
            lines: [['sun', '脸皮再厚一点，谁也喷不动我。']] },
          { id: 'passive', name: '日服男枪', icon: '🔫', desc: S.PASSIVES.gun.desc,
            passive: 'gun',
            lines: [['sys', '获得被动：日服男枪。'], ['sun', '一枪入魂，懂？']] }
        ],
        after: []
      }
    },
    {
      id: 9, type: 'battle', title: '第九关：令和废物', scene: '东京网吧包间',
      bg: '泡面、手办、漫画与显示器堆成的堡垒。',
      name: '令和废物', emoji: '🦥', tag: '究极宅男',
      enemy: { hp: 600, atk: 10, def: 60, speed: 22 },
      skills: [
        { name: '缩壳防御', cost: 1, kind: 'buff_def', dur: 2, text: '只要我不出门，就没人能伤害我……' },
        { name: '摆烂回血', cost: 1, kind: 'heal', ratio: 0.15, text: '让我在二次元里安静地待着……' }
      ],
      pre: [
        ['enemy', '只要我不出门。就没人能伤害我……让我在二次元里安静地待着……'],
        ['sun', '你这防御力。是因为根本没人想打你吧？'],
        { fx: 'flash' }
      ],
      victory: [
        ['sun', '防御 60？你不是令和废物。你是令和龟仙人。'],
        ['sys', '50% 概率判定被动「耐活王」……']
      ],
      reward: { title: '防御力 +5', def: 5,
        rollPassive: { id: 'naihuo', chance: 0.5 } },
      after: []
    },
    {
      id: 10, type: 'boost', title: '最终战前整备', scene: '日本国会议事堂',
      bg: '黑云压城，风声猎猎。',
      name: '最终战前整备', emoji: '🌩️',
      reward: { type: 'boost', atk: 10, def: 10 },
      lines: [
        ['sys', '最终战前整备。生命能量回满。攻击力 +10。防御力 +10。'],
        { scene: '孙笑川穿上【抽象战甲】，手持【带带激光笔 MAX】……' },
        ['sun', '我现在浑身是梗。高市早苗。我要让你见识一下什么叫中华抽象文化。'],
        ['sun', '你的右翼执念。今天由我来超度。'],
        ['sys', '最终战即将开始。请宿主管理好自己的嘴。'],
        ['sun', '管嘴？我的嘴就是武器。懂又不懂。']
      ]
    },
    {
      id: 11, type: 'finalBoss', title: '最终 Boss：高市早苗', scene: '国会议事堂屋顶',
      bg: '天空裂开巨大的红色鸟居，四面屏幕播放演讲。',
      name: '高市早苗', emoji: '👩‍💼', tag: '招核残影·最终执念体',
      enemy: { hp: 1000, atk: 70, def: 50, speed: 36, scale: 1.5 },
      skills: [
        { name: '右翼演讲', cost: 1, kind: 'buff_atk', dur: 2, text: '为了伟大的日本！' },
        { name: '媒体操控', cost: 1, kind: 'debuff_media', dur: 2, text: '新闻！紧急报道！舆论风向！' },
        { name: '修宪强军', cost: 2, kind: 'buff_atk_big', dur: 2, text: '红色鸟居升起——大和民族，站起来！' }
      ],
      pre: [
        ['enemy', '我是日本未来的总理！我要恢复伟大日本！你们这些外人休想阻止！'],
        ['sun', '高市桑。你一个政客不好好搞经济。天天拜鬼、改宪、扩军。'],
        ['sun', '还未来总理？我看你是未来挨打冠军。'],
        ['sun', '你头发盘得再高，也高不过你的野心。你口号喊得再响，也响不过我直播间弹幕。'],
        ['sun', '来。今天孙哥就让你知道。嘴皮子也是武器。'],
        ['enemy', '劣等主播，也配与我对话！'],
        ['sun', '我劣等？老子是网上骂不死的小强。你是选票选不上的魔怔人。'],
        ['sun', '咱俩谁比谁高贵？废话少说。开蘸！'],
        { fx: 'boss' }
      ],
      victory: [
        ['enemy', '伟大的日本……不会结束……'],
        ['sun', '伟大的日本会不会结束我不知道。但你的招核幻境结束了。'],
        ['sun', '回去告诉那帮右翼。别整天招核了。好好过令和日子。'],
        { fx: 'flash' }
      ]
    }
  ];

  // 序章
  S.PROLOGUE = [
    { scene: '序章：被选中的抽象者' },
    { scene: '成都出租屋 · 深夜直播中' },
    ['sun', '你们这些狗粉丝，天天来直播间找存在感。你吼那么大声干什么嘛！'],
    ['sun', '我打得菜？我打得菜你去找物管啊！'],
    { fx: 'crash' },
    { scene: '电脑突然蓝屏……屏幕中央浮现红色大字' },
    ['sys', '你想改变被网暴的命运吗？想获得真正力量吗？'],
    ['sys', '点击【はい】领取日服讨伐资格。'],
    ['sun', '这什么弱智钓鱼网站？'],
    { fx: 'auto_click' },
    ['sys', '……鼠标，自己动了。'],
    { fx: 'flash' },
    { scene: '黑灰色的东京街道 · 远处响起老旧军歌' },
    ['sys', '系统绑定完成。宿主：孙笑川。'],
    ['sys', '正在检测抽象值……嘴臭值……耐活值……'],
    ['sys', '特殊技能已解锁——【把嘴给我闭上】。'],
    ['sys', '你的任务很简单。击败 11 个阶段的敌人。最终击败高市早苗。清除招核残影。'],
    ['sun', '我不干呢？'],
    ['sys', '拒绝任务。宿主将永久困于招核空间。'],
    ['sun', '……'],
    ['sun', '爬。先看看第一关是哪个倒霉蛋。'],
    { scene: '主线任务开始：讨伐 11 个阶段' }
  ];

  // 结局
  S.ENDING = [
    { fx: 'flash' },
    { scene: '成都出租屋 · 电脑恢复正常' },
    ['sun', '玩个蛇。老子刚刚去拯救世界。点个关注。下次带你们一起打高市早苗。'],
    ['sun', '滚！你们根本不爱我。'],
    { scene: '……黑屏……' },
    ['sys', '招核危机已解除。宿主获得称号：【招核讨伐者】。'],
    ['sys', '但检测到新的执念正在生成……'],
    ['sun', '还来？我打你……'],
    { scene: 'END' }
  ];

  global.StoryData = S;
})(window);
