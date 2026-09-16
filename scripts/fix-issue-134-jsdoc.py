#!/usr/bin/env python3
"""Correct Issue #134 @param formatting required by the repository audit."""

from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'chatgpt-conversation-markdown-export.user.js'
text = path.read_text(encoding='utf-8')
replacements = {
  '@param {string} fileName Candidate basename in the authorized directory.':
    '@param {string} fileName - Candidate basename in the authorized directory.',
  '@param {string} fileName Original communication-log filename.':
    '@param {string} fileName - Original communication-log filename.',
  '@param {number} number Positive duplicate suffix number.':
    '@param {number} number - Positive duplicate suffix number.',
  '@param {string} fileName Exact sibling filename.':
    '@param {string} fileName - Exact sibling filename.',
  '@param {Blob} sourceFile Committed source file snapshot.':
    '@param {Blob} sourceFile - Committed source file snapshot.',
  '@param {string} destinationName New sibling filename that must not exist.':
    '@param {string} destinationName - New sibling filename that must not exist.',
  '@param {string} newFileName Exact new basename in the authorized directory.':
    '@param {string} newFileName - Exact new basename in the authorized directory.',
}
for old, new in replacements.items():
  if text.count(old) != 1:
    raise RuntimeError(f'Expected one JSDoc anchor: {old!r}')
  text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
