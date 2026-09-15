from pathlib import Path

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
DESIGN = Path('DESIGN.md')


def replace_once(text: str, old: str, new: str, label: str) -> str:
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = SOURCE.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.0.1-issue.123.9',
  '// @version      1.0.1-issue.123.10',
  'version'
)

source = replace_once(
  source,
  "  /** Previously persisted handle awaiting a user-gesture permission renewal. */\n"
  "  let communicationLogPendingDirectoryHandle = null;\n",
  "  /** Whether the next trusted page gesture is reserved for native directory chooser launch. */\n"
  "  let communicationLogDirectoryGestureArmed = false;\n"
  "  /** Whether a native directory chooser promise is currently outstanding. */\n"
  "  let communicationLogDirectoryPickerOpening = false;\n",
  'directory gesture state'
)

source = replace_once(
  source,
  "    communicationLogDirectoryHandle = handle;\n"
  "    communicationLogPendingDirectoryHandle = null;\n"
  "    communicationLogFileName = `DownloadConversation_${sanitizeFileName(conversationTitle())}.jsonl`;\n",
  "    communicationLogDirectoryHandle = handle;\n"
  "    communicationLogFileName = `DownloadConversation_${sanitizeFileName(conversationTitle())}.jsonl`;\n",
  'activation pending handle removal'
)

source = replace_once(
  source,
  "    communicationLogReady = true;\n"
  "    document.getElementById('tm-communication-directory-required')?.remove();\n"
  "    communicationLogPromptShown = false;\n",
  "    communicationLogReady = true;\n"
  "    communicationLogDisarmDirectoryGesture();\n"
  "    document.getElementById('tm-communication-directory-required')?.remove();\n"
  "    communicationLogPromptShown = false;\n",
  'activation gesture disarm'
)

