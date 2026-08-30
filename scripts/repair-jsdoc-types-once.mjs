import fs from 'node:fs';
import ts from 'typescript';

const sourcePath = 'chatgpt-conversation-markdown-export.user.js';
const tempPath = '.tmp-jsdoc-inference.js';
const original = fs.readFileSync(sourcePath, 'utf8');

const stripped = original.replace(/\/\*\*[\s\S]*?\*\//g, match =>
  match.replace(/[^\n]/g, ' '));
fs.writeFileSync(tempPath, stripped);

const program = ts.createProgram([tempPath], {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  skipLibCheck: true
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(tempPath);

function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function semanticNoun(name) {
  const prefixes = [
    'is', 'has', 'can', 'should', 'render', 'format', 'build', 'collect', 'resolve',
    'find', 'get', 'current', 'sanitize', 'quote', 'escape', 'create', 'parse',
    'normalize', 'infer', 'extract', 'make', 'load', 'save', 'fetch', 'test'
  ];
  for (const prefix of prefixes) {
    if (name.startsWith(prefix) && name.length > prefix.length && /[A-Z]/.test(name[prefix.length])) {
      return words(name.slice(prefix.length));
    }
  }
  return words(name);
}

function returnDescription(name, type) {
  const noun = semanticNoun(name);
  if (type === 'void') return 'No value is returned.';
  if (type.startsWith('Promise<')) return `A promise resolving to the ${noun} result.`;
  if (type === 'boolean') {
    if (name.startsWith('is')) return `\`true\` when ${words(name.slice(2))}; otherwise \`false\`.`;
    if (name.startsWith('has')) return `\`true\` when ${words(name.slice(3))} is present; otherwise \`false\`.`;
    if (name.startsWith('can')) return `\`true\` when ${words(name.slice(3))} is permitted; otherwise \`false\`.`;
    return `\`true\` when the ${noun} condition is satisfied; otherwise \`false\`.`;
  }
  if (name.startsWith('render')) return `The rendered ${noun}.`;
  if (name.startsWith('format')) return `The formatted ${noun}.`;
  if (name.startsWith('sanitize')) return `The sanitized ${noun}.`;
  if (name.startsWith('quote')) return `The quoted ${noun}.`;
  if (name.startsWith('escape')) return `The escaped ${noun}.`;
  if (name.startsWith('build')) return `The constructed ${noun}.`;
  if (name.startsWith('collect')) return `The collected ${noun}.`;
  if (name.startsWith('resolve')) return `The resolved ${noun}${type.includes('null') ? ', or `null` when it cannot be resolved' : ''}.`;
  if (name.startsWith('find')) return `The matching ${noun}${type.includes('null') ? ', or `null` when no match exists' : ''}.`;
  if (name.startsWith('current')) return `The current ${noun}${type.includes('null') ? ', or `null` when unavailable' : ''}.`;
  if (name === 'rawHeadersToObject') return 'A plain object containing the normalized HTTP header names and values.';
  if (type.startsWith('Array<')) return `The ordered ${noun} entries.`;
  if (type.startsWith('Map<')) return `The ${noun} lookup map.`;
  if (type.includes('null')) return `The ${noun} result, or \`null\` when unavailable.`;
  return `The ${noun} result.`;
}

function normalizeAtomicType(text) {
  const type = text.trim();
  if (!type) return null;
  if (type === 'any' || type === 'unknown') return null;
  if (type === '{}') return 'Record<string, any>';
  if (/^\{[\s\S]*\}$/.test(type)) return 'Record<string, any>';
  if (type === 'any[]' || type === 'unknown[]') return 'Array<unknown>';
  if (/^Array<.*>$/.test(type)) return type.replace(/any/g, 'unknown');
  if (/^Map<.*>$/.test(type) || /^Set<.*>$/.test(type) || /^Promise<.*>$/.test(type)) {
    return type.replace(/any/g, 'unknown');
  }
  if (/^(?:string|number|boolean|void|null|undefined|Element|HTMLElement|HTMLImageElement|HTMLButtonElement|HTMLInputElement|HTMLSelectElement|EventTarget|Event|Response|Blob|URL|Headers|AbortSignal|WakeLockSentinel)$/.test(type)) return type;
  if (/^[A-Za-z_$][\w$]*(?:<.*>)?$/.test(type) && !/^Object$/.test(type)) return type;
  return 'Record<string, any>';
}

function normalizeReturnType(type) {
  if (type.isUnion()) {
    const parts = [];
    for (const item of type.types) {
      const normalized = normalizeAtomicType(checker.typeToString(item, undefined, ts.TypeFormatFlags.NoTruncation));
      if (normalized && !parts.includes(normalized)) parts.push(normalized);
    }
    if (!parts.length) return null;
    return parts.join('|');
  }
  return normalizeAtomicType(checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation));
}

function paramType(name, current) {
  const bare = name.replace(/^\.\.\./, '').replace(/^\[|\]$/g, '').split('.')[0];
  const exact = {
    condition: 'boolean',
    milliseconds: 'number',
    pageNumber: 'number',
    maxChars: 'number',
    width: 'number',
    depth: 'number',
    index: 'number',
    ordinal: 'number',
    imageOrdinal: 'number',
    sourceIndex: 'number',
    recordIndex: 'number',
    partIndex: 'number',
    startOffset: 'number',
    count: 'number',
    cursor: 'string|null',
    url: 'string',
    conversationId: 'string',
    recordId: 'string',
    role: 'string',
    kind: 'string',
    level: 'string',
    filename: 'string',
    language: 'string',
    explicitLanguage: 'string|null',
    code: 'string',
    text: 'string',
    markdown: 'string',
    message: 'string',
    reason: 'string',
    prefix: 'string',
    blob: 'Blob',
    response: 'Response',
    event: 'Event',
    element: 'Element',
    image: 'HTMLImageElement',
    section: 'HTMLElement',
    dialog: 'HTMLElement',
    overlay: 'HTMLElement',
    opener: 'Element|null',
    target: 'EventTarget|null',
    onProgress: 'Function',
    fetchPage: 'Function',
    headers: 'Headers|Array<unknown>|Record<string, any>',
    headerCandidates: 'Array<Headers|Array<unknown>|Record<string, any>>'
  };
  if (exact[bare]) return exact[bare];
  if (/^(?:on[A-Z]|fetch[A-Z].*Callback|callback|fn)$/.test(bare)) return 'Function';
  if (/(?:Index|Offset|Count|Length|Ordinal|Number|Depth|Width|Height|Size)$/.test(bare)) return 'number';
  if (/^(?:is|has|can|should)[A-Z]/.test(bare)) return 'boolean';
  if (current === 'Object') return 'Record<string, any>';
  if (/^Array<Object>$/.test(current)) return 'Array<Record<string, any>>';
  return current;
}

function paramDescription(name, type, oldDescription) {
  const bare = name.replace(/^\.\.\./, '').replace(/^\[|\]$/g, '').split('.').at(-1);
  const exact = {
    condition: 'The condition that must be true.',
    milliseconds: 'The duration in milliseconds.',
    pageNumber: 'The one-based Conversation API page number.',
    maxChars: 'The maximum number of characters to retain.',
    width: 'The maximum wrapped line width in characters.',
    depth: 'The current traversal depth.',
    index: 'The zero-based index to process.',
    ordinal: 'The ordinal position to process.',
    imageOrdinal: 'The zero-based image position within the source record.',
    cursor: 'The pagination cursor, or `null` for the first page.',
    response: 'The HTTP response to inspect.',
    event: 'The DOM event to process.',
    element: 'The DOM element to inspect.',
    image: 'The image element to inspect.',
    target: 'The event target to inspect, or `null` when there is no target.',
    onProgress: 'The callback invoked with pagination or extraction progress.',
    fetchPage: 'The callback used to fetch one Conversation API page.',
    headers: 'The HTTP headers supplied as a Headers object, entry array, or plain object.',
    headerCandidates: 'The candidate HTTP-header collections to merge.'
  };
  if (exact[bare]) return exact[bare];
  if (/^(?:The .* value required by this function\.|The .* value to process\.)$/.test(oldDescription)) {
    return `The ${words(bare)} used by this function.`;
  }
  return oldDescription;
}

const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    functions.push({ name: node.name.text, node, start: node.getStart(source) });
  } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
             (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    functions.push({ name: node.name.text, node: node.initializer, start: node.parent.parent.getStart(source) });
  }
  ts.forEachChild(node, visit);
}
visit(source);

