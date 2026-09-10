/*
 * dialogue.js —— 沉浸式剧情演出引擎
 * 支持：打字机逐字、点击/空格/回车继续、电影黑边、场景卡、说话人头像名牌、
 *       弹幕 / 闪屏 / 崩溃 / Boss 登场等演出，及“跳过剧情”（必须玩家主动点击）。
 */
(function (global) {
  'use strict';

  let root = null;
  let els = {};
  let busy = false;

  function $(id) { return document.getElementById(id); }

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'dlg-root';
    root.className = 'dlg-root hidden';
    function child(tag, cls, id, text) {
      const el = document.createElement(tag);
      el.className = cls;
      if (id) el.id = id;
      if (text) el.textContent = text;
      root.appendChild(el);
      return el;
    }
    // v2.1 美术重制：场景美术底图层（按场景文本匹配 bg_01..bg_16）
    els.bg = child('div', 'dlg-bg');
    child('div', 'dlg-bar dlg-bar-top');
    child('div', 'dlg-bar dlg-bar-bottom');
    els.fx = child('div', 'dlg-fxlayer');
    els.scene = child('div', 'dlg-scene', 'dlg-scene');
    els.portrait = child('div', 'dlg-portrait', 'dlg-portrait');
    els.speaker = child('div', 'dlg-speaker', 'dlg-speaker');
    els.text = child('div', 'dlg-text', 'dlg-text');
    els.next = child('div', 'dlg-next', 'dlg-next', '▼ 点击 / 空格 继续');
    els.skip = child('button', 'dlg-skip', 'dlg-skip', '⏭ 跳过');
    els.skip.title = '跳过本段剧情';
    document.body.appendChild(root);
  }

  // 场景文本 → 美术底图（按关键词匹配，顺序即优先级）
  const SCENE_BG = [
    ['序章', 'bg_01'],
    ['蓝屏', 'bg_02'],
    ['老东京街道', 'bg_05'],
    ['东京街道', 'bg_03'],
    ['诡异舞蹈', 'bg_04'],
    ['小卖部', 'bg_07'],
    ['审判', 'bg_08'],
    ['居酒屋', 'bg_09'],
    ['办公室', 'bg_10'],
    ['温泉', 'bg_11'],
    ['奈良', 'bg_12'],
    ['网吧', 'bg_13'],
    ['屋顶', 'bg_15'],
    ['议事堂', 'bg_14'],
    ['恢复正常', 'bg_16'],
    ['出租屋', 'bg_01']
  ];
  function sceneBg(text) {
    if (!text) return null;
    for (let i = 0; i < SCENE_BG.length; i++) {
      if (text.indexOf(SCENE_BG[i][0]) >= 0) {
        return 'assets/img/art/bg/' + SCENE_BG[i][1] + '.webp';
      }
    }
    return null;
  }

  const DEFAULT_NAMES = { sun: '孙笑川', enemy: '？？？', sys: '系统' };
  const DEFAULT_ICONS = { sun: '😎', sys: '🖥️' };

  let current = null; // {seq, i, opts, done, skipTimer}
  let typeTimer = null;
  let typeSpeed = 24; // 逐字毫秒（设置可调）
  let watchdogTimer = null; // 防卡死：长时间无推进则自动下一句

  function cancelTimers() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    if (current && current.skipTimer) { clearTimeout(current.skipTimer); current.skipTimer = null; }
  }

  function finishTyping() {
    if (!current) return;
    const item = current.seq[current.i];
    els.text.textContent = item[1] || '';
    els.text.classList.add('full');
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    els.next.classList.remove('hidden');
  }

  function nextLine() {
    if (!current) return;
    if (typeTimer) { finishTyping(); return; }
    current.i += 1;
    if (current.i >= current.seq.length) { endSequence(false); return; }
    renderItem(current.seq[current.i]);
  }

  function watchdog() {
    if (!current) return;
    const now = Date.now();
    const item = current.seq[current.i];
    const isAuto = item && (item.scene !== undefined || item.fx);
    // 场景/演出自带计时器：超时未推进则强制跳过（兜底演出异常）
    if (isAuto && current.stuckAt && now - current.stuckAt > 8000) {
      if (global.console) console.warn('[剧情看门狗] 自动演出 8s 未推进，强制跳过');
      nextLine();
      return;
    }
    // 打字进行中但长时间无字符输出：说明打字机异常，直接整句显示
    if (typeTimer && current.typingStart && now - current.typingStart > 12000) {
      if (global.console) console.warn('[剧情看门狗] 打字机异常，直接显示整句');
      cancelTimers();
      finishTyping();
    }
    // 文本已打完等待点击：不自动跳过
  }

  function bindInput() {
    const onKey = function (e) {
      if (!current) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        nextLine();
      }
    };
    const onClick = function (e) {
      if (!current) return;
      if (e.target === els.skip) return;
      nextLine();
    };
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    els.skip.addEventListener('click', function (e) {
      e.stopPropagation();
      if (current) endSequence(true);
    });
    current._unbind = function () {
      if (root && typeof root.removeEventListener === 'function') root.removeEventListener('click', onClick);
      if (document && typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKey);
    };
  }

  // 演出效果（不阻塞逻辑，只做视觉）
  function fxEffect(kind, payload) {
    if (kind === 'flash') {
      els.fx.innerHTML = '<div class="dlg-flash"></div>';
      setTimeout(function () { els.fx.innerHTML = ''; }, 480);
      return 420;
    }
    if (kind === 'crash') {
      els.fx.innerHTML = '<div class="dlg-crash">蓝屏 · 错误代码 404-抽象</div>';
      setTimeout(function () { els.fx.innerHTML = ''; }, 950);
      return 850;
    }
    if (kind === 'boss') {
      els.fx.innerHTML = '<div class="dlg-boss-fx">⚠ BOSS 战意涌来 ⚠</div>';
      setTimeout(function () { els.fx.innerHTML = ''; }, 1500);
      return 1400;
    }
    if (kind === 'shake') {
      root.classList.remove('dlg-shake'); void root.offsetWidth;
      root.classList.add('dlg-shake');
      setTimeout(function () { root.classList.remove('dlg-shake'); }, 500);
      return 420;
    }
    if (kind === 'auto_click') {
      els.fx.innerHTML = '<div class="dlg-cursor">🖱️ ……鼠标自己动了</div>';
      setTimeout(function () { els.fx.innerHTML = ''; }, 900);
      return 750;
    }
    if (kind === 'danmaku') {
      const lines = (payload && payload.danmaku) || ['？？？'];
      const frag = document.createDocumentFragment();
      lines.forEach(function (txt, idx) {
        const span = document.createElement('span');
        span.className = 'dlg-danmaku';
        span.textContent = txt;
        span.style.top = (8 + idx * 9) + '%';
        span.style.animationDelay = (idx * 0.45) + 's';
        frag.appendChild(span);
      });
      els.fx.appendChild(frag);
      setTimeout(function () { els.fx.innerHTML = ''; }, 3600);
      return 3200;
    }
    return 400;
  }

  function renderSceneCard(text) {
    try {
      els.text.classList.remove('full');
      els.text.textContent = '';
      els.speaker.textContent = '—— 场景 ——';
      els.speaker.className = 'dlg-speaker scene';
      els.portrait.className = 'dlg-portrait scene';
      els.portrait.innerHTML = '';
      // v2.1 美术重制：按场景切换背景
      const bg = sceneBg(text);
      if (bg) {
        els.bg.style.backgroundImage = 'url("' + bg + '")';
      }
      els.scene.textContent = text;
      els.scene.classList.remove('hide');
      void els.scene.offsetWidth;
      els.scene.classList.add('pop');
      els.next.classList.add('hidden');
      current.skipTimer = setTimeout(function () {
        els.scene.classList.add('hide');
        nextLine();
      }, 1500);
    } catch (err) {
      if (global.console) console.error('场景演出异常:', err);
      current.skipTimer = setTimeout(function () { nextLine(); }, 300);
    }
  }

  function renderFx(kind, payload) {
    els.next.classList.add('hidden');
    const ms = fxEffect(kind, payload);
    current.skipTimer = setTimeout(function () { nextLine(); }, ms);
  }

  function typeText(text) {
    try {
      current.typingStart = Date.now();
      els.text.textContent = '';
      els.text.classList.remove('full');
      els.next.classList.add('hidden');
      let i = 0;
      typeTimer = setInterval(function () {
        i += 1;
        els.text.textContent = text.slice(0, i);
        if (i >= text.length) { finishTyping(); }
      }, typeSpeed);
    } catch (err) {
      if (global.console) console.error('打字机异常:', err);
      finishTyping();
    }
  }

  function renderItem(item) {
    try {
      current.stuckAt = Date.now();
      if (current.skipTimer) { clearTimeout(current.skipTimer); current.skipTimer = null; }
      els.scene.classList.add('hide');
      if (item && item.scene !== undefined) { renderSceneCard(item.scene); return; }
      if (item && item.fx) { renderFx(item.fx, item); return; }

      const who = item[0];
      const text = String(item[1] === undefined ? '' : item[1]);
      const names = (current.opts && current.opts.names) || DEFAULT_NAMES;
      const icons = (current.opts && current.opts.icons) || DEFAULT_ICONS;
      // v2.1 美术重制：默认说话人立绘 = 本地美术资源；调用方可覆盖
      const portraits = Object.assign(
        {
          sun: 'assets/img/art/characters/sun.webp',
          sys: 'assets/img/art/characters/sys.webp'
        },
        (current.opts && current.opts.portraits) || {}
      );
      const boss = current.opts && current.opts.boss;
      const name = names[who] || who;
      const icon = (who === 'enemy' && current.opts && current.opts.enemyIcon)
        ? current.opts.enemyIcon
        : (icons[who] || '💬');

      els.speaker.textContent = name;
      els.speaker.className = 'dlg-speaker ' + who + (boss ? ' boss' : '');
      els.portrait.className = 'dlg-portrait ' + who + (boss ? ' boss' : '');
      // 立绘头像：说话人 → 立绘路径（本地美术 > 照片 > Emoji）
      let portraitHTML = '<span class="dp-icon">' + icon + '</span>';
      const pv = portraits[who];
      if (pv) {
        const cdef = (global.Characters && global.Characters.CHARACTERS[pv]) || null;
        if (cdef) {
          if (cdef.art && cdef.artOk !== false) {
            portraitHTML = '<img class="dp-photo" src="' + cdef.art + '" alt="' + (cdef.name || '') + '">';
          } else if (cdef.photo && cdef.photoOk) {
            portraitHTML = '<img class="dp-photo" src="' + cdef.photo + '" alt="' + (cdef.name || '') + '">';
          }
        } else {
          portraitHTML = '<img class="dp-photo" src="' + pv + '" alt="' + String(name).replace(/[<>&"]/g, '') + '">';
        }
      }
      els.portrait.innerHTML = portraitHTML;
      typeText(text);
    } catch (err) {
      if (global.console) console.error('对白条目异常，自动跳过:', err);
      current.skipTimer = setTimeout(function () { nextLine(); }, 200);
    }
  }

  function endSequence(skipped) {
    cancelTimers();
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    if (current && current._unbind) current._unbind();
    const cb = current && current.opts && current.opts.onDone;
    const onSkip = current && current.opts && current.opts.onSkip;
    const resolved = { skipped: !!skipped };
    const resolve = current ? current.resolve : null;
    current = null;
    busy = false;
    root.classList.add('hidden');
    els.scene.classList.add('hide');
    if (skipped && onSkip) { try { onSkip(); } catch (e) { /* ignore */ } }
    if (cb) { try { cb(resolved); } catch (e) { /* ignore */ } }
    if (resolve) resolve(resolved);
  }

  // 播放一段剧情
  function play(seq, opts) {
    ensureRoot();
    opts = opts || {};
    return new Promise(function (resolve) {
      if (busy) { resolve({ skipped: false }); return; }
      busy = true;
      root.classList.remove('hidden');
      current = {
        seq: seq || [], i: 0, opts: opts,
        skipTimer: null,
        stuckAt: Date.now(),
        resolve: resolve
      };
      if (!watchdogTimer) watchdogTimer = setInterval(watchdog, 3000);
      bindInput();
      if (!seq || seq.length === 0) { endSequence(false); return; }
      renderItem(seq[0]);
    });
  }

  // 测试/快速模式：直接结束
  function skipAll() {
    if (current) endSequence(true);
  }

  global.StoryDialogue = {
    play: play,
    skipAll: skipAll,
    setSpeed: function (ms) { typeSpeed = Math.max(0, ms); },
    isBusy: function () { return busy; },
    _rootEl: function () { return root; },
    _debug: function () {
      const item = current ? current.seq[current.i] : null;
      return {
        busy: busy, i: current ? current.i : -1,
        len: current ? current.seq.length : 0,
        kind: item ? (item.scene !== undefined ? 'scene' : (item.fx ? 'fx' : 'text')) : 'none',
        typing: !!typeTimer, skipTimer: !!(current && current.skipTimer)
      };
    }
  };
})(window);
