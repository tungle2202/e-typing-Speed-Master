/**
 * e-typing Sentence Hider (module độc lập)
 * Ẩn câu cần gõ (#sentenceText span) ngay khi vào trang, không phụ thuộc trạng thái / chế độ của engine.
 *
 * - Mặc định BẬT: #sentenceText span { opacity: 0 }. Phím F7 bật / tắt (tắt: opacity: 1).
 *   Trạng thái bật / tắt lưu trong chrome.storage (etm_hide_enabled) và đồng bộ giữa các frame.
 * - Khi đang BẬT mà phát hiện gõ sai (#miss-type-screen chớp display:block, hoặc engine báo qua reportMiss()),
 *   tạm hiện câu (opacity: 1) cho tới khi trang load câu mới thì ẩn lại.
 * - #sentenceText .entered { opacity: 1 } luôn được áp dụng, bất kể bật / tắt hay gõ sai.
 */
(function() {
  'use strict';

  if (window.ETypingHider) return;

  const STYLE_ID = 'etyping-master-hider-style';
  const STORAGE_KEY = 'etm_hide_enabled';
  const MISS_ID = 'miss-type-screen';
  const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

  // .entered có độ ưu tiên selector cao hơn "#sentenceText span" nên luôn thắng (cả hai đều !important)
  const ENTERED_CSS = '#sentenceText .entered { opacity: 1 !important; }';
  const HIDDEN_CSS = '#sentenceText span { opacity: 0 !important; }';
  const VISIBLE_CSS = '#sentenceText span { opacity: 1 !important; }';

  let enabled = true;
  let revealed = false;
  // Số ký tự đã gõ của câu đang tạm hiện; giảm xuống nghĩa là trang đã sang câu mới
  let lastEnteredLength = 0;

  function getStyleElement() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function render() {
    const hide = enabled && !revealed;
    getStyleElement().textContent = `${hide ? HIDDEN_CSS : VISIBLE_CSS}\n${ENTERED_CSS}`;
  }

  // Độ dài phần đã gõ của dòng romaji; -1 khi không có câu nào trên trang
  function getEnteredLength() {
    if (!document.getElementById('sentenceText')) return -1;
    let length = 0;
    for (const span of document.querySelectorAll('#sentenceText span.entered')) {
      const text = (span.textContent || '').replace(/\s+/g, '');
      if (!JAPANESE_RE.test(text)) length = Math.max(length, text.length);
    }
    return length;
  }

  function setEnabled(value) {
    enabled = value !== false;
    revealed = false;
    render();
  }

  // Phát hiện gõ sai: chỉ có tác dụng khi module đang bật và đang ở giữa một câu
  function reportMiss() {
    if (!enabled || revealed) return;
    const length = getEnteredLength();
    if (length < 0) return;
    revealed = true;
    lastEnteredLength = length;
    render();
  }

  // Khi câu mới được load (phần đã gõ bị reset, hoặc câu biến mất) -> ẩn lại
  function checkSentenceChange() {
    if (!revealed) return;
    const length = getEnteredLength();
    if (length < lastEnteredLength) {
      revealed = false;
      render();
      return;
    }
    lastEnteredLength = length;
  }

  // #miss-type-screen chỉ bật display:block trong khoảnh khắc. Observer giữ lại giá trị cũ (oldValue)
  // của mỗi lần đổi thuộc tính, nên vẫn bắt được cả khi trang đã ẩn lại trước khi callback chạy.
  function isMissRecord(record) {
    if (record.type !== 'attributes' || record.target.id !== MISS_ID) return false;
    if (/display\s*:\s*block/i.test(record.oldValue || '')) return true;
    const el = record.target;
    return el.style.display === 'block' || getComputedStyle(el).display !== 'none';
  }

  function observe() {
    const observer = new MutationObserver((records) => {
      // Kiểm tra đổi câu trước: một lần gõ sai ngay đầu câu mới không bị tính nhầm cho câu cũ
      checkSentenceChange();
      if (records.some(isMissRecord)) reportMiss();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
      attributeOldValue: true
    });
  }

  function saveEnabled(value) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: value });
    } catch (e) {}
  }

  // F7: bật / tắt module (áp dụng ngay ở frame hiện tại, các frame khác đồng bộ qua storage)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F7' && e.code !== 'F7') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    setEnabled(!enabled);
    saveEnabled(enabled);
    console.log(`[e-typing Hider] Ẩn câu: ${enabled ? 'BẬT' : 'TẮT'}`);
  }, true);

  render();
  observe();

  try {
    chrome.storage.local.get(STORAGE_KEY, (values) => {
      if (values && values[STORAGE_KEY] !== undefined && values[STORAGE_KEY] !== enabled) {
        setEnabled(values[STORAGE_KEY]);
      }
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      if (changes[STORAGE_KEY].newValue !== enabled) setEnabled(changes[STORAGE_KEY].newValue);
    });
  } catch (e) {}

  window.ETypingHider = {
    reportMiss,
    isEnabled: () => enabled,
    isRevealed: () => revealed
  };
})();
