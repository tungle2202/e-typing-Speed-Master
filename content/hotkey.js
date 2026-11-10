/**
 * e-typing Global Hotkey Controller
 * F8:
 * - Automatic / Semi-Auto -> Pause: chuyển sang Raw-Input, nhớ chế độ trước
 * - Raw-Input sau khi Pause -> quay lại chế độ trước và chạy tiếp
 * - Raw-Input thuần (vừa vào trang) -> không làm gì
 * Nếu phím rơi vào Top Window (focus ngoài khung bài test), engine Host chuyển lệnh xuống iframe.
 */
(function() {
  'use strict';

  function handleHotkey(e) {
    if (e.key !== 'F8' && e.code !== 'F8') return;

    // Prevent default browser/game handling
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;

    if (window.ETypingEngine) window.ETypingEngine.toggle();
  }

  // Use capturing phase (true) so the event is intercepted before game listeners
  window.addEventListener('keydown', handleHotkey, true);
})();
