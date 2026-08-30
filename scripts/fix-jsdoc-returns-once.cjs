const fs = require('node:fs');
const acorn = require('acorn');

const file = 'chatgpt-conversation-markdown-export.user.js';
let source = fs.readFileSync(file, 'utf8');
const ast = acorn.parse(source, {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: false
});

function isFunction(node) {
  return node && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
}

function eachChild(node, callback) {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') callback(item);
    } else if (value && typeof value.type === 'string') {
      callback(value);
    }
  }
}

const functions = [];
function collectFunctions(node, declarationStart = null) {
  if (node.type === 'FunctionDeclaration' && node.id) {
    functions.push({ name: node.id.name, node, declarationStart: node.start });
  } else if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.id?.type === 'Identifier' && isFunction(decl.init)) {
        functions.push({ name: decl.id.name, node: decl.init, declarationStart: node.start });
      }
    }
  }
  eachChild(node, child => collectFunctions(child, declarationStart));
}
collectFunctions(ast);

function returnsOf(fn) {
  const returns = [];
  function walk(node) {
    if (node !== fn && isFunction(node)) return;
    if (node.type === 'ReturnStatement') {
      returns.push(node.argument);
      return;
    }
    eachChild(node, walk);
  }
  walk(fn.body);
  return returns;
}

function variableInitializers(fn) {
  const values = new Map();
  function walk(node) {
    if (node !== fn && isFunction(node)) return;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      values.set(node.id.name, node.init);
    }
    eachChild(node, walk);
  }
  walk(fn.body);
  return values;
}

function union(...types) {
  const flat = [];
  for (const type of types.flat()) {
    if (!type) continue;
    for (const part of type.split('|')) if (!flat.includes(part)) flat.push(part);
  }
  const order = ['string', 'number', 'boolean', 'Object', 'Array<unknown>', 'Map<unknown, unknown>', 'Set<unknown>', 'HTMLElement', 'Element', 'URL', 'Blob', 'Response', 'null', 'undefined', 'void'];
  flat.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
  });
  return flat.length ? flat.join('|') : null;
}