const edits = [];
for (const fn of functions) {
  const signature = checker.getSignatureFromDeclaration(fn.node);
  if (!signature) continue;
  const inferred = normalizeReturnType(checker.getReturnTypeOfSignature(signature));

  const prefix = original.slice(0, fn.start);
  const strippedPrefix = prefix.trimEnd();
  if (!strippedPrefix.endsWith('*/')) continue;
  const marker = strippedPrefix.lastIndexOf('/**');
  if (marker < 0) continue;
  const lineStart = strippedPrefix.lastIndexOf('\n', marker - 1) + 1;
  const end = strippedPrefix.length;
  let doc = original.slice(lineStart, end);

  doc = doc.replace(/@param\s+\{([^}]+)\}\s+([^\s]+)\s+-\s+([^\n]+)/g,
    (_match, current, name, description) => {
      const type = paramType(name, current.trim());
      return `@param {${type}} ${name} - ${paramDescription(name, type, description.trim())}`;
    });

  doc = doc.replace(/@returns?\s+\{([^}]+)\}\s+([^\n]+)/,
    (_match, current) => {
      const type = inferred ?? current.trim();
      return `@returns {${type}} ${returnDescription(fn.name, type)}`;
    });

  edits.push({ start: lineStart, end, text: doc });
}

let output = original;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
fs.writeFileSync(sourcePath, output);
fs.unlinkSync(tempPath);
console.log(`Repaired semantic JSDoc types/descriptions for ${edits.length} functions.`);
