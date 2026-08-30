import fs from 'node:fs';

const file = 'chatgpt-conversation-markdown-export.user.js';
const text = fs.readFileSync(file, 'utf8');
const patterns = [
  /^(?<indent>[ \t]*)(?:(?:async\s+)?function\*?\s+(?<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)/gm,
  /^(?<indent>[ \t]*)(?:(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/gm,
  /^(?<indent>[ \t]*)(?:(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\*?\s*\([^)]*\)\s*\{)/gm
];

const failures = [];
const seen = new Set();
for (const pattern of patterns) {
  pattern.lastIndex = 0;
  for (let match; (match = pattern.exec(text)); ) {
    if (seen.has(match.index)) continue;
    seen.add(match.index);
    const prefix = text.slice(0, match.index);
    if (!/\/\*\*[\s\S]*?\*\/\s*$/.test(prefix)) {
      const line = prefix.split('\n').length;
      failures.push(`${file}:${line}: ${match.groups.name}`);
    }
  }
}

if (failures.length) {
  console.error('Named production functions missing immediate JSDoc:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(`JSDoc audit passed for ${seen.size} named production functions.`);
