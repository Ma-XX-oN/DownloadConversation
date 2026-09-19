import fs from 'node:fs';

const path = 'scripts/issue-140-terminal-dispatch-apply.mjs';
let source = fs.readFileSync(path, 'utf8');

const before = `function documentedFunctionRange(source, name) {
  const starts = [
    source.indexOf(\`  async function \${name}(\`),
    source.indexOf(\`  function \${name}(\`)
  ].filter(index => index >= 0);
  if (!starts.length) throw new Error(\`Missing production function \${name}.\`);
  const functionStart = Math.min(...starts);
  const docStart = source.lastIndexOf('\\n  /**', functionStart);
  if (docStart < 0) throw new Error(\`Missing JSDoc for \${name}.\`);
  const boundaries = [
    source.indexOf('\\n\\n  /**', functionStart + 3),
    source.indexOf('\\n  // END ', functionStart + 3)
  ].filter(index => index >= 0);
  if (!boundaries.length) throw new Error(\`Missing boundary for \${name}.\`);
  return { start: docStart + 1, end: Math.min(...boundaries) };
}

function replaceDocumentedFunction(source, name, replacement) {
  const { start, end } = documentedFunctionRange(source, name);
  return source.slice(0, start) + replacement + source.slice(end);
}`;

const after = `function exactFunctionEnd(source, functionStart, name) {
  const open = source.indexOf('{', functionStart);
  if (open < 0) throw new Error(\`Missing opening brace for \${name}.\`);
  let depth = 0;
  let mode = 'code';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (char === '\\\\') {
        index += 1;
        continue;
      }
      if ((mode === 'single' && char === "'") ||
          (mode === 'double' && char === '"') ||
          (mode === 'template' && char === '\\`')) {
        mode = 'code';
      }
      continue;
    }
    if (mode === 'line-comment') {
      if (char === '\\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        index += 1;
      }
      continue;
    }
    if (char === "'") {
      mode = 'single';
      continue;
    }
    if (char === '"') {
      mode = 'double';
      continue;
    }
    if (char === '\\`') {
      mode = 'template';
      continue;
    }
    if (char === '/' && next === '/') {
      mode = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment';
      index += 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(\`Missing closing brace for \${name}.\`);
}

function documentedFunctionRange(source, name) {
  const starts = [
    source.indexOf(\`  async function \${name}(\`),
    source.indexOf(\`  function \${name}(\`)
  ].filter(index => index >= 0);
  if (!starts.length) throw new Error(\`Missing production function \${name}.\`);
  const functionStart = Math.min(...starts);
  const docStart = source.lastIndexOf('\\n  /**', functionStart);
  if (docStart < 0) throw new Error(\`Missing JSDoc for \${name}.\`);
  return {
    start: docStart + 1,
    end: exactFunctionEnd(source, functionStart, name)
  };
}

function replaceDocumentedFunction(source, name, replacement) {
  const { start, end } = documentedFunctionRange(source, name);
  return source.slice(0, start) + replacement + source.slice(end);
}`;

const first = source.indexOf(before);
if (first < 0) throw new Error('Original temporary documented-function boundary helper is missing.');
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error('Original temporary documented-function boundary helper is duplicated.');
}
source = source.slice(0, first) + after + source.slice(first + before.length);
fs.writeFileSync(path, source);
