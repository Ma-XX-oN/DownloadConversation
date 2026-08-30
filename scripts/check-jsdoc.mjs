import fs from 'node:fs';

const file = 'chatgpt-conversation-markdown-export.user.js';
const text = fs.readFileSync(file, 'utf8');

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
  const begin = stripped.lastIndexOf('/**');
  return begin < 0 ? null : stripped.slice(begin);
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
        name: match.groups.name,
        params: splitTopLevel(source.slice(open + 1, close))
      });
    }
  }
  const single = /^(?<indent>[ \t]*)(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?<param>[A-Za-z_$][\w$]*)\s*=>/gm;
  for (let match; (match = single.exec(source)); ) {
    results.push({ start: match.index, name: match.groups.name, params: [match.groups.param] });
  }
  return [...new Map(results.map(item => [item.start, item])).values()];
}

const failures = [];
let functionCount = 0;
for (const fn of functionsIn(text)) {
  functionCount += 1;
  const doc = immediateJsdoc(text, fn.start);
  if (!doc) {
    failures.push(`${file}: ${fn.name}: missing immediate JSDoc`);
    continue;
  }

  const paramTags = [...doc.matchAll(/@param\s+\{([^}]+)\}\s+([^\s]+)\s+-\s+(.+)/g)];
  const topLevelTags = paramTags.filter(tag => !tag[2].includes('.'));
  if (topLevelTags.length !== fn.params.length) {
    failures.push(`${file}: ${fn.name}: expected ${fn.params.length} typed @param tags, found ${topLevelTags.length}`);
  }
  for (const tag of paramTags) {
    if (!tag[1].trim() || !tag[3].trim()) failures.push(`${file}: ${fn.name}: incomplete @param ${tag[2]}`);
  }

  const returns = doc.match(/@returns?\s+\{([^}]+)\}\s+(.+)/);
  if (!returns) failures.push(`${file}: ${fn.name}: missing typed/described @returns`);
  else if (!returns[1].trim() || !returns[2].trim()) failures.push(`${file}: ${fn.name}: incomplete @returns`);
}

if (failures.length) {
  console.error('Complete JSDoc contract failures:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(`Complete typed JSDoc audit passed for ${functionCount} named production functions.`);
