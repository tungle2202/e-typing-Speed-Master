/**
 * e-typing Background Service Worker - Camouflage
 * Đổi trang popup theo etm_camouflage (phím F6 trên trang bật / tắt, xem content/camouflage.js):
 * - bật:  popup/camouflage.html (nội dung giả, trung tính)
 * - tắt:  popup/popup.html (popup điều khiển thật)
 * Chỉ đổi trang popup cho lần mở tiếp theo; mọi tính năng trên trang vẫn chạy bình thường.
 */
'use strict';

const STORAGE_KEY = 'etm_camouflage';
const REAL_POPUP = 'popup/popup.html';
const CAMOUFLAGE_POPUP = 'popup/camouflage.html';

function applyCamouflage(enabled) {
  chrome.action.setPopup({ popup: enabled ? CAMOUFLAGE_POPUP : REAL_POPUP });
}

function applyFromStorage() {
  chrome.storage.local.get(STORAGE_KEY, (values) => {
    applyCamouflage(values[STORAGE_KEY] === true);
  });
}

// setPopup không được lưu khi trình duyệt khởi động lại -> áp dụng lại từ storage
chrome.runtime.onStartup.addListener(applyFromStorage);
chrome.runtime.onInstalled.addListener(applyFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
  applyCamouflage(changes[STORAGE_KEY].newValue === true);
});
