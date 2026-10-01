import { readFile } from 'node:fs/promises';

const DEFAULT_VERSION_SOURCE = 'src/userscript-header.js';
const MAIN_BRANCH = 'main';
const ISSUE_BRANCH_RE = /^issue-(\d+)(?:-|$)/;
const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_LINE_RE = /^\/\/ @version\s+(\S+)\s*$/gm;

function parseArgs(argv) {
  const options = { base: '', head: '', file: DEFAULT_VERSION_SOURCE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--base', '--head', '--file'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value.`);
    }
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

function extractVersion(source) {
  const matches = [...source.matchAll(VERSION_LINE_RE)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one userscript @version entry, found ${matches.length}.`);
  }
  return matches[0][1];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.base !== MAIN_BRANCH) {
    process.stdout.write(`Main integration guard: base ${options.base || '<none>'} is not main; no main integration policy applies.\n`);
    return;
  }
  if (!options.head) {
    throw new Error('PRs targeting main require an explicit source branch identity.');
  }
  if (ISSUE_BRANCH_RE.test(options.head)) {
    throw new Error(
      `Direct integration from issue branch ${options.head} to main is forbidden. `
      + 'Promote the validated issue candidate through a separate integration branch first.'
    );
  }

  const source = await readFile(options.file, 'utf8');
  const version = extractVersion(source);
  if (!STABLE_VERSION_RE.test(version)) {
    throw new Error(
      `PRs targeting main require a plain stable x.y.z userscript version before merge; found ${version}.`
    );
  }
  process.stdout.write(
    `Main integration guard: ${options.head} -> main carries stable version ${version}.\n`
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
