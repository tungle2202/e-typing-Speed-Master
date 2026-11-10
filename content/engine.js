/**
 * e-typing Auto-Typing Engine (V7 - Automatic & Semi-Auto)
 * Điều phối chính xác giữa Host Window và Game Frame, tự động kích hoạt Start/Space,
 * trích xuất Romaji sạch vào buffer rồi làm việc theo một trong ba chế độ:
 * - raw (mặc định): người dùng tự gõ, phím đi thẳng tới trang; engine chỉ theo dõi buffer,
 *   phím lệch với buffer -> ghi nhận gõ sai và tạm hiện romaji. Tự kích hoạt khi vào trang bài test.
 * - auto: tự gõ theo WPM / Accuracy
 * - semi: mỗi phím ký tự người dùng gõ -> đẩy 1 ký tự tiếp theo trong buffer (có sai số theo Accuracy).
 *   Khi tạm dừng (F8), Semi-Auto hoạt động như Raw-Input.
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

  const ACTIVE_RUN_STATES = ['WAITING_FOR_START', 'TYPING', 'BETWEEN_SENTENCES', 'PAUSED'];

  // Semi-Auto: các trạng thái mà phím ký tự thật của người dùng bị chặn và thay bằng ký tự trong buffer
  const INTERCEPT_STATES = ['WAITING_FOR_START', 'TYPING', 'BETWEEN_SENTENCES'];

  // Phím ký tự in được (không kèm Ctrl/Alt/Meta). Phím chức năng (F8, Backspace, Enter...) đi qua bình thường
  function isCharacterKey(e) {
    return typeof e.key === 'string' && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  class TypingEngine {
    constructor() {
      this.isHost = isHostWindow;
      this.state = 'IDLE'; // IDLE, WAITING_FOR_START, TYPING, BETWEEN_SENTENCES, PAUSED, COMPLETED

      this.config = {
        mode: 'raw', // 'raw' (Raw-Input, mặc định) | 'auto' (Automatic) | 'semi' (Semi-Auto)
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
      // stats.currentCharIndex là con trỏ tới ký tự tiếp theo sẽ được đẩy vào trang.
      this.buffer = '';
      // Semi-Auto: phím trước đó đã đẩy ký tự sai, phím kế tiếp bắt buộc đẩy ký tự đúng
      this.typoPending = false;
      this.typingTimer = null;
      this.stopObserving = null;
      this.hostPingInterval = null;

      this.listeners = {
        stateChange: [],
        statsUpdate: []
      };

      if (!this.isHost) {
        this.installKeyInterceptor();
      }
    }

    /**
     * Bắt toàn bộ phím ký tự thật (isTrusted) ở capture phase của window để chặn chúng trước khi tới trang.
     * Sự kiện do Dispatcher phát ra có isTrusted = false nên đi qua listener này và tới game bình thường.
     */
    installKeyInterceptor() {
      const swallow = (e) => {
        if (!e.isTrusted || !isCharacterKey(e)) return false;
        if (this.config.mode !== 'semi' || !INTERCEPT_STATES.includes(this.state)) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
      };

      window.addEventListener('keydown', (e) => {
        if (swallow(e)) {
          this.handleUserKeystroke(e);
        } else if (e.isTrusted && isCharacterKey(e) && this.isTrackingManual()) {
          this.trackManualKeystroke(e);
        }
      }, true);
      window.addEventListener('keypress', swallow, true);
      window.addEventListener('keyup', swallow, true);
    }

    // Theo dõi gõ tay (không can thiệp vào phím): Raw-Input đang chạy, hoặc Semi-Auto đang tạm dừng
    isTrackingManual() {
      if (this.config.mode === 'raw') return INTERCEPT_STATES.includes(this.state);
      return this.config.mode === 'semi' && this.state === 'PAUSED';
    }

    /**
     * Raw-Input / Semi-Auto đang tắt: phím thật của người dùng đi thẳng tới trang (không chặn, không dịch, không tự gõ sai).
     * Engine chỉ so sánh với ký tự đang được trỏ trong buffer:
     * - khớp -> tiến con trỏ
     * - lệch -> ghi nhận gõ sai, tạm hiện romaji của câu hiện tại (ẩn lại khi câu mới được load)
     */
    trackManualKeystroke(e) {
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
        if (this.isTrackingManual()) this.alignCursorWithEntered();
      }, 0);
    }

    // Semi-Auto: mỗi phím ký tự người dùng gõ -> đẩy đúng 1 ký tự vào trang.
    // Theo Accuracy, phím đó có thể đẩy 1 ký tự sai (phím lân cận); phím kế tiếp sẽ đẩy lại ký tự đúng.
    handleUserKeystroke(e) {
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

      // Nếu đang chạy trong Iframe, gửi ngay về Top Window để cập nhật Widget
      if (window.top !== window) {
        try {
          window.top.postMessage({
            source: 'ETYPING_FRAME_EVENT',
            event,
            data
          }, '*');
        } catch (e) {}
      }
    }

    setState(newState) {
      if (this.state === newState) return;
      console.log(`[e-typing Engine] Trạng thái: ${this.state} -> ${newState}`);
      this.state = newState;
      this.notify('stateChange', newState);
    }

    // Kết thúc lượt chạy: ngừng theo dõi DOM để không tự gõ tiếp câu mới
    finish() {
      clearTimeout(this.typingTimer);
      if (this.stopObserving) {
        this.stopObserving();
        this.stopObserving = null;
      }
      this.buffer = '';
      this.setState('COMPLETED');
    }

    updateConfig(newConfig) {
      const prevMode = this.config.mode;
      this.config = { ...this.config, ...newConfig };
      if (this.isHost && window.ETypingSendCommand) {
        window.ETypingSendCommand('UPDATE_CONFIG', newConfig);
        return;
      }
      if (this.config.mode !== prevMode) this.onModeChange(prevMode);
    }

    // Đổi chế độ giữa chừng: tiếp tục từ vị trí hiện tại trong buffer
    onModeChange(prevMode) {
      clearTimeout(this.typingTimer);
      this.typoPending = false;

      // Vào Raw-Input: kích hoạt theo dõi ngay, không cần Start
      if (this.config.mode === 'raw') {
        this.stop();
        this.start();
        return;
      }
      // Rời Raw-Input: về IDLE, chờ người dùng chủ động Start (tránh tự gõ ngay khi vừa chọn Automatic)
      if (prevMode === 'raw') {
        this.stop();
        return;
      }

      const hasRemaining = this.stats.currentCharIndex < this.buffer.length;
      if (this.config.mode === 'auto' && this.state === 'TYPING') {
        this.typeNextChar();
      } else if (this.config.mode === 'semi' && this.state === 'BETWEEN_SENTENCES' && hasRemaining) {
        // Hủy nhịp nghỉ đầu câu của Automatic, chờ phím người dùng ngay
        this.setState('TYPING');
      }
    }

    /**
     * Semi-Auto: khi kích hoạt (Start / Resume), đặt con trỏ buffer theo số ký tự đã nằm trong
     * <span class="entered"> của trang, để không đẩy lại từ đầu những ký tự đã được gõ (kể cả gõ tay).
     */
    syncCursorFromPage() {
      if (this.config.mode === 'auto' || !this.buffer || !window.ETypingExtractor) return;

      const entered = window.ETypingExtractor.getEnteredText(this.buffer);
      if (entered === null) return;

      if (!this.buffer.startsWith(entered)) {
        console.warn(`[Game Frame] Phần đã gõ '${entered}' không khớp đầu buffer '${this.buffer}', vẫn đặt con trỏ theo số ký tự`);
      }

      this.alignCursorWithEntered(entered);
      this.typoPending = false;
      this.setState(this.stats.currentCharIndex < this.buffer.length ? 'TYPING' : 'BETWEEN_SENTENCES');
    }

    // Đặt con trỏ buffer = số ký tự trong span.entered (không đổi trạng thái engine)
    alignCursorWithEntered(entered = undefined) {
      if (!this.buffer || !window.ETypingExtractor) return;
      if (entered === undefined) entered = window.ETypingExtractor.getEnteredText(this.buffer);
      if (entered === null) return;

      const index = Math.min(entered.length, this.buffer.length);
      if (index === this.stats.currentCharIndex) return;
      console.log(`[Game Frame] Đồng bộ con trỏ buffer: ${this.stats.currentCharIndex} -> ${index}`);
      this.stats.currentCharIndex = index;
      this.notify('statsUpdate', this.stats);
    }

    // Báo cho module ẩn câu (hider.js) biết engine vừa cố ý gõ sai; trang cũng tự báo qua #miss-type-screen
    reportMissToHider() {
      if (window.ETypingHider) window.ETypingHider.reportMiss();
    }

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

    /**
     * Khởi động bài test
     */
    start() {
      console.log(`[e-typing Engine] Start được gọi (Host: ${this.isHost}) tại:`, window.location.href);

      // TRƯỜNG HỢP 1: Chạy tại Host Window (Trang chủ chứa Widget)
      if (this.isHost) {
        this.setState('WAITING_FOR_START');

        // 1. Mở bài test nếu chưa mở
        const checkBtn = document.getElementById('level_check_btn') || document.querySelector('a[rel*="typingApp"]');
        if (checkBtn) {
          const gameFrame = document.querySelector('iframe#typing_content, iframe[name="typing_content"], #pp_full_res iframe, iframe[src*="standard.asp"]');
          if (!gameFrame) {
            console.log('[Host] Tự động nhấn "今すぐチェック！" để mở bài test...');
            checkBtn.click();
          }
        }

        // 2. Gửi lệnh Start kèm ping định kỳ cho đến khi Game Frame sẵn sàng
        if (this.hostPingInterval) clearInterval(this.hostPingInterval);
        let pings = 0;
        const sendStart = () => {
          // Kiểm tra trước khi gửi: Game Frame đã chạy thì không gửi thêm START
          if (pings > 12 || this.state !== 'WAITING_FOR_START') {
            clearInterval(this.hostPingInterval);
            this.hostPingInterval = null;
            return;
          }
          if (window.ETypingSendCommand) {
            window.ETypingSendCommand('START');
          }
          pings++;
        };

        sendStart();
        this.hostPingInterval = setInterval(sendStart, 400);
        return;
      }

      // TRƯỜNG HỢP 2: Chạy trực tiếp tại Game Frame
      // START có thể đến nhiều lần (gọi trực tiếp, postMessage, popup); chỉ lần đầu mới khởi động
      if (ACTIVE_RUN_STATES.includes(this.state)) return;

      this.stats.startTime = Date.now();
      this.stats.typedChars = 0;
      this.stats.errorsCount = 0;
      this.stats.sentenceIndex = 0;
      this.stats.currentCharIndex = 0;
      this.stats.currentSentence = '';
      this.buffer = '';

      this.setState('WAITING_FOR_START');

      if (!this.stopObserving && window.ETypingExtractor) {
        this.stopObserving = window.ETypingExtractor.startObserving(
          (info) => this.handleDOMChange(info),
          () => this.stats
        );
      }

      if (window.ETypingExtractor) {
        const info = window.ETypingExtractor.getCurrentSentenceInfo(this.stats);
        this.handleDOMChange(info);
        // Kích hoạt giữa chừng một câu (đã gõ tay một phần) -> trỏ tới ký tự tiếp theo
        this.syncCursorFromPage();
      }
    }

    pause() {
      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('PAUSE');
        this.setState('PAUSED');
        return;
      }

      // Khi PAUSED, phím thật của người dùng đi thẳng tới trang
      if (INTERCEPT_STATES.includes(this.state)) {
        clearTimeout(this.typingTimer);
        this.setState('PAUSED');
      }
    }

    resume() {
      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('RESUME');
        this.setState('TYPING');
        return;
      }

      if (this.state === 'PAUSED') {
        this.setState(this.stats.currentCharIndex < this.buffer.length ? 'TYPING' : 'BETWEEN_SENTENCES');
        // Câu có thể đã đổi trong lúc tạm dừng (handleDOMChange bỏ qua khi PAUSED) -> đồng bộ lại buffer
        if (window.ETypingExtractor) {
          this.handleDOMChange(window.ETypingExtractor.getCurrentSentenceInfo(this.stats));
        }
        this.syncCursorFromPage();
        if (this.config.mode === 'auto') this.typeNextChar();
      }
    }

    stop() {
      if (this.hostPingInterval) {
        clearInterval(this.hostPingInterval);
        this.hostPingInterval = null;
      }

      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('STOP');
        this.setState('IDLE');
        return;
      }

      clearTimeout(this.typingTimer);
      if (this.stopObserving) {
        this.stopObserving();
        this.stopObserving = null;
      }
      this.buffer = '';
      this.setState('IDLE');
    }

    pressSpace() {
      if (this.isHost) {
        if (window.ETypingSendCommand) window.ETypingSendCommand('PRESS_SPACE');
        return;
      }

      console.log('[Game Frame] Phát phím Space...');
      if (window.ETypingDispatcher) {
        window.ETypingDispatcher.dispatchSpace();
      }
    }

    handleDOMChange(info) {
      if (!info) return;
      if (this.isHost) return;

      if (this.state === 'PAUSED') {
        // Semi-Auto tắt chỉ là tắt ở bề mặt: vẫn kết thúc bài và vẫn nạp câu mới vào buffer
        if (this.isTrackingManual()) {
          if (info.isResultScreen) {
            this.finish();
          } else if (info.fullText && info.fullText !== this.buffer) {
            console.log('[Game Frame] (Tắt) Câu Romaji mới vào buffer:', info.fullText);
            this.loadBuffer(info.fullText);
          }
        }
        return;
      }

      // Màn hình kết quả là tín hiệu duy nhất để kết thúc bài test
      if (info.isResultScreen) {
        console.log('[Game Frame] Hoàn thành bài test!');
        this.finish();
        return;
      }

      // Raw-Input: người dùng tự bấm Start / Space
      const isRaw = this.config.mode === 'raw';

      // 1. Tự động click nút Start trong game nếu có
      if (!isRaw && info.hasStartBtn && info.startBtnElement && this.state === 'WAITING_FOR_START') {
        console.log('[Game Frame] Tự động nhấn nút Start trong game...');
        try { info.startBtnElement.click(); } catch(e) {}
      }

      // 2. Phát hiện câu Romaji mới -> ghi đè buffer (auto: tự gõ; semi / raw: chờ phím người dùng)
      if (info.fullText) {
        if (info.fullText !== this.buffer) {
          console.log('[Game Frame] Câu Romaji mới vào buffer:', info.fullText);
          this.loadBuffer(info.fullText);
        }
        return;
      }

      // 3. Màn hình chờ bấm Space ("スペースキー")
      if (info.isPromptScreen) {
        this.setState('WAITING_FOR_START');
        if (this.config.autoSpace && !isRaw) {
          setTimeout(() => {
            if (this.state === 'WAITING_FOR_START') {
              this.pressSpace();
            }
          }, 250);
        }
        return;
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

      // Đang tắt: chỉ cập nhật buffer, giữ nguyên PAUSED
      if (this.state === 'PAUSED') return;

      if (this.config.mode === 'semi' || this.config.mode === 'raw') {
        this.setState('TYPING');
        return;
      }

      // Automatic: nghỉ ngắn như người đọc câu mới rồi tự gõ
      this.setState('BETWEEN_SENTENCES');
      const delay = Math.max(80, this.config.sentenceDelay || 200);
      this.typingTimer = setTimeout(() => {
        if (this.state === 'PAUSED' || this.state === 'IDLE') return;
        this.setState('TYPING');
        this.typeNextChar();
      }, delay);
    }

    // Automatic: tự gõ ký tự tiếp theo trong buffer theo WPM, có sai số theo Accuracy
    typeNextChar() {
      if (this.state !== 'TYPING' || this.config.mode !== 'auto') return;

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

        // Gõ phím sai
        if (window.ETypingDispatcher) {
          window.ETypingDispatcher.dispatchChar(typoChar);
        }
        this.reportMissToHider();
        this.stats.errorsCount += 1;
        this.notify('statsUpdate', this.stats);

        // Mô phỏng ngập ngừng của người thật rồi gõ lại phím đúng
        const hesitation = 70 + Math.random() * 60;
        this.typingTimer = setTimeout(() => {
          if (this.state !== 'TYPING') return;
          typeCorrect();
        }, hesitation);
      } else {
        typeCorrect();
      }
    }
  }

  window.ETypingEngine = new TypingEngine();

  // Raw-Input là chế độ mặc định: tự kích hoạt ngay khi vào frame bài test.
  // Nếu cấu hình đã lưu là chế độ khác, settings.js sẽ đổi lại và onModeChange() đưa engine về IDLE.
  if (!window.ETypingEngine.isHost && window.ETypingEngine.config.mode === 'raw') {
    window.ETypingEngine.start();
  }
})();
