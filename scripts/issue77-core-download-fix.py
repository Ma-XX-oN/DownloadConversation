from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
  file_path = Path(path)
  text = file_path.read_text(encoding='utf-8')
  count = text.count(old)
  if count != 1:
    raise RuntimeError(f'{path}: expected one match, found {count}: {old[:80]!r}')
  file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


source = 'chatgpt-conversation-markdown-export.user.js'
replace_once(source, '// @version      0.6.170', '// @version      0.6.171')
replace_once(
  source,
  "      const resolverResponse = await fetch(resolverUrl, { credentials: 'include' });",
  "      const resolverResponse = await apiFetch(resolverUrl);"
)
replace_once(
  source,
  "      source_message_count: records.length,\n      total_images: totalImages,",
  "      script_version: VERSION,\n      source_message_count: records.length,\n      total_images: totalImages,"
)
replace_once(
  source,
  "        image_number: context.image_number,\n        total_images: totalImages,\n        message_id: context.message_id,",
  "        script_version: VERSION,\n        image_number: context.image_number,\n        total_images: totalImages,\n        message_id: context.message_id,"
)
replace_once(
  source,
  "          image_number: context.image_number,\n          total_images: totalImages,\n          message_id: context.message_id,\n          image_ordinal: context.image_ordinal,\n          path: context.path,\n          outcome,",
  "          script_version: VERSION,\n          image_number: context.image_number,\n          total_images: totalImages,\n          message_id: context.message_id,\n          image_ordinal: context.image_ordinal,\n          path: context.path,\n          outcome,"
)
replace_once(
  source,
  "          image_number: context.image_number,\n          total_images: totalImages,\n          message_id: context.message_id,\n          image_ordinal: context.image_ordinal,\n          path: context.path,\n          outcome: timing.outcome ?? 'error',",
  "          script_version: VERSION,\n          image_number: context.image_number,\n          total_images: totalImages,\n          message_id: context.message_id,\n          image_ordinal: context.image_ordinal,\n          path: context.path,\n          outcome: timing.outcome ?? 'error',"
)
replace_once(
  source,
  "          const resource = canonicalResources.get(partIndex) ?? null;\n          const hasCanonicalTransport = typeof resource?.download_url === 'string' && resource.download_url.trim();\n          const hasCanonicalData = typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/');\n          if (hasCanonicalTransport || hasCanonicalData) {",
  "          const resource = canonicalResources.get(partIndex) ?? null;\n          const sourcePointer = cgImagePointerSource(expectedParts[index]);\n          const isSediment = internalImagePointerProtocol(sourcePointer) === 'sediment';\n          const hasCanonicalTransport = typeof resource?.download_url === 'string' && resource.download_url.trim();\n          const hasCanonicalData = typeof resource?.data_url === 'string' && resource.data_url.startsWith('data:image/');\n          if (isSediment && !hasCanonicalTransport && !hasCanonicalData) {\n            logDiagnostic('errors', 'conversation-image-core-resource-missing', {\n              script_version: VERSION,\n              message_id: record.id,\n              image_ordinal: index + 1,\n              part_index: partIndex,\n              resource_present: Boolean(resource),\n              source_scheme: 'sediment:'\n            });\n            throw new Error(\n              `AIConversationCore did not provide a download_url or data_url for sediment image ${record.id}:${index + 1}.`\n            );\n          }\n          if (hasCanonicalTransport || hasCanonicalData) {"
)
replace_once(
  source,
  "                path: hasCanonicalData ? 'core-data' : 'core-resolver'",
  "                path: hasCanonicalData ? 'core-data' : 'core-download'"
)
replace_once(
  source,
  "        outcome: recoveryCompleted ? 'complete' : 'aborted',\n        source_message_count: records.length,",
  "        script_version: VERSION,\n        outcome: recoveryCompleted ? 'complete' : 'aborted',\n        source_message_count: records.length,"
)


