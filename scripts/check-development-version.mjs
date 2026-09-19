import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const DEFAULT_USERSCRIPT = 'chatgpt-conversation-markdown-export.user.js';
const DEVELOPMENT_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-issue\.(\d+)\.(\d+)$/;
const ISSUE_BRANCH_RE = /^issue-(\d+)(?:-|$)/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { branch: null, file: DEFAULT_USERSCRIPT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--branch' || arg === '--file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg === '--branch' ? 'branch' : 'file'] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function normalizeBranch(value) {
  return String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^origin\//, '');
}

function gitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function resolveBranch(explicitBranch) {
  const branch = normalizeBranch(
    explicitBranch
      || process.env.GITHUB_HEAD_REF
      || process.env.GITHUB_REF_NAME
      || gitBranch()
  );
  if (!branch || branch === 'HEAD') {
    throw new Error('Could not determine branch identity; pass --branch explicitly.');
  }
  return branch;
}

function extractVersion(source) {
  const matches = [...source.matchAll(/^\/\/ @version\s+(\S+)\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one userscript @version entry, found ${matches.length}.`);
  }
  return matches[0][1];
}

function owningIssue(branch) {
  const match = ISSUE_BRANCH_RE.exec(branch);
  return match ? Number.parseInt(match[1], 10) : null;
}

function validate(branch, version) {
  const owner = owningIssue(branch);
  if (owner === null) {
    return `No issue owner encoded by branch ${branch}; found version ${version}.`;
  }

  const match = DEVELOPMENT_VERSION_RE.exec(version);
  if (!match) {
    throw new Error(
      `Issue-owned branch requires x.y.z-issue.<issue>.<iteration> development version; found ${version}.`
    );
  }

  const versionIssue = Number.parseInt(match[4], 10);
  const iteration = Number.parseInt(match[5], 10);
  if (iteration < 1) {
    throw new Error(`Development version iteration must start at 1; found ${iteration}.`);
  }
  if (versionIssue !== owner) {
    throw new Error(
      `Development version issue ${versionIssue} does not match owning branch issue ${owner} (${branch}).`
    );
  }

  return `Development version guard: branch ${branch} issue ${owner} matches version ${version}.`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const branch = resolveBranch(options.branch);
  const source = await readFile(options.file, 'utf8');
  const version = extractVersion(source);
  process.stdout.write(`${validate(branch, version)}\n`);
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
