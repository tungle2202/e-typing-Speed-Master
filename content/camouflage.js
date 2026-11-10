/**
 * e-typing Camouflage Hotkey (F6)
 * F6 chỉ dành cho extension: trang web không nhận được phím này (chặn keydown / keypress / keyup).
 * Mỗi lần nhấn F6 đảo etm_camouflage; background.js đổi trang popup cho lần mở tiếp theo.
 * Không mở popup, không hiện gì trên trang, không ảnh hưởng tới engine / hider.
 */
(function() {
  'use strict';

  if (window.__etmCamouflageHotkey) return;
  window.__etmCamouflageHotkey = true;

  const STORAGE_KEY = 'etm_camouflage';

  function isF6(e) {
    return e.key === 'F6' || e.code === 'F6';
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function toggleCamouflage() {
    try {
      chrome.storage.local.get(STORAGE_KEY, (values) => {
        chrome.storage.local.set({ [STORAGE_KEY]: values[STORAGE_KEY] !== true });
      });
    } catch (e) {}
  }

  window.addEventListener('keydown', (e) => {
    if (!isF6(e)) return;
    swallow(e);
    if (!e.repeat) toggleCamouflage();
  }, true);

  window.addEventListener('keypress', (e) => { if (isF6(e)) swallow(e); }, true);
  window.addEventListener('keyup', (e) => { if (isF6(e)) swallow(e); }, true);
})();