test_path = 'tests/sediment-resolver.test.mjs'
replace_once(
  test_path,
  "function resolverContext(fetchImpl) {\n  return {\n    URL,\n    Blob,\n    FileReader: TestFileReader,\n    performance,\n    fetch: fetchImpl,",
  "function resolverContext(apiFetchImpl, fetchImpl = apiFetchImpl) {\n  return {\n    URL,\n    Blob,\n    FileReader: TestFileReader,\n    performance,\n    apiFetch: apiFetchImpl,\n    fetch: fetchImpl,"
)
replace_once(
  test_path,
  "  const requests = [];\n  const context = resolverContext(async url => {\n    requests.push(String(url));\n    if (requests.length === 1) {\n      return {\n        ok: true,\n        status: 200,\n        async json() {\n          return { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret' };\n        }\n      };\n    }\n    return {\n      ok: true,\n      status: 200,\n      async blob() {\n        return new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });\n      }\n    };\n  });",
  "  const transportRequests = [];\n  const contentRequests = [];\n  const context = resolverContext(\n    async url => {\n      transportRequests.push(String(url));\n      return {\n        ok: true,\n        status: 200,\n        async json() {\n          return { download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret' };\n        }\n      };\n    },\n    async url => {\n      contentRequests.push(String(url));\n      return {\n        ok: true,\n        status: 200,\n        async blob() {\n          return new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });\n        }\n      };\n    }\n  );"
)
replace_once(
  test_path,
  "  assert.deepEqual(requests, [\n    'https://chatgpt.com/backend-api/files/download/file_fixture-image',\n    'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret'\n  ]);",
  "  assert.deepEqual(transportRequests, [\n    'https://chatgpt.com/backend-api/files/download/file_fixture-image'\n  ]);\n  assert.deepEqual(contentRequests, [\n    'https://chatgpt.com/backend-api/estuary/content?id=file_fixture-image&sig=secret'\n  ]);"
)
replace_once(
  test_path,
  "  assert.match(recovery, /path: hasCanonicalData \\? 'core-data' : 'core-resolver'/);\n  assert.match(recovery, /const imagePartIndexes = record\\.content\\.parts/);",
  "  assert.match(recovery, /path: hasCanonicalData \\? 'core-data' : 'core-download'/);\n  assert.match(recovery, /const imagePartIndexes = record\\.content\\.parts/);\n  const sedimentGuardAt = recovery.indexOf(\"const isSediment = internalImagePointerProtocol(sourcePointer) === 'sediment'\");\n  const missingResourceAt = recovery.indexOf(\"conversation-image-core-resource-missing\", sedimentGuardAt);\n  assert.ok(sedimentGuardAt >= 0 && missingResourceAt > sedimentGuardAt && missingResourceAt < domAt,\n    'Sediment recovery must fail explicitly on a missing Core transport before any DOM/raw-pointer fallback.');\n  assert.match(recovery, /script_version: VERSION/);"
)
replace_once(
  test_path,
  "test('DownloadConversation does not duplicate sediment-to-download URL construction', () => {",
  "test('Core download transport uses the captured authenticated API request context', () => {\n  const source = productionFunctionSource('fetchCanonicalResolvedImageDataUrl');\n  assert.match(source, /await apiFetch\\(resolverUrl\\)/);\n  assert.doesNotMatch(source, /fetch\\(resolverUrl/);\n});\n\ntest('DownloadConversation does not duplicate sediment-to-download URL construction', () => {"
)
replace_once(
  test_path,
  "  assert.match(userscript, /\\/\\/ @version      0\\.6\\.170/);",
  "  assert.match(userscript, /\\/\\/ @version      0\\.6\\.171/);"
)


design = 'DESIGN.md'
replace_once(
  design,
  "missing; other retrieval failures remain unavailable while preserving the original\nsource pointer.",
  "missing; other retrieval failures remain unavailable while preserving the original\nsource pointer.\n\nThe Core-supplied `download_url` is authoritative for `sediment://file_*` image\nrecovery. DownloadConversation does not reinterpret the raw sediment pointer and\ndoes not fall through to DOM recovery when that Core contract is missing; the\nmissing canonical transport is an invariant failure reported explicitly. The first\ntransport request uses the same captured authenticated page/API request context as\nConversation API retrieval. Image-recovery Debug diagnostics include the loaded\nuserscript version so a stale document runtime can be distinguished from the\ninstalled Tampermonkey version."
)