const stringMethods = new Set(['trim', 'trimStart', 'trimEnd', 'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'padStart', 'padEnd', 'substring', 'substr', 'toString', 'join']);
const booleanMethods = new Set(['includes', 'startsWith', 'endsWith', 'test', 'some', 'every', 'has']);
const arrayMethods = new Set(['map', 'filter', 'flatMap', 'slice', 'concat']);

function propertyName(member) {
  if (!member || member.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return String(member.property.value);
  return null;
}

function infer(node, vars, seen = new Set()) {
  if (!node) return 'void';
  switch (node.type) {
    case 'Literal':
      if (node.value === null) return 'null';
      if (['string', 'number', 'boolean'].includes(typeof node.value)) return typeof node.value;
      return null;
    case 'TemplateLiteral': return 'string';
    case 'ObjectExpression': return 'Object';
    case 'ArrayExpression': return 'Array<unknown>';
    case 'AwaitExpression': return infer(node.argument, vars, seen);
    case 'ChainExpression': return infer(node.expression, vars, seen);
    case 'AssignmentExpression': return infer(node.right, vars, seen);
    case 'SequenceExpression': return infer(node.expressions.at(-1), vars, seen);
    case 'ConditionalExpression': return union(infer(node.consequent, vars, seen), infer(node.alternate, vars, seen));
    case 'LogicalExpression': return union(infer(node.left, vars, seen), infer(node.right, vars, seen));
    case 'UnaryExpression':
      if (node.operator === '!') return 'boolean';
      if (node.operator === 'typeof') return 'string';
      if (['+', '-', '~'].includes(node.operator)) return 'number';
      return null;
    case 'BinaryExpression':
      if (['===', '!==', '==', '!=', '<', '<=', '>', '>=', 'in', 'instanceof'].includes(node.operator)) return 'boolean';
      if (['-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^'].includes(node.operator)) return 'number';
      if (node.operator === '+') {
        const left = infer(node.left, vars, seen);
        const right = infer(node.right, vars, seen);
        if (left === 'string' || right === 'string') return 'string';
        if (left === 'number' && right === 'number') return 'number';
      }
      return null;
    case 'NewExpression':
      if (node.callee.type === 'Identifier') {
        if (node.callee.name === 'Map') return 'Map<unknown, unknown>';
        if (node.callee.name === 'Set') return 'Set<unknown>';
        if (node.callee.name === 'URL') return 'URL';
        if (node.callee.name === 'Blob') return 'Blob';
      }
      return 'Object';
    case 'Identifier': {
      if (node.name === 'undefined') return 'undefined';
      if (seen.has(node.name)) return null;
      const init = vars.get(node.name);
      if (!init) return null;
      const next = new Set(seen);
      next.add(node.name);
      return infer(init, vars, next);
    }
    case 'MemberExpression': {
      const property = propertyName(node);
      if (property === 'length' || property === 'size') return 'number';
      return null;
    }
    case 'CallExpression': {
      if (node.callee.type === 'Identifier') {
        const name = node.callee.name;
        if (name === 'String') return 'string';
        if (name === 'Number' || name === 'parseInt' || name === 'parseFloat') return 'number';
        if (name === 'Boolean') return 'boolean';
        if (name === 'Array') return 'Array<unknown>';
        if (name === 'structuredClone') return infer(node.arguments[0], vars, seen);
      }
      if (node.callee.type === 'MemberExpression') {
        const method = propertyName(node.callee);
        if (stringMethods.has(method)) return 'string';
        if (booleanMethods.has(method)) return 'boolean';
        if (arrayMethods.has(method)) return 'Array<unknown>';
        if (method === 'createElement' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'document') return 'HTMLElement';
        if (['querySelector', 'closest'].includes(method)) return 'Element|null';
        if (method === 'json' && node.callee.object.type === 'Identifier') return 'Promise<Object>';
      }
      return null;
    }
    default: return null;
  }
}

function immediateJsdoc(start) {
  const prefix = source.slice(0, start);
  const stripped = prefix.trimEnd();
  if (!stripped.endsWith('*/')) return null;
  const marker = stripped.lastIndexOf('/**');
  if (marker < 0) return null;
  const lineStart = stripped.lastIndexOf('\n', marker - 1) + 1;
  return { start: lineStart, end: stripped.length, text: source.slice(lineStart, stripped.length) };
}

function returnDescription(name, type) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (type === 'void') return 'No value is returned.';
  if (type === 'boolean') return `\`true\` when the ${words} condition is satisfied; otherwise \`false\`.`;
  if (type.startsWith('Promise<')) return `A promise resolving to the value produced by \`${name}\`.`;
  if (type === 'string') return `The string produced by \`${name}\`.`;
  if (type === 'number') return `The numeric value produced by \`${name}\`.`;
  if (type.startsWith('Array<')) return `The ordered values produced by \`${name}\`.`;
  if (type.startsWith('Map<')) return `The lookup map produced by \`${name}\`.`;
  if (type.includes('null')) return `The value produced by \`${name}\`, or \`null\` when unavailable.`;
  return `The ${type} value produced by \`${name}\`.`;
}

const edits = [];
const unresolved = [];
for (const item of functions) {
  const doc = immediateJsdoc(item.declarationStart);
  if (!doc) continue;
  const match = doc.text.match(/@returns?\s+\{([^}]+)\}\s+([^\n]+)/);
  if (!match) continue;
  const current = match[1].trim();
  const vars = variableInitializers(item.node);
  const returns = returnsOf(item.node);
  const valueReturns = returns.filter(Boolean);
  if (!valueReturns.length) {
    if (current !== 'void') {
      const replacement = doc.text.replace(match[0], `@returns {void} No value is returned.`);
      edits.push({ ...doc, text: replacement });
    }
    continue;
  }
  const inferred = union(valueReturns.map(node => infer(node, vars)));
  if (!inferred) {
    if (current === 'void') unresolved.push(item.name);
    continue;
  }
  const normalized = item.node.async && !inferred.startsWith('Promise<') ? `Promise<${inferred}>` : inferred;
  if (current !== normalized || /No value is returned\./.test(match[2])) {
    const replacement = doc.text.replace(match[0], `@returns {${normalized}} ${returnDescription(item.name, normalized)}`);
    edits.push({ ...doc, text: replacement });
  }
}

for (const edit of edits.sort((a, b) => b.start - a.start)) {
  source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}
fs.writeFileSync(file, source);
console.log(`Updated ${edits.length} return contracts from AST evidence.`);
if (unresolved.length) {
  console.error(`Value-returning functions still documented void with unresolved return type:\n${unresolved.join('\n')}`);
  process.exit(2);
}
