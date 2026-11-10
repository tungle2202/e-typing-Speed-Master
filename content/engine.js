/**
 * e-typing Typing Engine (V8 - Raw-Input / Automatic / Semi-Auto)
 * Trích xuất Romaji của câu hiện tại vào buffer và làm việc theo một trong ba chế độ:
 * - raw  (mặc định mỗi lần tải trang): người dùng tự gõ, phím đi thẳng tới trang; engine chỉ theo dõi buffer,
 *        phím lệch với buffer -> ghi nhận gõ sai và tạm hiện romaji. Luôn hoạt động, không có nút điều khiển.
 * - auto: tự gõ theo WPM / Accuracy. Khi được chọn, chờ 1 phím ký tự (bị chặn) rồi mới chạy;
 *        trong lúc chạy mọi phím ký tự của người dùng đều bị chặn (F6 / F7 / F8 vẫn hoạt động).
 * - semi: mỗi phím ký tự người dùng gõ -> đẩy 1 ký tự tiếp theo trong buffer (có sai số theo Accuracy).
 *         Khi được chọn, chạy ngay.
 * Pause (F8 / popup) ở auto / semi -> chuyển sang raw và nhớ chế độ trước; F8 ở raw -> quay lại chế độ đó.
 *
 * Chế độ chỉ sống trong bộ nhớ của trang (không lưu storage): tải lại trang là về raw.
 * Top Window (Host) giữ bản sao chế độ để popup hiển thị và để báo cho iframe bài test mới được tạo.
 */
