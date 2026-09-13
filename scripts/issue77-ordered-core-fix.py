from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
  file_path = Path(path)
  text = file_path.read_text(encoding="utf-8")
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f"{path}: expected one match, found {count}: {old[:100]!r}")
  file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


source = "chatgpt-conversation-markdown-export.user.js"
replace_once(
  source,
  """  function canonicalImageResourcesByPart(record) {
    const events = canonicalCore().adaptChatGPTRecords([record]);
    const event = events.find(item => item?.source_record_id === record?.id) ?? null;
    const resources = Array.isArray(event?.resources) ? event.resources : [];
    const byPart = new Map();
    for (const resource of resources) {
      if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') continue;
      const partIndex = resource?.source?.part_index;
      if (Number.isInteger(partIndex)) byPart.set(partIndex, resource);
    }
    return byPart;
  }""",
  """  function canonicalImageResourcesByRecordAndPart(records) {
    assert(Array.isArray(records), 'Canonical image-resource lookup requires the ordered source record set.');
    const events = canonicalCore().adaptChatGPTRecords(records);
    const byRecord = new Map();
    for (const event of events) {
      const recordId = event?.source_record_id;
      if (typeof recordId !== 'string' || !recordId) continue;
      const resources = Array.isArray(event?.resources) ? event.resources : [];
      let byPart = byRecord.get(recordId);
      for (const resource of resources) {
        if (resource?.type !== 'image' || resource?.resource_kind !== 'conversation_image') continue;
        const partIndex = resource?.source?.part_index;
        if (!Number.isInteger(partIndex)) continue;
        if (!byPart) {
          byPart = new Map();
          byRecord.set(recordId, byPart);
        }
        assert(!byPart.has(partIndex), `Duplicate canonical image resource for ${recordId}:${partIndex}.`);
        byPart.set(partIndex, resource);
      }
    }
    return byRecord;
  }"""
)
replace_once(
  source,
  """    /** Ordered source records that contain one or more user image pointers. */
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);""",
  """    /** Exact ordered Conversation API message set used as the single Core adaptation input. */
    const sourceRecords = (spine?.records ?? []).map(item => item?.message).filter(Boolean);
    /** Canonical Core image resources keyed by source record identity and original part index. */
    const canonicalResourcesByRecord = canonicalImageResourcesByRecordAndPart(sourceRecords);
    /** Ordered source records that contain one or more user image pointers. */
    const records = (spine?.records ?? []).filter(record => userImagePointerCount(record?.message) > 0);"""
)
replace_once(
  source,
  "        const canonicalResources = canonicalImageResourcesByPart(record);",
  "        const canonicalResources = canonicalResourcesByRecord.get(record.id) ?? new Map();"
)


test_path = "tests/sediment-resolver.test.mjs"
replace_once(
  test_path,
  "test('production canonical image lookup consumes Core resources by original part index', () => {",
  "test('production canonical image lookup adapts the exact ordered record set once and keys by source identity plus part index', () => {"
)
replace_once(
  test_path,
  """  const context = {
    canonicalCore() {
      return coreContext.AIConversationCore;
    }
  };""",
  """  let adaptedRecords = null;
  const context = {
    canonicalCore() {
      return {
        adaptChatGPTRecords(records) {
          adaptedRecords = records;
          return coreContext.AIConversationCore.adaptChatGPTRecords(records);
        }
      };
    },
    assert(condition, message) {
      if (!condition) throw new Error(message);
    }
  };"""
)
replace_once(
  test_path,
  r"  vm.runInNewContext(`${productionFunctionSource('canonicalImageResourcesByPart')}\nthis.__lookup = canonicalImageResourcesByPart;`, context);",
  r"  vm.runInNewContext(`${productionFunctionSource('canonicalImageResourcesByRecordAndPart')}\nthis.__lookup = canonicalImageResourcesByRecordAndPart;`, context);"
)
replace_once(
  test_path,
  """  const byPart = context.__lookup(record);
  assert.equal(byPart.get(1).source_pointer, 'sediment://file_fixture-image');""",
  """  const earlierRecord = {
    id: 'context-record',
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: ['Context'] },
    metadata: {}
  };
  const orderedRecords = [earlierRecord, record];
  const byRecord = context.__lookup(orderedRecords);
  assert.equal(adaptedRecords, orderedRecords);
  const byPart = byRecord.get('user-image');
  assert.equal(byPart.get(1).source_pointer, 'sediment://file_fixture-image');"""
)
replace_once(
  test_path,
  r"  assert.match(recovery, /const imagePartIndexes = record\.content\.parts/);",
  r"""  assert.match(recovery, /const imagePartIndexes = record\.content\.parts/);
  assert.match(recovery, /const sourceRecords = \(spine\?\.records \?\? \[\]\)\.map\(item => item\?\.message\)\.filter\(Boolean\)/);
  assert.match(recovery, /canonicalImageResourcesByRecordAndPart\(sourceRecords\)/);
  assert.match(recovery, /canonicalResourcesByRecord\.get\(record\.id\) \?\? new Map\(\)/);"""
)


design = "DESIGN.md"
replace_once(
  design,
  "The Core-supplied `download_url` is authoritative for `sediment://file_*` image\nrecovery.",
  "DownloadConversation passes the exact ordered Conversation API message set to\nAIConversationCore once for image recovery, then indexes the returned resources by\nsource record identity and original source part index. The Core-supplied\n`download_url` is authoritative for `sediment://file_*` image recovery."
)
