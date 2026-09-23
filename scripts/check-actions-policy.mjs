import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');
const root = path.resolve(process.argv[2] || defaultRoot);
const workflowDir = path.join(root, '.github', 'workflows');

const requiredWorkflows = new Set([
  '.github/workflows/ci.yml',
]);

const allowedWorkflows = new Set([
  ...requiredWorkflows,
  '.github/workflows/build-userscript-artifact.yml',
]);

const approvedExternalActions = new Set([
  'actions/checkout@v4',
  'actions/setup-node@v4',
]);

const approvedWriteScripts = new Set([
  'scripts/test-cycle-artifact.mjs',
]);

const approvedWriteCommands = [
  /node\s+scripts\/test-cycle-artifact\.mjs\s+prepare\b[^\n]*\s--push\b/,
  /node\s+scripts\/test-cycle-artifact\.mjs\s+publish\b/,
];

const forbiddenDirectMutations = [
  /\bgit\s+(?:add|commit|push)\b/,
  /\bgh\s+api\b[^\n]*(?:--method|-X)\s+(?:POST|PUT|PATCH|DELETE)\b/i,
  /\bcurl\b[^\n]*(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)\b/i,
];

function fail(message) {
  console.error(`Actions policy violation: ${message}`);
  process.exitCode = 1;
}

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function topLevelContentsWrite(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (indentation(lines[i]) !== 0 || lines[i].trim() !== 'permissions:') continue;
    for (let j = i + 1; j < lines.length && indentation(lines[j]) > 0; j += 1) {
      if (/^contents:\s*write\s*$/.test(lines[j].trim())) return true;
    }
  }
  return false;
}

function jobBlocks(lines) {
  const jobsIndex = lines.findIndex((line) => indentation(line) === 0 && line.trim() === 'jobs:');
  if (jobsIndex < 0) return [];
  const blocks = [];
  let current = null;
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = indentation(line);
    if (line.trim() && indent === 0) break;
    if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim())) {
      if (current) blocks.push(current);
      current = { name: line.trim().slice(0, -1), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function jobContentsWrite(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (indentation(lines[i]) !== 4 || lines[i].trim() !== 'permissions:') continue;
    for (let j = i + 1; j < lines.length && indentation(lines[j]) > 4; j += 1) {
      if (/^contents:\s*write\s*$/.test(lines[j].trim())) return true;
    }
  }
  return false;
}

function validateWriteJob(relativePath, jobName, jobText) {
  for (const pattern of forbiddenDirectMutations) {
    if (pattern.test(jobText)) {
      fail(`${relativePath} job ${jobName} contains direct repository mutation command ${pattern}`);
    }
  }

  for (const match of jobText.matchAll(/\b(?:node|python(?:3)?)\s+(scripts\/[A-Za-z0-9._/-]+)/g)) {
    if (!approvedWriteScripts.has(match[1])) {
      fail(`${relativePath} job ${jobName} invokes unapproved local script ${match[1]} with contents: write`);
    }
  }

  for (const match of jobText.matchAll(/^\s*-\s+uses:\s*([^\s#]+).*$/gm)) {
    if (!approvedExternalActions.has(match[1])) {
      fail(`${relativePath} job ${jobName} uses unapproved action ${match[1]} with contents: write`);
    }
  }

  if (!approvedWriteCommands.some((pattern) => pattern.test(jobText))) {
    fail(`${relativePath} job ${jobName} grants contents: write without an approved generated-artifact/release command`);
  }

  const pushLines = jobText.split(/\r?\n/).filter((line) => /\s--push\b/.test(line));
  for (const line of pushLines) {
    if (!approvedWriteCommands[0].test(line)) {
      fail(`${relativePath} job ${jobName} contains an unapproved --push command: ${line.trim()}`);
    }
  }
}

if (!fs.existsSync(workflowDir)) {
  fail('missing .github/workflows directory');
} else {
  const workflowFiles = fs.readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  const workflowPaths = new Set(workflowFiles.map((name) => `.github/workflows/${name}`));

  for (const required of requiredWorkflows) {
    if (!workflowPaths.has(required)) fail(`missing required permanent workflow ${required}`);
  }

  for (const name of workflowFiles) {
    const relativePath = `.github/workflows/${name}`;
    const absolutePath = path.join(workflowDir, name);
    const text = fs.readFileSync(absolutePath, 'utf8');
    const lines = text.split(/\r?\n/);

    if (!allowedWorkflows.has(relativePath)) {
      fail(`unexpected workflow file ${relativePath}`);
      continue;
    }

    const inheritedWrite = topLevelContentsWrite(lines);
    for (const job of jobBlocks(lines)) {
      if (inheritedWrite || jobContentsWrite(job.lines)) {
        validateWriteJob(relativePath, job.name, job.lines.join('\n'));
      }
    }
  }
}
