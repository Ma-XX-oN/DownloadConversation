from pathlib import Path

path = Path('scripts/apply-issue-123-7.py')
text = path.read_text(encoding='utf-8')

old_mount = "    communicationLogPromptShown = true;\n    const mount = () => {\n"
new_mount = "    communicationLogPromptShown = true;\n    /**\n     * Mounts the required-directory prompt after the document body exists.\n     *\n     * @returns {void} No value is returned.\n     */\n    const mount = () => {\n"
if text.count(old_mount) != 1:
  raise SystemExit(f'expected one mount declaration, found {text.count(old_mount)}')
text = text.replace(old_mount, new_mount, 1)

old_mime = "    return /(?:^text\\/|json|event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));\n"
new_mime = "    return /(?:^text\\/|application\\/json|text\\/event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));\n"
if text.count(old_mime) != 1:
  raise SystemExit(f'expected one content-type matcher, found {text.count(old_mime)}')
text = text.replace(old_mime, new_mime, 1)

path.write_text(text, encoding='utf-8')
