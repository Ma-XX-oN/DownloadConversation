from pathlib import Path

script_path = Path('chatgpt-conversation-markdown-export.user.js')
text = script_path.read_text(encoding='utf-8')
old = '// @version      0.6.159'
new = '// @version      0.6.160'
if text.count(old) != 1:
  raise SystemExit(f'userscript version: expected 1 match, found {text.count(old)}')
text = text.replace(old, new, 1)

old = '''  /**
   * Handles bootstrap UI.
   *
   * @returns {void} No value is returned.
   */
  function bootstrapUi() {
    console.log(`[DownloadConversation v${VERSION}] bootstrapUi`, {
      ready_state: document.readyState,
      has_body: Boolean(document.body),
      body: launcherNodeSummary(document.body)
    });
    if (document.body) {
      makeLauncher();
      makePanel();
      return;
    }
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      observer.disconnect();
      console.log(`[DownloadConversation v${VERSION}] bootstrapUi body appeared`, {
        ready_state: document.readyState,
        body: launcherNodeSummary(document.body)
      });
      makeLauncher();
      makePanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
'''
new = '''  /**
   * Mounts the launcher only after the host has loaded and direct BODY reconciliation is quiet.
   *
   * ChatGPT can remove direct BODY children during its post-load React reconciliation.  Keeping
   * the observer alive also remounts the launcher after a later full BODY-child reconciliation,
   * while the recorder panel remains lazy and is created only when the launcher is used.
   *
   * @returns {void} No value is returned.
   */
  function bootstrapUi() {
    console.log(`[DownloadConversation v${VERSION}] bootstrapUi`, {
      ready_state: document.readyState,
      has_body: Boolean(document.body),
      body: launcherNodeSummary(document.body)
    });

    const quietMs = 1000;
    let loadReady = document.readyState === 'complete';
    let bodyObserver = null;
    let quietTimer = null;

    /**
     * Schedules one launcher mount after the current direct-BODY quiet interval.
     *
     * @returns {void} No value is returned.
     */
    const scheduleLauncherMount = () => {
      if (!loadReady || !document.body) return;
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = null;
        if (!document.body) return;
        console.log(`[DownloadConversation v${VERSION}] launcher mount after BODY quiet`, {
          ready_state: document.readyState,
          quiet_ms: quietMs,
          has_launcher: Boolean(document.getElementById(LAUNCHER_ID))
        });
        makeLauncher();
      }, quietMs);
    };

    /**
     * Observes the current BODY so host reconciliation resets the launcher quiet interval.
     *
     * @param {HTMLBodyElement} body - Current BODY whose direct children are observed.
     * @returns {void} No value is returned.
     */
    const observeBody = body => {
      bodyObserver?.disconnect();
      bodyObserver = new MutationObserver(records => {
        if (!records.some(record => record.type === 'childList' && record.target === body)) return;
        scheduleLauncherMount();
      });
      bodyObserver.observe(body, { childList: true });
      scheduleLauncherMount();
    };

    if (document.body) observeBody(document.body);
    else {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        console.log(`[DownloadConversation v${VERSION}] bootstrapUi body appeared`, {
          ready_state: document.readyState,
          body: launcherNodeSummary(document.body)
        });
        observeBody(document.body);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    if (!loadReady) {
      window.addEventListener('load', () => {
        loadReady = true;
        scheduleLauncherMount();
      }, { once: true });
    }
  }
'''
if text.count(old) != 1:
  raise SystemExit(f'bootstrapUi block: expected 1 match, found {text.count(old)}')
script_path.write_text(text.replace(old, new, 1), encoding='utf-8')

heading_path = Path('tests/heading-metadata-controls.test.mjs')
heading = heading_path.read_text(encoding='utf-8')
old = "assert.match(userscript, /\\/\\/ @version      0\\.6\\.159/);"
new = "assert.match(userscript, /\\/\\/ @version      0\\.6\\.160/);"
if heading.count(old) != 1:
  raise SystemExit(f'heading version: expected 1 match, found {heading.count(old)}')
heading_path.write_text(heading.replace(old, new, 1), encoding='utf-8')

panel_path = Path('tests/recorder-panel-ui.test.mjs')
panel = panel_path.read_text(encoding='utf-8')
old = '''  assert.match(userscript, /if \\(document\\.body\\) \\{\\n      makeLauncher\\(\\);\\n      makePanel\\(\\);/,
    'Diagnostic build must preserve the pre-recovery bootstrap behavior.');
'''
new = '''  assert.match(userscript, /const quietMs = 1000;/,
    'Launcher bootstrap must wait for a full second of direct-BODY quiet.');
  assert.match(userscript, /let loadReady = document\\.readyState === 'complete';/,
    'Launcher bootstrap must not consider the host stable before load completes.');
  assert.match(userscript, /bodyObserver\\.observe\\(body, \\{ childList: true \\}\\);/,
    'Launcher bootstrap must observe direct BODY reconciliation.');
  assert.match(userscript, /window\\.addEventListener\\('load', \\(\\) => \\{/,
    'Launcher bootstrap must start its quiet timer when load completes.');
  assert.match(userscript, /launcher mount after BODY quiet/,
    'Launcher bootstrap must expose the delayed-mount diagnostic.');
  const bootstrapAt = userscript.indexOf('function bootstrapUi()');
  const bootstrapEnd = userscript.indexOf("document.addEventListener('visibilitychange'", bootstrapAt);
  const bootstrapSource = userscript.slice(bootstrapAt, bootstrapEnd);
  assert.match(bootstrapSource, /makeLauncher\\(\\);/,
    'Delayed bootstrap must create the launcher after the quiet interval.');
  assert.doesNotMatch(bootstrapSource, /makePanel\\(\\);/,
    'Recorder panel must remain lazy and must not be inserted during host reconciliation.');
'''
if panel.count(old) != 1:
  raise SystemExit(f'panel bootstrap assertion: expected 1 match, found {panel.count(old)}')
panel_path.write_text(panel.replace(old, new, 1), encoding='utf-8')