old_prompt_start = source.index('  function communicationLogShowDirectoryPrompt(reason) {')
old_prompt_end = source.index('\n  /**\n   * Restores the persisted communication-log directory', old_prompt_start)
old_prompt = source[old_prompt_start:old_prompt_end]
new_prompt = r'''  /**
   * Removes the trusted-gesture listeners once directory authorization succeeds.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogDisarmDirectoryGesture() {
    if (!communicationLogDirectoryGestureArmed) return;
    communicationLogDirectoryGestureArmed = false;
    window.removeEventListener('click', communicationLogHandleDirectoryGesture, true);
    window.removeEventListener('keydown', communicationLogHandleDirectoryGesture, true);
  }

  /**
   * Uses the first trusted page interaction to launch the native directory chooser directly.
   *
   * The File System Access picker call must remain synchronous with this trusted event; no
   * awaited work may occur before `showDirectoryPicker()` or Chromium will discard transient
   * user activation.
   *
   * @param {Event} event - Trusted click or keydown reserved for directory authorization.
   * @returns {void} No value is returned.
   */
  function communicationLogHandleDirectoryGesture(event) {
    if (!communicationLogDirectoryGestureArmed || communicationLogDirectoryPickerOpening) return;
    if (event.isTrusted !== true) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const pickerWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof pickerWindow.showDirectoryPicker !== 'function') {
      communicationLogReportFailure(
        'directory-authorization',
        new Error('This browser does not expose showDirectoryPicker().')
      );
      return;
    }

    let pickerPromise;
    try {
      communicationLogDirectoryPickerOpening = true;
      pickerPromise = pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
    } catch (error) {
      communicationLogDirectoryPickerOpening = false;
      communicationLogReportFailure('directory-authorization', error);
      return;
    }

    Promise.resolve(pickerPromise)
      .then(async handle => {
        const permission = await communicationLogPermissionState(handle);
        if (permission !== 'granted') {
          throw new Error('The selected folder did not grant read/write permission.');
        }
        await communicationLogStoreDirectoryHandle(handle);
        await communicationLogActivateDirectory(handle);
      })
      .catch(error => {
        if (error?.name === 'AbortError') {
          logDiagnostic('debug', 'communication-directory-picker-cancelled', {});
        } else {
          communicationLogReportFailure('directory-authorization', error);
        }
      })
      .finally(() => {
        communicationLogDirectoryPickerOpening = false;
      });
  }

  /**
   * Blocks page interaction until the next trusted click or key press can open the native chooser.
   *
   * @param {string} reason - Why directory authorization is required.
   * @returns {void} No value is returned.
   */
  function communicationLogShowDirectoryPrompt(reason) {
    logDiagnostic('warnings', 'communication-directory-required', { reason });
    if (!communicationLogDirectoryGestureArmed) {
      communicationLogDirectoryGestureArmed = true;
      window.addEventListener('click', communicationLogHandleDirectoryGesture, { capture: true });
      window.addEventListener('keydown', communicationLogHandleDirectoryGesture, { capture: true });
    }
    if (communicationLogPromptShown) return;
    communicationLogPromptShown = true;

    /**
     * Mounts the blocking explanation after the document body exists.
     *
     * @returns {void} No value is returned.
     */
    const mount = () => {
      if (!document.body) {
        requestAnimationFrame(mount);
        return;
      }
      if (document.getElementById('tm-communication-directory-required')) return;
      const prompt = document.createElement('div');
      prompt.id = 'tm-communication-directory-required';
      prompt.tabIndex = -1;
      prompt.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#000a;color:#fff;font:14px/1.5 system-ui,sans-serif;cursor:pointer';
      const card = document.createElement('div');
      card.style.cssText = 'max-width:520px;padding:18px;border:1px solid #888;border-radius:10px;background:#202123;box-shadow:0 6px 24px #000a';
      card.textContent = `DownloadConversation needs a writable folder for the communication log. Click or press any key to open the native folder chooser. ${reason}`;
      prompt.append(card);
      document.body.append(prompt);
      try { prompt.focus({ preventScroll: true }); } catch {}
    };
    mount();
  }
'''
source = source[:old_prompt_start] + new_prompt + source[old_prompt_end:]

source = replace_once(
  source,
  "      if (permission !== 'granted') {\n"
  "        communicationLogPendingDirectoryHandle = handle;\n"
  "        communicationLogShowDirectoryPrompt('The saved log folder needs read/write permission again.');\n"
  "        return false;\n"
  "      }\n",
  "      if (permission !== 'granted') {\n"
  "        communicationLogShowDirectoryPrompt('The saved log folder is no longer authorized; choose it again.');\n"
  "        return false;\n"
  "      }\n",
  'saved-handle permission path'
)

SOURCE.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
section = r'''

## Issue #123 direct native directory-chooser gesture

The File System Access directory picker cannot be opened autonomously during a page
reload because Chromium requires transient user activation.  When a persisted
directory handle still has read/write permission the recorder therefore reuses it
without showing any authorization UI.  Otherwise the userscript blocks page
interaction and reserves the next trusted click or key press solely for directory
authorization.

That trusted event handler invokes the page-realm `showDirectoryPicker()` synchronously,
before any awaited work can consume transient activation.  There is no intermediate
"Choose Log Folder" button.  The same event is prevented and stopped so it cannot also
activate an underlying ChatGPT control.  Cancelling the native chooser leaves the
trusted-gesture capture armed for the next interaction; successful selection persists
the directory handle, removes the blocker/listeners, and resumes the disk-backed
communication recorder.

This changes only the authorization UX for the diagnostic communication recorder.  It
does not change the single-snapshot export contract, source precedence/recovery rules,
or the AIConversationCore rendering boundary.
'''
if '## Issue #123 direct native directory-chooser gesture' in design:
  raise SystemExit('DESIGN native chooser section already exists')
DESIGN.write_text(design.rstrip() + section.rstrip() + '\n', encoding='utf-8')
