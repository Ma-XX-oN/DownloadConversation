from pathlib import Path
import re

source_path = Path('chatgpt-conversation-markdown-export.user.js')
source = source_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label):
  updated, count = re.subn(pattern, lambda _match: replacement, text, count=1)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return updated


source = replace_once(
  source,
  '// @version      1.2.0-issue.134.1',
  '// @version      1.2.0-issue.134.2',
  'version')

source = replace_once(
  source,
  '      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}\n',
  '      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}\n'
  '      #${PANEL_ID} .tm-communication-log-row{flex-wrap:nowrap}\n'
  '      #${PANEL_ID} .tm-log-name-viewport{flex:1 1 auto;min-width:0;overflow:hidden;border:1px solid #666;border-radius:9px;background:#292929;color:#fff;box-sizing:border-box}\n'
  '      #${PANEL_ID} .tm-log-name-text{display:block;width:max-content;min-width:100%;box-sizing:border-box;padding:9px 12px;white-space:nowrap;transform:translateX(0);transition:transform var(--tm-log-name-duration,1.5s) linear .35s}\n'
  '      #${PANEL_ID} .tm-log-name-viewport:hover .tm-log-name-text{transform:translateX(calc(-1 * var(--tm-log-name-overflow,0px)))}\n'
  '      #${PANEL_ID} .tm-communication-log-row button{flex:0 0 auto}\n',
  'filename viewport CSS')

markup_pattern = (
  r'      <div class=\\?"tm-row\\?"><span class=\\?"tm-label\\?">Communication log</span>'
  r'<input data-role=\\?"communication-log-name\\?" type=\\?"text\\?" readonly '
  r'aria-label=\\?"Current communication log filename\\?" title=\\?"Current communication log filename\\?">'
  r'<button data-role=\\?"rename-communication-log\\?" type=\\?"button\\?" '
  r'aria-label=\\?"Rename communication log\\?" title=\\?"Rename communication log\\?">✎</button>'
  r'<button data-role=\\?"duplicate-communication-log\\?" type=\\?"button\\?">Duplicate</button>'
  r'<button data-role=\\?"reset-communication-log\\?" type=\\?"button\\?">Reset log</button></div>'
)
new_markup = r'''      <div class=\"tm-row\"><span class=\"tm-label\">Communication log</span></div>
      <div class=\"tm-row tm-communication-log-row\"><div class=\"tm-log-name-viewport\" data-role=\"communication-log-name-viewport\" role=\"textbox\" aria-readonly=\"true\" aria-label=\"Current communication log filename\" title=\"Current communication log filename\"><span class=\"tm-log-name-text\" data-role=\"communication-log-name\"></span></div><button data-role=\"rename-communication-log\" type=\"button\" aria-label=\"Rename communication log\" title=\"Rename communication log\">✎</button><button data-role=\"duplicate-communication-log\" type=\"button\">Duplicate</button></div>
      <div class=\"tm-row\"><button data-role=\"reset-communication-log\" type=\"button\">Reset log</button></div>'''
source = sub_once(source, markup_pattern, new_markup, 'filename/control markup')

status_marker = '''  /**
   * Refreshes status.
   *
   * @returns {void} No value is returned.
   */
  function refreshStatus() {'''
status_replacement = '''  /**
   * Measures the active communication-log filename and sets its hover-scroll distance.
   *
   * @returns {void} No value is returned.
   */
  function refreshCommunicationLogNameOverflow() {
    const viewport = document.querySelector(`#${PANEL_ID} [data-role=\"communication-log-name-viewport\"]`);
    const text = document.querySelector(`#${PANEL_ID} [data-role=\"communication-log-name\"]`);
    if (!viewport || !text) return;
    const overflow = Math.max(0, text.scrollWidth - viewport.clientWidth);
    text.style.setProperty('--tm-log-name-overflow', `${overflow}px`);
    text.style.setProperty('--tm-log-name-duration', overflow > 0 ? `${Math.max(1.5, overflow / 40)}s` : '0s');
  }

  /**
   * Refreshes status.
   *
   * @returns {void} No value is returned.
   */
  function refreshStatus() {'''
source = replace_once(source, status_marker, status_replacement, 'filename overflow helper')

old_status = '''    const communicationLogNameInput = document.querySelector(`#${PANEL_ID} [data-role=\"communication-log-name\"]`);
    const renameCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role=\"rename-communication-log\"]`);
    const duplicateCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role=\"duplicate-communication-log\"]`);
    const communicationLogAvailable = Boolean(communicationLogReady && communicationLogFileName);
    if (communicationLogNameInput) {
      communicationLogNameInput.value = communicationLogAvailable ? communicationLogFileName : '';
      communicationLogNameInput.placeholder = communicationLogAvailable ? '' : 'Not configured';
    }
    if (renameCommunicationLogButton) renameCommunicationLogButton.disabled = !communicationLogAvailable;'''
