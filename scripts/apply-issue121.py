from pathlib import Path

CORE_OLD = 'b7961cb8dab11611a5af8f4304ae783295998cf2'
CORE_NEW = 'd6d76b54db3d48baf3f5e3a76099be1732d32785'


def replace_once(path, old, new, label):
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{label}: expected one match in {path}, found {count}')
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


userscript = Path('chatgpt-conversation-markdown-export.user.js')
replace_once(userscript, '// @version      0.6.173', '// @version      0.6.174', 'userscript version')
replace_once(userscript, CORE_OLD, CORE_NEW, 'userscript Core pin')

core_test = Path('tests/core-integration.test.mjs')
replace_once(core_test, CORE_OLD, CORE_NEW, 'core integration Core pin')
replace_once(
  core_test,
  "assert.match(render(), /^## User turn_id=metadata-user$/m);",
  "assert.match(render(), /^## User metadata-user$/m);",
  'turn ID only heading expectation')
replace_once(
  core_test,
  "^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]: 2: turn_id=metadata-user$",
  "^## User \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\\]: 2: metadata-user$",
  'combined bare Turn ID expectation')
replace_once(
  core_test,
  "assert.doesNotMatch(render(), /<!-- turn_id=/);",
  "assert.doesNotMatch(render(), /turn_id=/);",
  'obsolete Turn ID prefix rejection')

phase5 = Path('tests/phase5-rich-core-integration.test.mjs')
replace_once(phase5, CORE_OLD, CORE_NEW, 'phase5 Core pin')
replace_once(
  phase5,
  "assert.match(rendered, /^## ChatGPT turn_id=assistant-citation$/m);",
  "assert.match(rendered, /^## ChatGPT assistant-citation$/m);",
  'rich bare Turn ID expectation')
replace_once(
  phase5,
  "assert.doesNotMatch(rendered, /<!-- turn_id=/);",
  "assert.doesNotMatch(rendered, /turn_id=/);",
  'rich obsolete Turn ID prefix rejection')

sediment = Path('tests/sediment-resolver.test.mjs')
replace_once(sediment, CORE_OLD, CORE_NEW, 'sediment Core pin')

heading_test = Path('tests/heading-metadata-controls.test.mjs')
replace_once(heading_test, '0\\.6\\.173', '0\\.6\\.174', 'userscript version expectation')

path = Path('DESIGN.md')
text = path.read_text(encoding='utf-8')
old = ('Canonical identity is additional identity. Normalization must preserve the original JSONL provenance needed by later projections, including source record index/number, raw timestamp fields, provider/source record or turn identity, and all contributing records when several source records form one canonical turn. Existing DownloadConversation `turn_id` heading comments continue to refer to provider/source identity; they are not silently replaced by canonical derived turn IDs.')
new = ('Canonical identity is additional identity. Normalization must preserve the original JSONL provenance needed by later projections, including source record index/number, raw timestamp fields, provider/source record or turn identity, and all contributing records when several source records form one canonical turn. Visible Turn IDs continue to refer to provider/source identity; they are not silently replaced by canonical derived turn IDs. AIConversationCore owns their heading serialization.')
if old not in text:
  raise RuntimeError('DESIGN canonical identity paragraph not found')
text = text.replace(old, new, 1)
old = ('The initial production migration covers ordinary visible text records and plain Assistant segments composed of public `thoughts` records followed by an otherwise plain visible Assistant text record. These migrated Assistant segments are rendered by `AIConversationCore` as one canonical ChatGPT section while DownloadConversation preserves the final provider/source Assistant record ID in its existing `turn_id` heading comment. Provider-specific rich handling such as citations, images, inline ChatGPT tokens, `sandbox:` resources, hidden records, and other host-enriched cases remains on the established DownloadConversation renderer until each behaviour is migrated with its own regression evidence.')
new = ('The initial production migration covers ordinary visible text records and plain Assistant segments composed of public `thoughts` records followed by an otherwise plain visible Assistant text record. These migrated Assistant segments are rendered by `AIConversationCore` as one canonical ChatGPT section while Core preserves the final provider/source Assistant record ID as the optional visible Turn ID. Provider-specific rich handling such as citations, images, inline ChatGPT tokens, `sandbox:` resources, hidden records, and other host-enriched cases remains on the established DownloadConversation renderer until each behaviour is migrated with its own regression evidence.')
if old not in text:
  raise RuntimeError('DESIGN migration paragraph not found')
text = text.replace(old, new, 1)
old = ('- **Turn ID**: Core derives the ChatGPT native source/message ID and renders it as\n  visible `turn_id=...` heading metadata. Default: off.')
new = ('- **Turn ID**: Core derives the ChatGPT native source/message ID and renders the\n  bare native ID value as visible heading metadata, without a `turn_id=` prefix.\n  Default: off.')
if old not in text:
  raise RuntimeError('DESIGN optional Turn ID paragraph not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