(function() {
  'use strict';

  const QWERTY_ADJACENT = {
    'a': ['s', 'q', 'z', 'w'],
    'b': ['v', 'g', 'h', 'n'],
    'c': ['x', 'd', 'f', 'v'],
    'd': ['s', 'e', 'r', 'f', 'c', 'x'],
    'e': ['w', 's', 'd', 'r'],
    'f': ['d', 'r', 't', 'g', 'v', 'c'],
    'g': ['f', 't', 'y', 'h', 'b', 'v'],
    'h': ['g', 'y', 'u', 'j', 'n', 'b'],
    'i': ['u', 'j', 'k', 'o'],
    'j': ['h', 'u', 'i', 'k', 'm', 'n'],
    'k': ['j', 'i', 'o', 'l', 'm'],
    'l': ['k', 'o', 'p'],
    'm': ['n', 'j', 'k'],
    'n': ['b', 'h', 'j', 'm'],
    'o': ['i', 'k', 'l', 'p'],
    'p': ['o', 'l'],
    'q': ['w', 'a'],
    'r': ['e', 'd', 'f', 't'],
    's': ['a', 'w', 'e', 'd', 'x', 'z'],
    't': ['r', 'f', 'g', 'y'],
    'u': ['y', 'h', 'j', 'i'],
    'v': ['c', 'f', 'g', 'b'],
    'w': ['q', 'a', 's', 'e'],
    'x': ['z', 's', 'd', 'c'],
    'y': ['t', 'g', 'h', 'u'],
    'z': ['a', 's', 'x'],
    '-': ['0', 'p', '^'],
    ',': ['m', '.'],
    '.': [',', '/']
  };

  const isHostWindow = (window.top === window && !document.getElementById('sentenceText') && !location.pathname.includes('/app/'));

  const MODES = ['raw', 'auto', 'semi'];
  // IDLE: chưa có gì | ARMED: auto chờ phím kích hoạt | WAITING_FOR_START: màn hình chờ / đếm ngược
  // TYPING: đang trong câu | BETWEEN_SENTENCES: đã hết câu, chờ trang đổi câu | COMPLETED: màn hình kết quả
  const RUNNING_STATES = ['WAITING_FOR_START', 'TYPING', 'BETWEEN_SENTENCES'];

  // Phím ký tự in được (không kèm Ctrl/Alt/Meta). Phím chức năng (F7, F8, Backspace, Enter...) đi qua bình thường
  function isCharacterKey(e) {
    return typeof e.key === 'string' && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  class TypingEngine {
    constructor() {
      this.isHost = isHostWindow;
      this.state = 'IDLE';
      this.mode = 'raw';
      // Chế độ tự động trước khi Pause sang raw; F8 ở raw sẽ quay lại chế độ này
      this.prevMode = null;

      // Cấu hình được lưu giữa các lần vào trang (settings.js). Chế độ KHÔNG nằm ở đây.
      this.config = {
        wpm: 120,
        accuracy: 90,
        humanize: true,
        autoSpace: true,
        sentenceDelay: 200
      };

      this.stats = {
        sentenceIndex: 0,
        typedChars: 0,
        errorsCount: 0,
        currentSentence: '',
        currentCharIndex: 0,
        startTime: null
      };

      // Buffer chứa câu vừa parse từ DOM; bị ghi đè mỗi khi trang chuyển sang câu mới.
      // stats.currentCharIndex là con trỏ tới ký tự tiếp theo trong buffer.
      this.buffer = '';
      // Semi-Auto: phím trước đó đã đẩy ký tự sai, phím kế tiếp bắt buộc đẩy ký tự đúng
      this.typoPending = false;
      this.typingTimer = null;
      this.stopObserving = null;
      // Mã phím (e.code) đã bị chặn ở keydown -> chặn luôn keypress / keyup tương ứng
      this.swallowedCodes = new Set();

      this.listeners = {
        stateChange: [],
        statsUpdate: [],
        modeChange: []
      };

      if (!this.isHost) {
        this.installKeyInterceptor();
      }
    }

    /* ------------------------------------------------------------------ *
     * Sự kiện
     * ------------------------------------------------------------------ */

    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }

    notify(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try { cb(data); } catch(e) {}
        });
      }

      // Đang chạy trong iframe -> gửi về Top Window để popup đọc được
      if (window.top !== window) {
        try {
          window.top.postMessage({ source: 'ETYPING_FRAME_EVENT', event, data }, '*');
        } catch (e) {}
      }
    }

    setState(newState) {
      if (this.state === newState) return;
      console.log(`[e-typing Engine] Trạng thái: ${this.state} -> ${newState}`);
      this.state = newState;
      this.notify('stateChange', newState);
    }

    notifyMode() {
      this.notify('modeChange', { mode: this.mode, prevMode: this.prevMode });
    }

    updateConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
      if (this.isHost && window.ETypingSendCommand) {
        window.ETypingSendCommand('UPDATE_CONFIG', newConfig);
      }
    }

    /* ------------------------------------------------------------------ *
     * Vòng đời trong frame bài test
     * ------------------------------------------------------------------ */

    // Gọi một lần khi frame bài test được tải: raw luôn hoạt động nên bắt đầu theo dõi DOM ngay
    boot() {
      if (this.isHost || this.stopObserving) return;

      this.stats.startTime = Date.now();
      if (window.ETypingExtractor) {
        this.stopObserving = window.ETypingExtractor.startObserving(
          (info) => this.handleDOMChange(info),
          () => this.stats
        );
        this.handleDOMChange(window.ETypingExtractor.getCurrentSentenceInfo(this.stats));
        // Vào trang giữa chừng một câu (đã gõ một phần) -> trỏ tới ký tự tiếp theo
        this.alignCursorWithEntered();
      }
      if (this.state === 'IDLE') this.setState('WAITING_FOR_START');

      // Iframe bài test mới: hỏi Top Window xem người dùng đã chọn chế độ nào trên trang này chưa
      if (window.top !== window) {
        try {
          window.top.postMessage({ source: 'ETYPING_FRAME_HELLO' }, '*');
        } catch (e) {}
      }
    }

    // Màn hình kết quả: ngừng theo dõi. Bài mới = tải lại trang (về raw)
    finish() {
      clearTimeout(this.typingTimer);
      if (this.stopObserving) {
        this.stopObserving();
        this.stopObserving = null;
      }
      this.buffer = '';
      this.setState('COMPLETED');
    }

    /* ------------------------------------------------------------------ *
     * Điều khiển chế độ (popup / F8)
     * ------------------------------------------------------------------ */

    /**
     * Chọn chế độ thủ công (popup). Gọi lại với cùng chế độ không làm gì (lệnh có thể tới nhiều lần).
     * - raw:  luôn hoạt động
     * - semi: tự Begin
     * - auto: chờ 1 phím ký tự (bị chặn) rồi mới chạy
     */
    setMode(mode) {
      if (!MODES.includes(mode) || mode === this.mode) return;

      this.prevMode = null;
      if (this.isHost) {
        this.mode = mode;
        this.notifyMode();
        if (window.ETypingSendCommand) window.ETypingSendCommand('SET_MODE', { mode });
        return;
      }

      console.log(`[e-typing Engine] Chọn chế độ: ${this.mode} -> ${mode}`);
      this.enterMode(mode, { armAuto: true });
    }

    // Pause ở auto / semi -> chuyển sang raw, nhớ chế độ trước. Ở raw không làm gì
    pause() {
      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('PAUSE');
        return;
      }
      if (this.mode === 'raw') return;

      console.log(`[e-typing Engine] Pause: ${this.mode} -> raw`);
      const prev = this.mode;
      this.enterMode('raw');
      this.prevMode = prev;
      this.notifyMode();
    }

    // F8: auto / semi -> Pause; raw sau khi Pause -> quay lại chế độ trước và chạy ngay; raw thuần -> không làm gì
    toggle() {
      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('TOGGLE');
        return;
      }
      if (this.mode !== 'raw') {
        this.pause();
        return;
      }
      if (!this.prevMode) return;

      const prev = this.prevMode;
      console.log(`[e-typing Engine] Quay lại chế độ trước: raw -> ${prev}`);
      this.prevMode = null;
      this.enterMode(prev, { armAuto: false });
    }

    // Host nhận báo cáo từ iframe: chỉ cập nhật bản sao, không gửi ngược xuống
    applyRemoteMode({ mode, prevMode }) {
      if (!this.isHost) return;
      if (MODES.includes(mode)) this.mode = mode;
      this.prevMode = prevMode || null;
    }

    enterMode(mode, { armAuto = false } = {}) {
      clearTimeout(this.typingTimer);
      this.typoPending = false;
      this.mode = mode;

      if (this.state !== 'COMPLETED') {
        if (mode === 'auto' && armAuto) {
          this.setState('ARMED');
        } else {
          this.activateCurrentMode();
        }
      }
      this.notifyMode();
    }

    // Đưa engine vào trạng thái chạy của chế độ hiện tại, tiếp tục từ vị trí đã gõ trên trang
    activateCurrentMode() {
      if (this.state === 'COMPLETED') return;

      this.alignCursorWithEntered();
      if (!this.buffer) {
        this.setState('WAITING_FOR_START');
      } else {
        this.setState(this.stats.currentCharIndex < this.buffer.length ? 'TYPING' : 'BETWEEN_SENTENCES');
      }

      if (this.mode === 'auto' && this.state === 'TYPING') {
        this.typeNextChar();
      } else if (this.mode !== 'raw' && this.state === 'WAITING_FOR_START' && window.ETypingExtractor) {
        // Màn hình chờ: cho auto / semi tự bấm Space / Start
        this.handleDOMChange(window.ETypingExtractor.getCurrentSentenceInfo(this.stats));
      }
    }

    /* ------------------------------------------------------------------ *
     * Bàn phím
     * ------------------------------------------------------------------ */

    /**
     * Bắt phím thật (isTrusted) ở capture phase của window, trước khi tới trang.
     * Sự kiện do Dispatcher phát ra có isTrusted = false nên đi qua listener này và tới game bình thường.
     */
    installKeyInterceptor() {
      const swallow = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      window.addEventListener('keydown', (e) => {
        if (!e.isTrusted || !isCharacterKey(e)) return;

        // Auto vừa được chọn: phím đầu tiên chỉ để kích hoạt, không tới trang
        if (this.mode === 'auto' && this.state === 'ARMED') {
          swallow(e);
          this.swallowedCodes.add(e.code);
          console.log('[e-typing Engine] Nhận phím kích hoạt -> Automatic chạy');
          this.activateCurrentMode();
          return;
        }

        // Auto đang chạy: mọi phím ký tự của người dùng đều bị chặn, chỉ engine gõ vào trang.
        // Phím chức năng (F6 / F7 / F8...) không phải phím ký tự nên vẫn đi qua bình thường.
        if (this.mode === 'auto' && RUNNING_STATES.includes(this.state)) {
          swallow(e);
          this.swallowedCodes.add(e.code);
          // Màn hình chờ khi tắt Auto Space: chuyển tiếp Space để người dùng vẫn tự bắt đầu được
          if (!this.buffer && e.key === ' ' && !this.config.autoSpace && window.ETypingDispatcher) {
            window.ETypingDispatcher.dispatchSpace();
          }
          return;
        }

        if (this.mode === 'semi' && RUNNING_STATES.includes(this.state)) {
          swallow(e);
          this.swallowedCodes.add(e.code);
          this.handleSemiKeystroke(e);
          return;
        }

        if (this.mode === 'raw' && RUNNING_STATES.includes(this.state)) {
          this.trackRawKeystroke(e);
        }
      }, true);

      const swallowFollowUp = (e) => {
        if (!e.isTrusted || !this.swallowedCodes.has(e.code)) return;
        swallow(e);
        if (e.type === 'keyup') this.swallowedCodes.delete(e.code);
      };
      window.addEventListener('keypress', swallowFollowUp, true);
      window.addEventListener('keyup', swallowFollowUp, true);
    }

    // Semi-Auto: mỗi phím ký tự người dùng gõ -> đẩy đúng 1 ký tự vào trang.
    // Theo Accuracy, phím đó có thể đẩy 1 ký tự sai (phím lân cận); phím kế tiếp sẽ đẩy lại ký tự đúng.
    handleSemiKeystroke(e) {
      if (!window.ETypingDispatcher) return;

      if (this.stats.currentCharIndex < this.buffer.length) {
        const nextChar = this.buffer[this.stats.currentCharIndex];

        if (!this.typoPending && this.shouldMakeTypo()) {
          const typoChar = this.getTypoChar(nextChar);
          console.log(`[Typo Simulation] Đẩy nhầm '${typoChar}' thay cho '${nextChar}'`);
          window.ETypingDispatcher.dispatchChar(typoChar);
          this.reportMissToHider();
          this.typoPending = true;
          this.stats.errorsCount += 1;
          this.notify('statsUpdate', this.stats);
          return;
        }

        this.typoPending = false;
        window.ETypingDispatcher.dispatchChar(nextChar);
        this.stats.currentCharIndex += 1;
        this.stats.typedChars += 1;
        this.notify('statsUpdate', this.stats);

        if (this.stats.currentCharIndex >= this.buffer.length) {
          console.log('[Game Frame] Đã đẩy hết buffer:', this.buffer);
          this.setState('BETWEEN_SENTENCES');
        }
        return;
      }

      // Chưa có câu nào trong buffer (màn hình chờ): chuyển tiếp Space để người dùng tự bắt đầu bài test
      if (!this.buffer && e.key === ' ') {
        window.ETypingDispatcher.dispatchSpace();
      }
    }

    /**
     * Raw-Input: phím thật đi thẳng tới trang (không chặn, không dịch, không tự gõ sai).
     * Engine chỉ so sánh với ký tự đang được trỏ trong buffer:
     * - khớp -> tiến con trỏ
     * - lệch -> ghi nhận gõ sai, tạm hiện romaji của câu hiện tại (ẩn lại khi câu mới được load)
     */
    trackRawKeystroke(e) {
      if (this.stats.currentCharIndex >= this.buffer.length) return;

      const expected = this.buffer[this.stats.currentCharIndex];
      if (e.key.toUpperCase() === expected.toUpperCase()) {
        this.stats.currentCharIndex += 1;
        this.stats.typedChars += 1;
      } else {
        console.log(`[Game Frame] Gõ tay sai: '${e.key}' (cần '${expected}') -> tạm hiện romaji`);
        this.stats.errorsCount += 1;
        this.reportMissToHider();
      }
      this.notify('statsUpdate', this.stats);

      // Trang có thể chấp nhận cách gõ romaji khác (vd: SI thay vì SHI). Sau khi trang xử lý xong phím này,
      // căn lại con trỏ theo span.entered để không bị lệch dần.
      setTimeout(() => {
        if (this.mode === 'raw') this.alignCursorWithEntered();
      }, 0);
    }

    // Đặt con trỏ buffer = số ký tự trong <span class="entered"> của trang (không đổi trạng thái engine)
    alignCursorWithEntered() {
      if (!this.buffer || !window.ETypingExtractor) return;
      const entered = window.ETypingExtractor.getEnteredText(this.buffer);
      if (entered === null) return;

      if (!this.buffer.startsWith(entered)) {
        console.warn(`[Game Frame] Phần đã gõ '${entered}' không khớp đầu buffer '${this.buffer}', vẫn đặt con trỏ theo số ký tự`);
      }

      const index = Math.min(entered.length, this.buffer.length);
      if (index === this.stats.currentCharIndex) return;
      console.log(`[Game Frame] Đồng bộ con trỏ buffer: ${this.stats.currentCharIndex} -> ${index}`);
      this.stats.currentCharIndex = index;
      this.notify('statsUpdate', this.stats);
    }

    // Báo cho module ẩn câu (hider.js) biết có gõ sai; trang cũng tự báo qua #miss-type-screen
    reportMissToHider() {
      if (window.ETypingHider) window.ETypingHider.reportMiss();
    }

    /* ------------------------------------------------------------------ *
     * DOM
     * ------------------------------------------------------------------ */

    handleDOMChange(info) {
      if (!info || this.isHost || this.state === 'COMPLETED') return;

      // Màn hình kết quả là tín hiệu duy nhất để kết thúc bài test
      if (info.isResultScreen) {
        console.log('[Game Frame] Hoàn thành bài test!');
        this.finish();
        return;
      }

      // Chỉ auto (đã kích hoạt) và semi mới tự bấm Start / Space; raw và auto đang chờ phím thì người dùng tự làm
      const autoActions = this.mode === 'semi' || (this.mode === 'auto' && this.state !== 'ARMED');

      // 1. Tự động click nút Start trong game nếu có
      if (autoActions && info.hasStartBtn && info.startBtnElement && this.state === 'WAITING_FOR_START') {
        console.log('[Game Frame] Tự động nhấn nút Start trong game...');
        try { info.startBtnElement.click(); } catch(e) {}
      }

      // 2. Phát hiện câu Romaji mới -> ghi đè buffer
      if (info.fullText) {
        if (info.fullText !== this.buffer) {
          console.log('[Game Frame] Câu Romaji mới vào buffer:', info.fullText);
          this.loadBuffer(info.fullText);
        }
        return;
      }

      // 3. Màn hình chờ bấm Space ("スペースキー")
      if (info.isPromptScreen) {
        if (this.state !== 'ARMED') this.setState('WAITING_FOR_START');
        if (autoActions && this.config.autoSpace) {
          setTimeout(() => {
            const stillAuto = this.mode === 'semi' || (this.mode === 'auto' && this.state !== 'ARMED');
            if (stillAuto && this.state === 'WAITING_FOR_START') this.pressSpace();
          }, 250);
        }
      }
    }

    pressSpace() {
      console.log('[Game Frame] Phát phím Space...');
      if (window.ETypingDispatcher) {
        window.ETypingDispatcher.dispatchSpace();
      }
    }

    // Ghi đè buffer bằng câu vừa parse được; con trỏ quay về đầu câu
    loadBuffer(sentenceText) {
      clearTimeout(this.typingTimer);
      this.buffer = sentenceText;
      this.typoPending = false;
      this.stats.currentSentence = sentenceText;
      this.stats.currentCharIndex = 0;
      this.stats.sentenceIndex += 1;
      this.notify('statsUpdate', this.stats);

      // Auto đang chờ phím kích hoạt: chỉ cập nhật buffer
      if (this.state === 'ARMED') return;

      if (this.mode !== 'auto') {
        this.setState('TYPING');
        return;
      }

      // Automatic: nghỉ ngắn như người đọc câu mới rồi tự gõ
      this.setState('BETWEEN_SENTENCES');
      const delay = Math.max(80, this.config.sentenceDelay || 200);
      this.typingTimer = setTimeout(() => {
        if (this.mode !== 'auto' || this.state !== 'BETWEEN_SENTENCES') return;
        this.setState('TYPING');
        this.typeNextChar();
      }, delay);
    }

    /* ------------------------------------------------------------------ *
     * Automatic
     * ------------------------------------------------------------------ */

    // Mỗi ký tự có tối đa 1 lỗi, nên độ chính xác = 1 / (1 + p) => p = (100 - A) / A
    shouldMakeTypo() {
      const accuracy = Math.max(80, Math.min(100, this.config.accuracy));
      return Math.random() < (100 - accuracy) / accuracy;
    }

    getDelayBetweenChars(char) {
      const wpm = Math.max(30, Math.min(this.config.wpm, 800));
      const baseDelay = 12000 / wpm;

      if (!this.config.humanize) {
        return baseDelay;
      }

      const jitter = (Math.random() * 0.26 - 0.13) * baseDelay;
      let delay = baseDelay + jitter;

      if (char === '-' || char === '.') {
        delay += baseDelay * 0.15;
      }

      return Math.max(10, delay);
    }

    getTypoChar(correctChar) {
      const lower = correctChar.toLowerCase();
      const adjacent = QWERTY_ADJACENT[lower];
      if (adjacent && adjacent.length > 0) {
        const randIndex = Math.floor(Math.random() * adjacent.length);
        return adjacent[randIndex];
      }
      return 'a';
    }

    // Tự gõ ký tự tiếp theo trong buffer theo WPM, có sai số theo Accuracy
    typeNextChar() {
      if (this.state !== 'TYPING' || this.mode !== 'auto') return;

      const sentence = this.buffer;
      const index = this.stats.currentCharIndex;

      // Đã gõ xong câu hiện tại -> chuyển trạng thái chờ đổi câu
      if (!sentence || index >= sentence.length) {
        console.log('[Game Frame] Hoàn thành câu:', sentence);
        this.setState('BETWEEN_SENTENCES');
        return;
      }

      const correctChar = sentence[index];
      const delay = this.getDelayBetweenChars(correctChar);

      const typeCorrect = () => {
        if (window.ETypingDispatcher) {
          window.ETypingDispatcher.dispatchChar(correctChar);
        }
        this.stats.typedChars += 1;
        this.stats.currentCharIndex += 1;
        this.notify('statsUpdate', this.stats);

        this.typingTimer = setTimeout(() => {
          this.typeNextChar();
        }, delay);
      };

      if (this.shouldMakeTypo()) {
        const typoChar = this.getTypoChar(correctChar);
        console.log(`[Typo Simulation] Gõ nhầm '${typoChar}', sửa lại '${correctChar}'`);

        if (window.ETypingDispatcher) {
          window.ETypingDispatcher.dispatchChar(typoChar);
        }
        this.reportMissToHider();
        this.stats.errorsCount += 1;
        this.notify('statsUpdate', this.stats);

        // Mô phỏng ngập ngừng của người thật rồi gõ lại phím đúng
        const hesitation = 70 + Math.random() * 60;
        this.typingTimer = setTimeout(() => {
          if (this.state !== 'TYPING' || this.mode !== 'auto') return;
          typeCorrect();
        }, hesitation);
      } else {
        typeCorrect();
      }
    }
  }

  window.ETypingEngine = new TypingEngine();
  // Raw-Input luôn hoạt động: bắt đầu theo dõi ngay khi frame bài test được tải
  window.ETypingEngine.boot();
})();
