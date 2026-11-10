# e-typing GhostTyper (formerly _e-typing Speed Master Pro_)

---

```text
       _               _   _
      | |             | | | |
  __ _| |__   ___  ___| |_| |_ _   _ _ __   ___ _ __
 / _` | '_ \ / _ \/ __| __| __| | | | '_ \ / _ \ '__|
| (_| | | | | (_) \__ \ |_| |_| |_| | |_) |  __/ |
 \__, |_| |_|\___/|___/\__|\__|\__, | .__/ \___|_|
  __/ |                         __/ | |
 |___/                         |___/|_|
```

---

> Forked from [e-typing Speed Master Pro](https://github.com/kainlng/e-typing-Speed-Master)

An extension for the Japanese typing site [e-typing.ne.jp](https://www.e-typing.ne.jp/).
It reads the current Romaji sentence straight from the DOM into a buffer, then either types it for you,
maps your own keystrokes onto it, or simply watches you type and reveals hidden Romaji when you make a mistake.

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
  - [On Chromium browsers](#on-chromium-browsers)
  - [On Gecko browsers](#on-gecko-browsers)
- [Usage](#usage)
  - [Hotkeys](#hotkeys)
  - [Popup](#popup)
- [Modes](#modes)
- [Camouflage popup (F6)](#camouflage-popup-f6)
- [Architecture](#architecture)
  - [Project structure](#project-structure)
  - [Content script load order](#content-script-load-order)
  - [Frames and messaging](#frames-and-messaging)
  - [Persistent settings](#persistent-settings)
- [Technical details](#technical-details)
  - [Sentence extraction](#sentence-extraction)
  - [Buffer and cursor](#buffer-and-cursor)
  - [Keyboard interception](#keyboard-interception)
  - [Typing and typo simulation](#typing-and-typo-simulation)
  - [Mistype detection](#mistype-detection)
- [Known limitations](#known-limitations)

---

## Features

- **Three modes**
  - **Raw-Input** (default): you type yourself and every key reaches the page unchanged. The extension tracks your progress against the buffer and reveals the hidden Romaji as soon as you mistype. (Replicates the behaviour of the original website's "Romanization:off" mode.)
  - **Automatic**: types the whole test for you at a configurable WPM, with optional rhythm jitter and simulated typos.
  - **Semi-Auto**: every character key you press is swallowed and replaced by the _next correct character_ from the buffer, with simulated typos based on the accuracy setting.
- **Pause / resume**: pausing Automatic or Semi-Auto drops into Raw-Input and remembers the previous mode. Pressing F8 again returns to that mode and continues from the exact character you reached, including anything you typed by hand in between.
- **Sentence hiding**: `#sentenceText span` is hidden (`opacity: 0`) as soon as the page loads; toggle it with F7. The part you have already typed (`.entered`) always stays visible, and the full sentence is revealed temporarily after a mistype. (Replicates the original website's behaviour.)
- **Camouflage popup**: F6 switches the toolbar popup between the real control panel and a static "Quick Notes" page. Nothing else stops or changes.
- **Persistent settings**: WPM, accuracy, humanize, the hiding toggle and the camouflage toggle survive reloads. The mode always resets to Raw-Input on every page load.

---

## Installation

### On Chromium browsers

1. Open `chrome://extensions/` in Chrome (or any Chromium browser).
2. Turn on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the repository root, the folder that contains `manifest.json`.
4. Optionally pin the extension to the toolbar.

After pulling new changes, click the reload button on the extension card, then reload any open e-typing tabs. Content scripts are only injected into pages loaded after the reload.

### On Gecko browsers

> Not supported yet; support may be added later.

---

## Usage

1. Open a test, for example the skill check at <https://www.e-typing.ne.jp/roma/check/>, and start it the usual way.
2. The extension starts in **Raw-Input** right away, with no button to press. Type normally.
3. To let the extension help, open the popup and pick **Automatic** or **Semi-Auto**:
   - **Semi-Auto** starts immediately: from now on, any character key types the next correct character.
   - **Automatic** arms itself and waits for **one character key**. That key is swallowed and never reaches the page; Automatic starts typing right after.
