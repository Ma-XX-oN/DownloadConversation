from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USERSCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'
DESIGN = ROOT / 'DESIGN.md'


def replace_once(text: str, old: str, new: str, label: str) -> str:
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = USERSCRIPT.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.1.0',
  '// @version      1.1.0-issue.96.1',
  'userscript version',
)

focus_marker = '''    const focusables = () => modalFocusableElements(dialog);\n    /**\n     * Handles close.\n'''
focus_replacement = '''    const focusables = () => modalFocusableElements(dialog);\n    // Most recent focusable modal control; static-content clicks restore this keyboard anchor.\n    let lastModalFocusedControl = null;\n    dialog.addEventListener('focusin', event => {\n      const target = event.target instanceof HTMLElement ? event.target : null;\n      if (target && focusables().includes(target)) lastModalFocusedControl = target;\n    });\n    dialog.addEventListener('click', event => {\n      const target = event.target instanceof HTMLElement ? event.target : null;\n      if (!target) return;\n      const clickedControl = target.closest(\n        'button, input, select, textarea, a[href], label, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'\n      );\n      if (clickedControl) return;\n      if (lastModalFocusedControl?.isConnected && dialog.contains(lastModalFocusedControl)) {\n        lastModalFocusedControl.focus({ preventScroll: true });\n      }\n    });\n    /**\n     * Handles close.\n'''
source = replace_once(source, focus_marker, focus_replacement, 'modal focus preservation')
USERSCRIPT.write_text(source, encoding='utf-8')

design = DESIGN.read_text(encoding='utf-8')
design_section = '''## Shared modal keyboard focus\n\nRecorder modal dialogs keep keyboard focus anchored to the most recently focused\nmodal control when the user clicks ordinary non-interactive content inside the\ndialog. Interactive controls retain normal browser focus/activation behaviour,\nand clicking the backdrop remains a separate dismissal action where the dialog\nalready supports it. This keeps Tab/Shift+Tab, Enter/Space activation, and Escape\nhandling available after incidental clicks without changing the established modal\nkeyboard contract.\n\n'''
if design_section not in design:
  design = replace_once(
    design,
    '## Historical architecture note\n',
    design_section + '## Historical architecture note\n',
    'DESIGN modal section',
  )
DESIGN.write_text(design, encoding='utf-8')
