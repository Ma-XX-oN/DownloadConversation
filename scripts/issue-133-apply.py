from pathlib import Path
import subprocess
import sys

SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
CI = Path('.github/workflows/ci.yml')
TEST = 'tests/communication-log-reset.test.mjs'


def fail(message):
  raise SystemExit(message)


def replace_once(text, old, new, description):
  if text.count(old) != 1:
    fail(f'{description}: expected exactly one match, found {text.count(old)}')
  return text.replace(old, new, 1)


def run(command, expect_success=True):
  result = subprocess.run(command, text=True, capture_output=True)
  output = result.stdout + result.stderr
  print(output, end='')
  if expect_success and result.returncode != 0:
    fail(f'Command failed: {" ".join(command)}')
  return result, output


red, red_output = run(['node', '--test', TEST], expect_success=False)
if red.returncode == 0:
  fail('Issue #133 regression unexpectedly passed before production correction.')
if 'communication log reset' not in red_output.lower():
  fail('Issue #133 regression failed for an unrelated reason.')

source = SOURCE.read_text(encoding='utf-8')
if 'communication-log-response-body-incomplete' not in source or 'summary.body_incomplete' not in source:
  fail('Issue #132 partial-body logging fix is missing from the #133 base branch.')

source = replace_once(
  source,
  '// @version      1.2.0-issue.132.1',
  '// @version      1.2.0-issue.133.1',
  'Version update'
)

reset_function = '''  /**
   * Truncates the active communication log to a verified zero-byte committed file.
   *
   * The reset is serialized with normal communication writes. The authorized
   * directory and active filename remain unchanged, and the next record lazily
   * reopens the normal long-lived writer at the new EOF.
   *
   * @returns {Promise<void>} Resolves after the empty file is committed and verified.
   */
  function communicationLogReset() {
    const operation = communicationLogWriteChain.then(async () => {
      if (communicationLogWritable) {
        try {
          await communicationLogWritable.close();
        } finally {
          communicationLogWritable = null;
          communicationLogWriterDirty = false;
        }
      }

      const refreshed = await communicationLogRefreshedFileSnapshot();
      let writable = null;
      try {
        writable = await refreshed.handle.createWritable({ keepExistingData: true });
        await writable.truncate(0);
        await writable.close();
        writable = null;
        communicationLogWriterDirty = false;
        const verified = await communicationLogRefreshedFileSnapshot();
        if (verified.file.size !== 0) {
          throw new Error(`Communication log reset verification failed: expected 0 bytes, found ${verified.file.size}.`);
        }
      } catch (error) {
        try { await writable?.abort(); } catch {}
        throw error;
      }
    });
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure('reset', communicationError);
    });
    return operation;
  }

'''
append_marker = '''  /**
   * Serializes one JSONL append through the active long-lived communication writer.
'''
if 'function communicationLogReset()' in source:
  fail('communicationLogReset already exists before Issue #133 patch.')
source = replace_once(
  source,
  append_marker,
  reset_function + append_marker,
  'Reset-function insertion point'
)

screen_row = '''      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>'''
reset_row = '''      <div class="tm-row"><span class="tm-label">Communication log</span><button data-role="reset-communication-log" type="button">Reset log</button></div>\n'''
source = replace_once(
  source,
  screen_row,
  reset_row + screen_row,
  'Reset-button panel row'
)

screen_listener = '''    panel.querySelector('[data-role="screen-on"]').addEventListener('click', () => {'''
reset_listener = '''    const resetCommunicationLogButton = panel.querySelector('[data-role="reset-communication-log"]');
    resetCommunicationLogButton?.addEventListener('click', () => {
      if (resetCommunicationLogButton.disabled) return;
      resetCommunicationLogButton.disabled = true;
      resetCommunicationLogButton.textContent = 'Resetting…';
      void communicationLogReset()
        .then(() => {
          logDiagnostic('debug', 'communication-log-reset-complete', {
            file_name: communicationLogFileName
          });
          setStatus('Communication log reset to empty.');
        })
        .catch(error => {
          setStatus(`⚠ Communication log reset failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          resetCommunicationLogButton.disabled = false;
          resetCommunicationLogButton.textContent = 'Reset log';
        });
    });
'''
source = replace_once(
  source,
  screen_listener,
  reset_listener + screen_listener,
  'Reset-button listener insertion point'
)

if 'communication-log-response-body-incomplete' not in source or 'summary.body_incomplete' not in source:
  fail('Issue #132 partial-body logging fix was lost while applying Issue #133.')
SOURCE.write_text(source, encoding='utf-8')

ci = CI.read_text(encoding='utf-8')
old_ci = 'tests/disk-communication-recorder.test.mjs tests/directory-picker-gesture.test.mjs'
new_ci = old_ci + ' tests/communication-log-reset.test.mjs'
ci = replace_once(ci, old_ci, new_ci, 'CI reset-regression registration')
CI.write_text(ci, encoding='utf-8')

run(['node', '--test', TEST])
run(['node', '--test', 'tests/disk-communication-recorder.test.mjs'])
run(['node', '--test', 'tests/recorder-panel-ui.test.mjs'])
run(['node', 'scripts/check-jsdoc.mjs'])
run(['node', '--check', str(SOURCE)])
run(['node', '--test', 'tests/version-identity.test.mjs'])
run(['git', 'diff', '--check'])
