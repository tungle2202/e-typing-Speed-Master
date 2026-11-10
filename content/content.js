/**
 * e-typing Content Script Bootstrap & Cross-Frame Bridge (V6)
 * - Popup -> mọi frame: lệnh điều khiển (SET_MODE, PAUSE, UPDATE_CONFIG) và GET_STATUS (chỉ Top Window trả lời).
 * - Top Window -> iframe bài test: chuyển tiếp lệnh qua postMessage (một đường duy nhất, tránh nhận trùng).
 * - Iframe -> Top Window: báo trạng thái / thống kê / chế độ để popup đọc; hỏi chế độ khi iframe vừa được tạo.
 * Mọi lệnh đều an toàn khi tới nhiều lần (popup gửi tới mọi frame, Top Window lại chuyển tiếp xuống iframe).
 */
(function() {
  'use strict';

  const isTopWindow = (window.top === window);

  // Hàm tìm kiếm chính xác iframe bài test e-typing
  function getGameIframe() {
    const selectors = [
      'iframe#typing_content',
      'iframe[name="typing_content"]',
      '#pp_full_res iframe',
      'iframe[src*="standard.asp"]',
      'iframe[src*="app"]',
      'iframe[src*="check"]'
    ];
    for (const sel of selectors) {
      const frame = document.querySelector(sel);
      if (frame && frame.contentWindow) return frame;
    }
    return null;
  }

  // Gửi lệnh xuống Frame bài test
  window.ETypingSendCommand = function(action, data = null) {
    const gameIframe = getGameIframe();
    if (!gameIframe || !gameIframe.contentWindow) return false;
    try {
      gameIframe.contentWindow.postMessage({ source: 'ETYPING_MASTER_CMD', action, data }, '*');
      return true;
    } catch (e) {
      return false;
    }
  };

  function runCommand(engine, action, data) {
    switch (action) {
      case 'SET_MODE': if (data && data.mode) engine.setMode(data.mode); break;
      case 'PAUSE': engine.pause(); break;
      case 'TOGGLE': engine.toggle(); break;
      case 'UPDATE_CONFIG': if (data) engine.updateConfig(data); break;
    }
  }

  // 1. Nhận tin nhắn từ Popup Extension (tới mọi frame trong tab)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      const { action, config, mode } = request;
      const engine = window.ETypingEngine;

      if (action === 'GET_STATUS') {
        // Chỉ Top Window trả lời, để popup luôn đọc cùng một nguồn (bản sao được iframe cập nhật)
        if (!isTopWindow) return false;
        sendResponse(engine ? {
          state: engine.state,
          mode: engine.mode,
          prevMode: engine.prevMode,
          config: engine.config,
          stats: engine.stats
        } : { state: 'UNAVAILABLE' });
        return true;
      }

      if (engine) {
        // Host tự chuyển tiếp xuống iframe; iframe nhận trực tiếp từ popup -> lệnh trùng không đổi kết quả
        runCommand(engine, action, action === 'SET_MODE' ? { mode } : config);
      }
      sendResponse({ success: true });
      return true;
    });
  }

  // 2. Lắng nghe thông điệp giữa các Frame
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    const engine = window.ETypingEngine;
    if (!engine) return;

    // A. Iframe nhận lệnh điều khiển từ Top Window
    if (event.data.source === 'ETYPING_MASTER_CMD' && !isTopWindow) {
      console.log('[Iframe Game] Nhận lệnh Master CMD:', event.data.action, event.data.data);
      runCommand(engine, event.data.action, event.data.data);
      return;
    }

    if (!isTopWindow) return;

    // B. Top Window nhận sự kiện cập nhật từ Game Frame
    if (event.data.source === 'ETYPING_FRAME_EVENT') {
      const { event: evtName, data } = event.data;
      if (evtName === 'stateChange') {
        engine.setState(data);
      } else if (evtName === 'statsUpdate') {
        engine.stats = { ...engine.stats, ...data };
        engine.notify('statsUpdate', data);
      } else if (evtName === 'modeChange') {
        engine.applyRemoteMode(data || {});
      }
      return;
    }

    // C. Iframe bài test vừa được tạo: báo chế độ đã chọn trên trang này (nếu khác raw mặc định)
    if (event.data.source === 'ETYPING_FRAME_HELLO' && engine.mode !== 'raw') {
      const msg = { source: 'ETYPING_MASTER_CMD', action: 'SET_MODE', data: { mode: engine.mode } };
      try {
        if (event.source) {
          event.source.postMessage(msg, '*');
        } else {
          window.ETypingSendCommand(msg.action, msg.data);
        }
      } catch (e) {}
    }
  });

  console.log('[e-typing V6] Khởi tạo thành công tại:', isTopWindow ? 'Top Window (UI Host)' : 'Iframe (Game Worker)');
})();