4. Press **F8** (or the popup's Pause button) to drop back into Raw-Input. Press **F8** again to resume the previous mode.
5. When the result screen appears, the run is finished. Reload the page to take a new test; it starts in Raw-Input again.

### Hotkeys

All hotkeys are listened for in the capture phase on `window` and are never forwarded to the page.

| Key    | Action                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F8** | Automatic / Semi-Auto → pause into Raw-Input (remembers the mode). Raw-Input after a pause → resume the remembered mode. Plain Raw-Input → no-op. |
| **F7** | Toggle sentence hiding on/off.                                                                                                                    |
| **F6** | Toggle the camouflage popup for the **next** time the popup is opened. It does not open the popup.                                                |

Hotkeys only work on e-typing.ne.jp pages, the only place the content scripts run, and only in the frame that has keyboard focus. When F8 lands in the top window (focus outside the test iframe), the top window forwards it to the test frame.

> The current configuration works well on MY browser, but it might run into issues on YOURS. Feel free to edit it and open a pull request if you have a better idea.

### Popup

| Section                                                           | Raw-Input | Automatic | Semi-Auto |
| ----------------------------------------------------------------- | --------- | --------- | --------- |
| Mode switch (Raw-Input / Automatic / Semi-Auto)                   | ✓         | ✓         | ✓         |
| Pause button (→ Raw-Input)                                        | –         | ✓         | ✓         |
| "Ẩn romaji trên trang" (hide Romaji) checkbox, same setting as F7 | ✓         | ✓         | ✓         |
| WPM slider + presets + Humanize                                   | –         | ✓         | –         |
| Accuracy slider + presets                                         | –         | ✓         | ✓         |
| Live stats (sentence #, characters, misses)                       | ✓         | ✓         | ✓         |

Raw-Input is always active; Automatic and Semi-Auto start as described above.
The popup polls the page every 300 ms while it is open. When Raw-Input was entered by pausing, the popup shows which mode F8 will return to.

---

## Modes

|                                                                           | Raw-Input                                         | Automatic                                       | Semi-Auto                        |
| ------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| Who produces keystrokes                                                   | You                                               | Engine (timer)                                  | You (1 key = 1 buffer character) |
| Your character keys reach the page                                        | Yes, unchanged                                    | Yes, not blocked                                | No, swallowed and replaced       |
| Simulated typos (accuracy)                                                | No                                                | Yes                                             | Yes                              |
| Uses WPM / Humanize                                                       | No                                                | Yes                                             | No                               |
| Auto-clicks the in-game Start button / presses Space on the prompt screen | No                                                | Yes, once running                               | Yes                              |
| Mistype → reveal Romaji                                                   | Yes, detected by comparing your key to the buffer | Yes, on every simulated typo                    | Yes, on every simulated typo     |
| How it starts                                                             | Automatically on page load                        | First character key after selection (swallowed) | Immediately on selection         |

---

## Camouflage popup (F6)

- `content/camouflage.js` (document_start, all frames) swallows F6 `keydown` / `keypress` / `keyup` and flips `etm_camouflage` in `chrome.storage.local`.
- `background.js` (MV3 service worker) listens to `chrome.storage.onChanged` and calls `chrome.action.setPopup()`:
  - `etm_camouflage === true` → `popup/camouflage.html`, a static, neutral "Quick Notes" page with dummy notes and no scripts;
  - otherwise → `popup/popup.html`, the real control panel.
- Because the popup _page_ itself is swapped, the real UI never renders, not even for a frame. The new page applies the next time the popup is opened; F6 never opens it.
- `setPopup()` does not persist across browser restarts, so the worker re-applies the stored value on `runtime.onStartup` and `runtime.onInstalled`.
- Engine, hider and hotkeys keep running unchanged; only the popup page differs. While camouflage is on, the real popup is unreachable from the toolbar. Press F6 on an e-typing page to get it back.

---

## Architecture

### Project structure

```
.
├── manifest.json              # MV3 manifest (name: ghosttyper, v1.1.0)
├── background.js              # Service worker: swaps the action popup for camouflage (F6)
├── content/
│   ├── hider.js               # Sentence hiding module (F7) + mistype reveal; independent of the engine
│   ├── camouflage.js          # F6 hotkey → toggles etm_camouflage
│   ├── dispatcher.js          # Synthetic KeyboardEvent dispatcher (keydown → keypress → keyup)
│   ├── extractor.js           # DOM scanning: Romaji, prompt/result screens, span.entered, observer
│   ├── engine.js              # Mode/state machine, buffer, key interception, Automatic typing
│   ├── content.js             # Popup ↔ frames ↔ top window bridge
│   ├── hotkey.js              # F8 / Ctrl+Shift+X → engine.toggle()
│   ├── settings.js            # Loads/syncs persistent settings from chrome.storage into the engine
│   └── widget.js, widget.css  # Legacy floating widget, NOT loaded by the manifest
├── popup/
│   ├── popup.html/.css/.js    # Real control panel
│   └── camouflage.html/.css   # Neutral "Quick Notes" decoy popup
└── assets/icons/              # Extension icons (ublock.svg is not referenced anywhere)
```

### Content script load order

All content scripts match `*://*.e-typing.ne.jp/*` with `all_frames: true`, so each frame gets its own instance of everything. They all share one isolated world per frame, which is why globals such as `window.ETypingEngine` are visible across files.

| Group | `run_at`         | Scripts                                                                                     |
| ----- | ---------------- | ------------------------------------------------------------------------------------------- |
| 1     | `document_start` | `hider.js`, `camouflage.js`                                                                 |
| 2     | `document_end`   | `dispatcher.js` → `extractor.js` → `engine.js` → `content.js` → `hotkey.js` → `settings.js` |

`engine.js` calls `boot()` as soon as it loads. In the test frame, this starts DOM observation in Raw-Input.

### Frames and messaging

A frame is the **host** when it is the top window, has no `#sentenceText`, and its path does not contain `/app/`. Otherwise it is a **game frame**, where the test runs. When the test page is opened directly (an `/app/` URL), the top window is the game frame.

- **Game frame**: owns the real engine (buffer, key interception, typing).
- **Host**: keeps a _mirror_ of the game frame's `mode`, `prevMode`, `state` and `stats` for the popup. It forwards commands down, and remembers a mode chosen before the test iframe exists.

| Channel                                                           | Message                                              | Purpose                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Popup → every frame (`chrome.tabs.sendMessage`)                   | `SET_MODE {mode}`, `PAUSE`, `UPDATE_CONFIG {config}` | Control. The host also forwards each one to the game frame.                                                                     |
| Popup → top window only                                           | `GET_STATUS`                                         | Returns `{state, mode, prevMode, config, stats}`. Only the top window answers, so the popup always reads one consistent source. |
| Host → game frame (`postMessage`, `source: 'ETYPING_MASTER_CMD'`) | `SET_MODE`, `PAUSE`, `TOGGLE`, `UPDATE_CONFIG`       | Forwarded commands. This is the only path; the old direct cross-frame call was removed so commands are not applied twice.       |
| Game frame → host (`source: 'ETYPING_FRAME_EVENT'`)               | `stateChange`, `statsUpdate`, `modeChange`           | Keeps the host mirror (and therefore the popup) up to date, e.g. after F8 inside the iframe.                                    |
| Game frame → host (`source: 'ETYPING_FRAME_HELLO'`)               | –                                                    | Sent on boot. If the host is in a non-raw mode (chosen before the test was opened), it replies with `SET_MODE`.                 |

Mode is **not** stored anywhere persistent. Reloading the top page resets it to Raw-Input, and mode changes in one tab no longer affect other tabs.

### Persistent settings

`chrome.storage.local` keys:

| Key                | Type    | Default | Used by                           |
| ------------------ | ------- | ------- | --------------------------------- |
| `etm_wpm`          | number  | 120     | engine (Automatic)                |
| `etm_acc`          | number  | 90      | engine (Automatic, Semi-Auto)     |
| `etm_humanize`     | boolean | true    | engine (Automatic)                |
| `etm_hide_enabled` | boolean | true    | hider.js, popup checkbox, F7      |
| `etm_camouflage`   | boolean | false   | camouflage.js (F6), background.js |

`etm_mode` from older versions is ignored and can be left in storage safely.

---

## Technical details

### Sentence extraction

`content/extractor.js`:

- Selectors are tried in order: `#sentenceText #roma`, `#sentenceText .roma`, `#roma`, `.roma`, `#sentenceText`, `.sentenceText`, `#example`, `div[id*="sentence"]`, `span[id*="sentence"]`. If none matches, a deep scan of `div, span, p` runs, skipping elements with more than 8 children.
- A string counts as valid Romaji when it contains no Hiragana, Katakana or Kanji, has at least 2 Latin letters, and only uses `[A-Za-z0-9\-_,.:;!?/\\@^\[\]]`. The result is uppercased with whitespace removed. It is read line by line first, then as the longest Latin run.
- Change detection uses a `MutationObserver` on `document.body` (childList, subtree, characterData) **plus** a 60 ms polling interval.
- The result screen is detected by `スコア`/`Score` together with one of `WPM`, `正タイプ数`, `正確さ`, `正確率`, `入力文字数`, `ミス入力数`, or by a visible result box. It only counts after at least one sentence, and never while the current sentence is unfinished. This check runs before the deep scan, so labels like "WPM" are not mistaken for a sentence.
- The prompt screen is detected by `スペースキー` / `スペース`, or by `#countdown`, `.countdown`, `#space_btn`.

### Buffer and cursor

- The buffer holds the current sentence and is **overwritten** whenever the extracted sentence changes. `stats.currentCharIndex` is the cursor to the next character.
- `getEnteredText()` reads `#sentenceText span.entered`, skips spans containing Japanese, and prefers the span that is a prefix of the buffer. The cursor is aligned to its length:
  - when the game frame boots, in case you were already in the middle of a sentence;
  - on every mode activation (Semi-Auto start, Automatic start, resume from pause);
  - after each Raw-Input keystroke (`setTimeout(0)`, after the page has handled the key). This keeps the cursor correct when the page accepts an alternative Romaji spelling.

### Keyboard interception

One capture-phase `keydown` listener on `window` (game frame only) handles **trusted** character keys, i.e. `key.length === 1` without Ctrl/Alt/Meta:

| Condition                 | Behaviour                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic + `ARMED`       | Swallow; start Automatic.                                                                                                                         |
| Semi-Auto + running state | Swallow; dispatch the next buffer character (or a typo). On the prompt screen with an empty buffer, Space is forwarded so you can start the test. |
| Raw-Input + running state | Do not touch; compare with the buffer (match → advance, mismatch → count a miss and reveal Romaji).                                               |
| Automatic running         | Do not touch.                                                                                                                                     |

The `e.code` of a swallowed `keydown` is remembered, and the matching `keypress` / `keyup` are swallowed too, so the page never sees a stray key release.
Synthetic events from the dispatcher have `isTrusted === false`, so the interceptor ignores them and they reach the game normally.

### Typing and typo simulation

- **Dispatcher**: sends `keydown` → `keypress` → `keyup` with matching `key`, `code`, `keyCode`, `which` and `charCode`, to `document.activeElement` (or `document.body`). It includes JIS-layout mappings for `-`, `^`, `\`, `@`, `[`, `]`, `;`, `:`, `,`, `.`, `/`, `!`, `?`.
- **Delay per character** (Automatic): `base = 12000 / wpm` ms (1 word = 5 characters), with WPM clamped to 30–800 (the popup allows 30–600). With Humanize on, a random ±13 % jitter is added, plus 15 % extra after `-` or `.`. The minimum is 10 ms.
- **Sentence pause** (Automatic): `max(80, sentenceDelay)` ms, default 200 ms, before typing a newly loaded sentence.
- **Typo probability**: `p = (100 − A) / A` for accuracy `A` (clamped 80–100). Each character gets at most one typo, so the resulting accuracy is `1 / (1 + p) = A %`.
- **Typo character**: a random QWERTY neighbour of the intended key (e.g. `k` → `j/i/o/l/m`).
  - Automatic: types the typo, waits 70–130 ms, then types the correct character.
  - Semi-Auto: the keystroke that produced the typo is consumed; your **next** keystroke always produces the correct character. This avoids a race between the automatic correction and your next key.

### Mistype detection

- `#miss-type-screen` only shows `display: block` for a moment. `hider.js` observes `style` / `class` attribute mutations with `attributeOldValue: true`, so a `block → none` flip is still caught from the recorded old value, even if the element is already hidden again when the observer callback runs.
- The engine also calls `ETypingHider.reportMiss()` directly for its own simulated typos, and for Raw-Input keys that do not match the buffer.

---

## Known limitations

- **Browser shortcuts**: **F6** and **F7** are also browser shortcuts in Chrome (focus the address bar, caret browsing). `preventDefault()` is called, but whether Chrome still runs its own action has not been verified.
- **No hotkey feedback**: F6 gives no visual confirmation; open the popup to check the state. F7 is visible immediately on the page.
- **Focused frame only**: hotkeys are handled in the focused frame. F8 is forwarded from the top window; F6/F7 work in any frame because they only write to storage.
- **Your keys in Automatic**: character keys you press while Automatic is typing still reach the page.
- **New test without a reload**: after the result screen, the engine stops observing. Retrying in the same iframe needs a page reload.
- **Polling cost**: every non-host e-typing frame runs the observer plus the 60 ms poll, including frames that are not the test.
- **Camouflage scope**: camouflage changes only the popup page. The toolbar tooltip ("your friendly extension"), the icon and the entry in `chrome://extensions` are not changed by F6.

- **Feel free to report issues, fork the project, or open a pull request.**
