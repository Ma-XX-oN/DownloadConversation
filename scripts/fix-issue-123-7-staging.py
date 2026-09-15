from pathlib import Path

path = Path('scripts/apply-issue-123-7.py')
text = path.read_text(encoding='utf-8')

old_mount = "    communicationLogPromptShown = true;\n    const mount = () => {\n"
new_mount = "    communicationLogPromptShown = true;\n    /**\n     * Mounts the required-directory prompt after the document body exists.\n     *\n     * @returns {void} No value is returned.\n     */\n    const mount = () => {\n"
if text.count(old_mount) != 1:
  raise SystemExit(f'expected one mount declaration, found {text.count(old_mount)}')
text = text.replace(old_mount, new_mount, 1)

old_mime = "    return /(?:^text\\/|json|event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));\n"
new_mime = "    return String(contentType ?? '').toLowerCase().startsWith('text/') ||\n      /(?:application\\/json|event-stream|javascript|xml|x-www-form-urlencoded|x-component)/i.test(String(contentType ?? ''));\n"
if text.count(old_mime) != 1:
  raise SystemExit(f'expected one content-type matcher, found {text.count(old_mime)}')
text = text.replace(old_mime, new_mime, 1)

old_design_write = "DESIGN.write_text(design.rstrip() + section + '\\n', encoding='utf-8')\n"
new_design_write = "DESIGN.write_text(design.rstrip() + section.rstrip() + '\\n', encoding='utf-8')\n"
if text.count(old_design_write) != 1:
  raise SystemExit(f'expected one DESIGN write, found {text.count(old_design_write)}')
text = text.replace(old_design_write, new_design_write, 1)

path.write_text(text, encoding='utf-8')
