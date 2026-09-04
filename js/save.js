/*
 * save.js —— 故事模式存档（localStorage）
 */
(function (global) {
  'use strict';

  const KEY = 'sxc_story_v2';

  function load() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function save(run) {
    try {
      if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(run));
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  function clear() {
    try {
      if (global.localStorage) global.localStorage.removeItem(KEY);
    } catch (e) { /* ignore */ }
  }

  global.StorySave = { KEY: KEY, load: load, save: save, clear: clear };
})(window);
