#!/usr/bin/env python3
"""Apply the Issue #134 communication-log file-controls production patch."""

from __future__ import annotations

import argparse
import difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "chatgpt-conversation-markdown-export.user.js"
TEST = ROOT / "tests" / "communication-log-file-controls.test.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
  """Replace one exact anchor and reject missing/ambiguous source state."""
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
  return text.replace(old, new, 1)


def patch_source(text: str) -> str:
  """Return the patched production userscript."""
  text = replace_once(
    text,
    "// @version      1.2.0-issue.133.1",
    "// @version      1.2.0-issue.134.1",
    "version",
  )

  insertion_anchor = """  /**
   * Truncates the active communication log to a verified zero-byte committed file.
"""
  file_helpers = r'''  /**
   * Validates an exact communication-log filename without silently rewriting it.
   *
   * @param {string} fileName Candidate basename in the authorized directory.
   * @returns {string} The unchanged validated basename.
   */
  function communicationLogValidateFileName(fileName) {
    if (typeof fileName !== 'string'
        || fileName.length === 0
        || fileName.trim() !== fileName
        || fileName === '.'
        || fileName === '..'
        || /[<>:"/\\|?*\u0000-\u001F]/.test(fileName)
        || /[. ]$/.test(fileName)) {
      throw new Error('Invalid communication log filename.');
    }
    return fileName;
  }

  /**
   * Builds the deterministic duplicate filename for one positive suffix number.
   *
   * @param {string} fileName Original communication-log filename.
   * @param {number} number Positive duplicate suffix number.
   * @returns {string} Filename with `(N)` inserted immediately before the extension.
   */
  function communicationLogDuplicateFileName(fileName, number) {
    if (!Number.isInteger(number) || number < 1) {
      throw new Error('Communication log duplicate number must be a positive integer.');
    }
    const extensionIndex = fileName.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
    const extension = hasExtension ? fileName.slice(extensionIndex) : '';
    return `${stem}(${number})${extension}`;
  }

  /**
   * Checks whether a sibling file currently exists in the authorized directory.
   *
   * @param {string} fileName Exact sibling filename.
   * @returns {Promise<boolean>} True when the sibling exists.
   */
  async function communicationLogFileExists(fileName) {
    if (!communicationLogDirectoryHandle) {
      throw new Error('Communication log directory is not ready.');
    }
    try {
      await communicationLogDirectoryHandle.getFileHandle(fileName, { create: false });
      return true;
    } catch (error) {
      if (error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  /**
   * Commits and releases the active long-lived writer before a file mutation.
   *
   * @returns {Promise<void>} Resolves after any active writer is closed.
   */
  async function communicationLogCloseActiveWriter() {
    if (!communicationLogWritable) return;
    try {
      await communicationLogWritable.close();
    } finally {
      communicationLogWritable = null;
      communicationLogWriterDirty = false;
    }
  }

  /**
   * Copies one committed source snapshot to a new sibling and verifies exact bytes.
   *
   * @param {Blob} sourceFile Committed source file snapshot.
   * @param {string} destinationName New sibling filename that must not exist.
   * @returns {Promise<void>} Resolves after the destination is committed and verified.
   */
  async function communicationLogCopySnapshot(sourceFile, destinationName) {
    if (!communicationLogDirectoryHandle) {
      throw new Error('Communication log directory is not ready.');
    }
    if (await communicationLogFileExists(destinationName)) {
      throw new Error(`Communication log file already exists: ${destinationName}`);
    }

    let destinationCreated = false;
    let writable = null;
    try {
      const destinationHandle = await communicationLogDirectoryHandle.getFileHandle(
        destinationName,
        { create: true }
      );
      destinationCreated = true;
      writable = await destinationHandle.createWritable();
      await writable.write(sourceFile);
      await writable.close();
      writable = null;

      const copiedFile = await destinationHandle.getFile();
      if (copiedFile.size !== sourceFile.size
          || !(await communicationLogBlobsEqual(sourceFile, copiedFile))) {
        throw new Error(`Communication log copy verification failed: ${destinationName}`);
      }
    } catch (error) {
      try { await writable?.abort(); } catch {}
      if (destinationCreated) {
        try { await communicationLogDirectoryHandle.removeEntry(destinationName); } catch {}
      }
      throw error;
    }
  }

  /**
   * Renames the active communication log by verified copy-then-delete.
   *
   * The operation is serialized behind pending communication writes. The original
   * is deleted only after the new sibling is byte-for-byte verified, and the active
   * filename is switched only after that delete succeeds.
   *
   * @param {string} newFileName Exact new basename in the authorized directory.
   * @returns {Promise<string>} The new active filename.
   */
  function communicationLogRename(newFileName) {
    const operation = communicationLogWriteChain.then(async () => {
      const validatedName = communicationLogValidateFileName(newFileName);
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }
      if (validatedName === communicationLogFileName) return communicationLogFileName;
      if (await communicationLogFileExists(validatedName)) {
        throw new Error(`Communication log file already exists: ${validatedName}`);
      }

      await communicationLogCloseActiveWriter();
      const sourceName = communicationLogFileName;
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      await communicationLogCopySnapshot(sourceSnapshot.file, validatedName);

      try {
        await communicationLogDirectoryHandle.removeEntry(sourceName);
      } catch (error) {
        try { await communicationLogDirectoryHandle.removeEntry(validatedName); } catch {}
        throw error;
      }

      communicationLogFileName = validatedName;
      return validatedName;
    });
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure('rename', communicationError);
    });
    return operation;
  }

  /**
   * Creates a committed point-in-time duplicate of the active communication log.
   *
   * The lowest unused positive `(N)` suffix is inserted immediately before the
   * extension with no intervening space. The active filename never changes.
   *
   * @returns {Promise<string>} The created duplicate filename.
   */
  function communicationLogDuplicate() {
    const operation = communicationLogWriteChain.then(async () => {
      if (!communicationLogReady || !communicationLogDirectoryHandle || !communicationLogFileName) {
        throw new Error('Communication log directory/file is not ready.');
      }

      await communicationLogCloseActiveWriter();
      const sourceSnapshot = await communicationLogRefreshedFileSnapshot();
      let duplicateNumber = 1;
      let duplicateName = communicationLogDuplicateFileName(
        communicationLogFileName,
        duplicateNumber
      );
      while (await communicationLogFileExists(duplicateName)) {
        duplicateNumber += 1;
        duplicateName = communicationLogDuplicateFileName(
          communicationLogFileName,
          duplicateNumber
        );
      }

      await communicationLogCopySnapshot(sourceSnapshot.file, duplicateName);
      return duplicateName;
    });
    communicationLogWriteChain = operation.catch(communicationError => {
      communicationLogReportFailure('duplicate', communicationError);
    });
    return operation;
  }

'''
  text = replace_once(
    text,
    insertion_anchor,
    file_helpers + insertion_anchor,
    "disk file helpers",
  )

  old_markup = '''      <div class="tm-row"><span class="tm-label">Communication log</span><button data-role="reset-communication-log" type="button">Reset log</button></div>'''
  new_markup = '''      <div class="tm-row"><span class="tm-label">Communication log</span><input data-role="communication-log-name" type="text" readonly aria-label="Current communication log filename" title="Current communication log filename"><button data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log">✎</button><button data-role="duplicate-communication-log" type="button">Duplicate</button><button data-role="reset-communication-log" type="button">Reset log</button></div>'''
  text = replace_once(text, old_markup, new_markup, "panel communication-log row")

  listener_anchor = """    const resetCommunicationLogButton = panel.querySelector('[data-role=\"reset-communication-log\"]');
"""
  listeners = r'''    const communicationLogNameInput = panel.querySelector('[data-role="communication-log-name"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role="rename-communication-log"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role="duplicate-communication-log"]');
    renameCommunicationLogButton?.addEventListener('click', () => {
      if (renameCommunicationLogButton.disabled || !communicationLogFileName) return;
      const requestedName = window.prompt('Rename communication log', communicationLogFileName);
      if (requestedName === null || requestedName === communicationLogFileName) return;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.disabled = true;
      void communicationLogRename(requestedName)
        .then(newFileName => {
          setStatus(`Communication log renamed to ${newFileName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log rename failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          refreshStatus();
        });
    });
    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || !communicationLogFileName) return;
      duplicateCommunicationLogButton.disabled = true;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.textContent = 'Duplicating…';
      void communicationLogDuplicate()
        .then(duplicateName => {
          setStatus(`Communication log duplicated as ${duplicateName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log duplicate failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          duplicateCommunicationLogButton.textContent = 'Duplicate';
          refreshStatus();
        });
    });
'''
  text = replace_once(text, listener_anchor, listeners + listener_anchor, "panel file-control listeners")

  refresh_anchor = '''  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
'''
  refresh_replacement = '''  function refreshStatus() {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    const communicationLogNameInput = document.querySelector(`#${PANEL_ID} [data-role="communication-log-name"]`);
    const renameCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role="rename-communication-log"]`);
    const duplicateCommunicationLogButton = document.querySelector(`#${PANEL_ID} [data-role="duplicate-communication-log"]`);
    const communicationLogAvailable = Boolean(communicationLogReady && communicationLogFileName);
    if (communicationLogNameInput) {
      communicationLogNameInput.value = communicationLogAvailable ? communicationLogFileName : '';
      communicationLogNameInput.placeholder = communicationLogAvailable ? '' : 'Not configured';
    }
    if (renameCommunicationLogButton) renameCommunicationLogButton.disabled = !communicationLogAvailable;
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.disabled = !communicationLogAvailable;
'''
  text = replace_once(text, refresh_anchor, refresh_replacement, "refreshStatus file controls")
  return text


