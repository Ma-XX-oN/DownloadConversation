import { readDownloadConversationSource, readUserscriptManifest } from './userscript-build-lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await readUserscriptManifest(root);
const file = 'authoritative DownloadConversation source modules';
const text = await readDownloadConversationSource(root, manifest);

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  const stack = [];
  let quote = null;
  let escape = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (`'\"\``.includes(ch)) { quote = ch; continue; }
    if ('([{'.includes(ch)) stack.push(ch);
    else if (')]}'.includes(ch)) stack.pop();
    else if (ch === ',' && stack.length === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function immediateJsdoc(source, start) {
  const prefix = source.slice(0, start);
  const stripped = prefix.trimEnd();
  if (!stripped.endsWith('*/')) return null;
  const marker = stripped.lastIndexOf('/**');
  if (marker < 0) return null;
  const lineStart = stripped.lastIndexOf('\n', marker - 1) + 1;
  return { text: stripped.slice(lineStart), start: lineStart };
}

function findClosingParen(source, open) {
  let depth = 0;
  let quote = null;
  let escape = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (`'\"\``.includes(ch)) { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function functionsIn(source) {
  const results = [];
  const parenPatterns = [
    /^(?<indent>[ \t]*)(?:async\s+)?function\*?\s+(?<name>[A-Za-z_$][\w$]*)\s*\(/gm,
    /^(?<indent>[ \t]*)(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\*?\s*\(/gm,
    /^(?<indent>[ \t]*)(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm
  ];
  for (let patternIndex = 0; patternIndex < parenPatterns.length; patternIndex += 1) {
    const pattern = parenPatterns[patternIndex];
    for (let match; (match = pattern.exec(source)); ) {
      const open = source.indexOf('(', match.index);
      const close = findClosingParen(source, open);
      if (close < 0) continue;
      if (patternIndex === 2 && !/^\s*=>/.test(source.slice(close + 1))) continue;
      results.push({
        start: match.index,
        indent: match.groups.indent,
        name: match.groups.name,
        params: splitTopLevel(source.slice(open + 1, close))
      });
    }
  }
  const single = /^(?<indent>[ \t]*)(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?<param>[A-Za-z_$][\w$]*)\s*=>/gm;
  for (let match; (match = single.exec(source)); ) {
    results.push({
      start: match.index,
      indent: match.groups.indent,
      name: match.groups.name,
      params: [match.groups.param]
    });
  }
  return [...new Map(results.map(item => [item.start, item])).values()];
}

function alignedJsdoc(doc, indent) {
  const lines = doc.split('\n');
  if (lines[0] !== `${indent}/**`) return false;
  if (lines.at(-1) !== `${indent} */`) return false;
  return lines.slice(1, -1).every(line => line === `${indent} *` || line.startsWith(`${indent} * `));
}

function topLevelVariablesIn(source) {
  const results = [];
  const pattern = /^  (?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\b/gm;
  for (let match; (match = pattern.exec(source)); ) {
    results.push({ start: match.index, indent: '  ', name: match.groups.name });
  }
  return results;
}

function immediateVariableComment(source, variable) {
  const prefix = source.slice(0, variable.start).trimEnd();
  const lastLineStart = prefix.lastIndexOf('\n') + 1;
  const lastLine = prefix.slice(lastLineStart);
  if (lastLine.startsWith(`${variable.indent}//`) && lastLine.slice(variable.indent.length + 2).trim()) {
    return true;
  }
  if (/^  \/\*\*\s+\S.*\*\/$/.test(lastLine)) return true;
  const jsdoc = immediateJsdoc(source, variable.start);
  return Boolean(jsdoc && alignedJsdoc(jsdoc.text, variable.indent));
}

const placeholderType = 'Object|boolean|string|number|null';
const placeholderPhrases = [
  'The result produced by',
  'The Boolean result produced by',
  'value used by this operation',
  'according to the operation outcome'
];

const failures = [];
let functionCount = 0;
for (const fn of functionsIn(text)) {
  functionCount += 1;
  const found = immediateJsdoc(text, fn.start);
  if (!found) {
    failures.push(`${file}: ${fn.name}: missing immediate JSDoc`);
    continue;
  }
  const doc = found.text;

  if (!alignedJsdoc(doc, fn.indent)) {
    failures.push(`${file}: ${fn.name}: JSDoc indentation does not match the declaration`);
  }

  const paramTags = [...doc.matchAll(/@param\s+\{([^}]+)\}\s+([^\s]+)\s+-\s+(.+)/g)];
  const topLevelTags = paramTags.filter(tag => !tag[2].includes('.'));
  if (topLevelTags.length !== fn.params.length) {
    failures.push(`${file}: ${fn.name}: expected ${fn.params.length} typed @param tags, found ${topLevelTags.length}`);
  }
  for (const tag of paramTags) {
    if (!tag[1].trim() || !tag[3].trim()) failures.push(`${file}: ${fn.name}: incomplete @param ${tag[2]}`);
    if (tag[1].trim() === placeholderType) failures.push(`${file}: ${fn.name}: placeholder @param type`);
    if (placeholderPhrases.some(phrase => tag[3].includes(phrase))) failures.push(`${file}: ${fn.name}: placeholder @param description for ${tag[2]}`);
  }

  const returns = doc.match(/@returns?\s+\{([^}]+)\}\s+(.+)/);
  if (!returns) failures.push(`${file}: ${fn.name}: missing typed/described @returns`);
  else {
    if (!returns[1].trim() || !returns[2].trim()) failures.push(`${file}: ${fn.name}: incomplete @returns`);
    if (returns[1].trim() === placeholderType) failures.push(`${file}: ${fn.name}: placeholder @returns type`);
    if (placeholderPhrases.some(phrase => returns[2].includes(phrase))) failures.push(`${file}: ${fn.name}: placeholder @returns description`);
  }
}

let globalVariableCount = 0;
for (const variable of topLevelVariablesIn(text)) {
  globalVariableCount += 1;
  if (!immediateVariableComment(text, variable)) {
    failures.push(`${file}: ${variable.name}: top-level variable lacks an aligned explanatory comment`);
  }
}

if (failures.length) {
  console.error('Complete JSDoc/variable documentation failures:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(
  `Documentation audit passed for ${functionCount} named production functions and ` +
  `${globalVariableCount} top-level variables.`
);