new_status = '''    const communicationLogNameViewport = document.querySelector(`#${PANEL_ID} [data-role=\"communication-log-name-viewport\"]`);
    const communicationLogNameText = document.querySelector(`#${PANEL_ID} [data-role=\"communication-log-name\"]`);
    const renameCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role=\"rename-communication-log\"]`);
    const duplicateCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role=\"duplicate-communication-log\"]`);
    const communicationLogAvailable = Boolean(communicationLogReady && communicationLogFileName);
    const communicationLogDisplayName = communicationLogAvailable ? communicationLogFileName : 'Not configured';
    if (communicationLogNameText) communicationLogNameText.textContent = communicationLogDisplayName;
    if (communicationLogNameViewport) {
      communicationLogNameViewport.title = communicationLogDisplayName;
      communicationLogNameViewport.setAttribute(
        'aria-label',
        communicationLogAvailable
          ? `Current communication log filename: ${communicationLogFileName}`
          : 'Current communication log filename: not configured'
      );
      requestAnimationFrame(refreshCommunicationLogNameOverflow);
    }
    if (renameCommunicationLogButton) renameCommunicationLogButton.disabled = !communicationLogAvailable;'''
source = replace_once(source, old_status, new_status, 'status filename rendering')

old_panel_lookup = '''    const communicationLogNameInput = panel.querySelector('[data-role=\"communication-log-name\"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role=\"rename-communication-log\"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role=\"duplicate-communication-log\"]');
    renameCommunicationLogButton?.addEventListener('click', () => {'''
new_panel_lookup = '''    const communicationLogNameViewport = panel.querySelector('[data-role=\"communication-log-name-viewport\"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role=\"rename-communication-log\"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role=\"duplicate-communication-log\"]');
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);
    renameCommunicationLogButton?.addEventListener('click', () => {'''
source = replace_once(source, old_panel_lookup, new_panel_lookup, 'panel filename listener')

lifecycle_marker = '''  /**
   * Installs page/session lifecycle records after the disk recorder becomes writable.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallLifecycleObservers() {'''
lifecycle_replacement = '''  /**
   * Commits queued communication-log state at a hard document-departure boundary.
   *
   * Browser lifecycle events start this operation on a best-effort basis because
   * the browser does not promise to await arbitrary asynchronous unload work.
   * DownloadConversation-initiated full-document navigation must await this same
   * function before changing location.
   *
   * @param {string} reason - Lifecycle boundary identifying why the document is departing.
   * @returns {Promise<boolean>} True when dirty writer bytes were checkpointed.
   */
  function communicationLogCheckpointForDocumentDeparture(reason) {
    return communicationLogCheckpoint(reason);
  }

  /**
   * Installs page/session lifecycle records after the disk recorder becomes writable.
   *
   * @returns {void} No value is returned.
   */
  function communicationLogInstallLifecycleObservers() {'''
source = replace_once(source, lifecycle_marker, lifecycle_replacement, 'document departure helper')

old_lifecycle_start = '''    communicationLogCheckpointTimer = setInterval(() => void communicationLogCheckpoint('periodic'), COMMUNICATION_LOG_CHECKPOINT_MS);
    window.addEventListener('pagehide', event => {'''
new_lifecycle_start = '''    communicationLogCheckpointTimer = setInterval(() => void communicationLogCheckpoint('periodic'), COMMUNICATION_LOG_CHECKPOINT_MS);
    window.addEventListener('beforeunload', () => {
      void communicationLogCheckpointForDocumentDeparture('beforeunload');
    });
    window.addEventListener('pagehide', event => {'''
source = replace_once(source, old_lifecycle_start, new_lifecycle_start, 'beforeunload checkpoint')
source = replace_once(
  source,
  "      void communicationLogCheckpoint('pagehide');",
  "      void communicationLogCheckpointForDocumentDeparture('pagehide');",
  'pagehide departure checkpoint')

source_path.write_text(source, encoding='utf-8')

design_path = Path('DESIGN.md')
design = design_path.read_text(encoding='utf-8')
design_marker = '''### Communication recorder is passive evidence

The communication recorder begins at document-start, observes stock page networking plus DownloadConversation's own API traffic, and writes its JSONL trace to the authorized directory.  It is designed to preserve evidence across reloads and rare failures.  It does not alter ChatGPT requests, does not become the source of normal exports, and does not change the Core rendering boundary.
'''
design_replacement = design_marker + '''
### Communication-log active-file lifecycle

The general status panel exposes the exact active communication-log filename and serializes rename, duplicate, reset, append, and checkpoint operations through the same write chain. Duplicate creates an exact committed sibling snapshot while recording remains attached to the original file. Rename commits the writer before moving identity to the verified replacement file.

Periodic and document-lifecycle checkpoints close dirty long-lived writers so committed bytes are available on disk. Hard document departure starts the same checkpoint path at `beforeunload` and again at `pagehide`; these browser lifecycle calls are best-effort because unload events do not guarantee awaiting arbitrary asynchronous work. Any full-document reload or navigation initiated by DownloadConversation must explicitly await that checkpoint before changing location. Same-document/SPA route changes are not treated as unload events.
'''
design = replace_once(
  design,
  design_marker,
  design_replacement,
  'DESIGN communication-log lifecycle')
design_path.write_text(design, encoding='utf-8')
