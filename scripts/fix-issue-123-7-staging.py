from pathlib import Path

path = Path('scripts/apply-issue-123-7.py')
text = path.read_text(encoding='utf-8')
old = "    communicationLogPromptShown = true;\n    const mount = () => {\n"
new = "    communicationLogPromptShown = true;\n    /**\n     * Mounts the required-directory prompt after the document body exists.\n     *\n     * @returns {void} No value is returned.\n     */\n    const mount = () => {\n"
if text.count(old) != 1:
  raise SystemExit(f'expected one mount declaration, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
