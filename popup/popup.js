/**
 * e-typing Speed Master - Popup Controller
 */
(function() {
  'use strict';

  // Elements
  const statusBadge = document.getElementById('pop-status-badge');
  const statusText = document.getElementById('pop-status-text');
  const btnPause = document.getElementById('pop-btn-pause');
  const controlNote = document.getElementById('pop-control-note');

  const sliderWpm = document.getElementById('pop-slider-wpm');
  const inputWpm = document.getElementById('pop-input-wpm');
  const cpmLabel = document.getElementById('pop-cpm-label');
  const chkHumanize = document.getElementById('pop-chk-humanize');
  const chkHide = document.getElementById('pop-chk-hide');

  const sliderAcc = document.getElementById('pop-slider-acc');
  const inputAcc = document.getElementById('pop-input-acc');
  const accLabel = document.getElementById('pop-acc-label');

  const statSentence = document.getElementById('pop-stat-sentence');
  const statChars = document.getElementById('pop-stat-chars');
  const statErrors = document.getElementById('pop-stat-errors');

  const modeButtons = document.querySelectorAll('.mode-btn[data-mode]');
  const modeHint = document.getElementById('pop-mode-hint');
  const secWpm = document.getElementById('pop-sec-wpm');
  const secAcc = document.getElementById('pop-sec-acc');

  const DEFAULT_MODE = 'raw';
  const MODE_INFO = {
    raw: { label: 'Raw-Input', hint: 'Bạn tự gõ, sai thì hiện romaji', typing: 'Đang theo dõi...' },
    auto: { label: 'Automatic', hint: 'Tự gõ theo WPM & Accuracy', typing: 'Đang gõ...' },
    semi: { label: 'Semi-Auto', hint: 'Mỗi phím bạn gõ = 1 ký tự đúng', typing: 'Chờ phím của bạn...' }
  };

  let currentEngineState = 'IDLE';
  let currentMode = DEFAULT_MODE;
  let currentPrevMode = null;

  // Cập nhật giao diện theo chế độ (không gửi đi)
  function renderMode(mode) {
    currentMode = MODE_INFO[mode] ? mode : DEFAULT_MODE;
    modeButtons.forEach(btn => {
      const active = btn.getAttribute('data-mode') === currentMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    modeHint.textContent = MODE_INFO[currentMode].hint;
    // Semi-Auto / Raw không dùng WPM: nhịp gõ là của người dùng. Raw không tạo lỗi nên không cần Accuracy
    secWpm.hidden = currentMode !== 'auto';
    secAcc.hidden = currentMode === 'raw';
    renderControls();
    applyState(currentEngineState);
  }

  // Raw-Input: không có nút điều khiển. Automatic / Semi-Auto: chỉ có Pause
  function renderControls() {
    const isRaw = currentMode === 'raw';
    btnPause.hidden = isRaw;
    controlNote.hidden = !isRaw;
    controlNote.textContent = isRaw && currentPrevMode
      ? `Đã tạm dừng ${MODE_INFO[currentPrevMode].label}. Nhấn F8 trên trang để quay lại.`
      : 'Raw-Input luôn hoạt động: bạn tự gõ, gõ sai thì romaji hiện ra.';
  }

  // Chế độ chỉ sống trong trang (tải lại trang là về Raw-Input), nên không lưu vào storage
  function setMode(mode) {
    currentPrevMode = null;
    renderMode(mode);
    sendTabMessage('SET_MODE', { mode: currentMode });
  }

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
  });

  // Gửi thông điệp tới Content Script trong active tab
  function sendTabMessage(action, data = {}, callback = null) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, (res) => {
        if (chrome.runtime.lastError) {
          // Tab hiện tại có thể chưa load content script hoặc không phải trang e-typing
          return;
        }
        if (typeof callback === 'function') callback(res);
      });
    });
  }

  // Cập nhật giao diện theo trạng thái engine
  function applyState(state) {
    currentEngineState = state;
    statusBadge.className = 'status-badge';

    switch (state) {
      case 'ARMED':
        statusBadge.classList.add('waiting');
        statusText.textContent = 'Nhấn 1 phím để chạy';
        break;
      case 'WAITING_FOR_START':
        statusBadge.classList.add('waiting');
        statusText.textContent = currentMode === 'raw' ? 'Đang theo dõi...' : 'Chờ Space / Đếm ngược';
        break;
      case 'TYPING':
      case 'BETWEEN_SENTENCES':
        statusBadge.classList.add('typing');
        statusText.textContent = MODE_INFO[currentMode].typing;
        break;
      case 'COMPLETED':
        statusBadge.classList.add('completed');
        statusText.textContent = 'Đã hoàn tất! (tải lại trang để làm bài mới)';
        break;
      case 'IDLE':
        statusBadge.classList.add('idle');
        statusText.textContent = 'Sẵn sàng';
        break;
      default:
        statusBadge.classList.add('idle');
        statusText.textContent = 'Chưa vào test';
        break;
    }
    btnPause.disabled = state === 'COMPLETED' || state === 'UNAVAILABLE';
  }

  // Cập nhật WPM
  function updateWPM(val) {
    const wpm = parseInt(val, 10) || 120;
    sliderWpm.value = wpm;
    inputWpm.value = wpm;
    cpmLabel.textContent = `${wpm * 5} CPM`;
    sendTabMessage('UPDATE_CONFIG', { config: { wpm } });
    chrome.storage.local.set({ etm_wpm: wpm });
  }

  // Cập nhật Accuracy
  function updateAcc(val) {
    const acc = parseInt(val, 10) || 90;
    sliderAcc.value = acc;
    inputAcc.value = acc;
    accLabel.textContent = `${acc}%`;
    sendTabMessage('UPDATE_CONFIG', { config: { accuracy: acc } });
    chrome.storage.local.set({ etm_acc: acc });
  }

  // Event Listeners cho Sliders & Inputs
  sliderWpm.addEventListener('input', (e) => updateWPM(e.target.value));
  inputWpm.addEventListener('change', (e) => updateWPM(e.target.value));

  document.querySelectorAll('.presets [data-wpm]').forEach(btn => {
    btn.addEventListener('click', () => updateWPM(btn.getAttribute('data-wpm')));
  });

  // Ẩn romaji: hider.js trên trang tự áp dụng khi etm_hide_enabled đổi (cùng khóa với phím F7)
  chkHide.addEventListener('change', (e) => {
    chrome.storage.local.set({ etm_hide_enabled: e.target.checked });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.etm_hide_enabled) {
      chkHide.checked = changes.etm_hide_enabled.newValue !== false;
    }
  });

  chkHumanize.addEventListener('change', (e) => {
    sendTabMessage('UPDATE_CONFIG', { config: { humanize: e.target.checked } });
    chrome.storage.local.set({ etm_humanize: e.target.checked });
  });

  sliderAcc.addEventListener('input', (e) => updateAcc(e.target.value));
  inputAcc.addEventListener('change', (e) => updateAcc(e.target.value));

  document.querySelectorAll('.presets [data-acc]').forEach(btn => {
    btn.addEventListener('click', () => updateAcc(btn.getAttribute('data-acc')));
  });

  // Pause: Automatic / Semi-Auto -> Raw-Input (engine nhớ chế độ trước, F8 trên trang để quay lại)
  btnPause.addEventListener('click', () => {
    if (currentMode === 'raw') return;
    currentPrevMode = currentMode;
    renderMode('raw');
    sendTabMessage('PAUSE');
  });

  // Đọc cấu hình và trạng thái hiện tại
  function refreshStatus() {
    sendTabMessage('GET_STATUS', {}, (res) => {
      if (res && res.state) {
        if (res.mode && (res.mode !== currentMode || (res.prevMode || null) !== currentPrevMode)) {
          currentPrevMode = res.prevMode || null;
          renderMode(res.mode);
        }
        applyState(res.state);
        if (res.config) {
          if (res.config.wpm) {
            sliderWpm.value = res.config.wpm;
            inputWpm.value = res.config.wpm;
            cpmLabel.textContent = `${res.config.wpm * 5} CPM`;
          }
          if (res.config.accuracy) {
            sliderAcc.value = res.config.accuracy;
            inputAcc.value = res.config.accuracy;
            accLabel.textContent = `${res.config.accuracy}%`;
          }
          if (res.config.humanize !== undefined) {
            chkHumanize.checked = res.config.humanize;
          }
        }
        if (res.stats) {
          statSentence.textContent = res.stats.sentenceIndex || 0;
          statChars.textContent = res.stats.typedChars || 0;
          statErrors.textContent = res.stats.errorsCount || 0;
        }
      }
    });
  }

  // Load storage dự phòng
  // Hiển thị Raw-Input cho tới khi trang trả lời chế độ thật
  renderMode(DEFAULT_MODE);

  chrome.storage.local.get(['etm_wpm', 'etm_acc', 'etm_humanize', 'etm_hide_enabled'], (res) => {
    // Mặc định bật, giống hider.js
    chkHide.checked = res.etm_hide_enabled !== false;
    if (res.etm_wpm) updateWPM(res.etm_wpm);
    if (res.etm_acc) updateAcc(res.etm_acc);
    if (res.etm_humanize !== undefined) chkHumanize.checked = res.etm_humanize;
  });

  refreshStatus();
  // Cập nhật số liệu mỗi 300ms khi popup đang mở
  setInterval(refreshStatus, 300);
})();