def patch_test(text: str) -> str:
  """Initialize lexical recorder state inside the production-block VM harness."""
  old = """    communicationLogDirectoryHandle: directory,
    communicationLogFileName: 'DownloadConversation_test.jsonl',
    communicationLogReady: true,
    communicationLogWriteChain: Promise.resolve(),
    __issue134Events: events
  };

  vm.runInNewContext(
    `${diskBlock()}\\ncommunicationLogReportFailure = (stage, error) => {\\n"""
  new = """    __issue134Directory: directory,
    __issue134Events: events
  };

  vm.runInNewContext(
    `${diskBlock()}\\ncommunicationLogDirectoryHandle = this.__issue134Directory;\\ncommunicationLogFileName = 'DownloadConversation_test.jsonl';\\ncommunicationLogReady = true;\\ncommunicationLogWriteChain = Promise.resolve();\\ncommunicationLogReportFailure = (stage, error) => {\\n"""
  return replace_once(text, old, new, "Issue 134 VM state initialization")


def unified_diff(path: Path, before: str, after: str) -> str:
  """Return a unified diff for one file."""
  return ''.join(difflib.unified_diff(
    before.splitlines(keepends=True),
    after.splitlines(keepends=True),
    fromfile=str(path.relative_to(ROOT)),
    tofile=str(path.relative_to(ROOT)),
  ))


def main() -> None:
  """Dry-run or apply the exact Issue #134 patch."""
  parser = argparse.ArgumentParser()
  mode = parser.add_mutually_exclusive_group(required=True)
  mode.add_argument('--dry-run', action='store_true')
  mode.add_argument('--apply', action='store_true')
  args = parser.parse_args()

  source_before = SOURCE.read_text(encoding='utf-8')
  test_before = TEST.read_text(encoding='utf-8')
  source_after = patch_source(source_before)
  test_after = patch_test(test_before)

  diff = unified_diff(SOURCE, source_before, source_after)
  diff += unified_diff(TEST, test_before, test_after)
  if not diff:
    raise RuntimeError('Issue #134 patch produced no diff.')
  print(diff, end='')

  if args.apply:
    SOURCE.write_text(source_after, encoding='utf-8')
    TEST.write_text(test_after, encoding='utf-8')


if __name__ == '__main__':
  main()
