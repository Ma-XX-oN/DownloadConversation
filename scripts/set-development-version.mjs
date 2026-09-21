import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_VERSION_SOURCE = 'src/userscript-header.js';
const GENERATED_ARTIFACT = 'chatgpt-conversation-markdown-export.user.js';
const ISSUE_BRANCH_RE = /^issue-(\d+)(?:-|$)/;
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_WITH_OPTIONAL_ISSUE_RE = /^(\d+\.\d+\.\d+)(?:-issue\.\d+\.\d+)?$/;
const VERSION_LINE_RE = /^\/\/ @version[ \t]+(\S+)([ \t]*)\r?$/gm;
const guardPath = fileURLToPath(new URL('./check-development-version.mjs', import.meta.url));
const buildPath = fileURLToPath(new URL('./build-userscript.mjs', import.meta.url));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {
    branch: null,
    file: DEFAULT_VERSION_SOURCE,
    iteration: null,
    release: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--branch', '--file', '--iteration', '--release'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg.slice(2)] = value;
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

function owningIssue(branch) {
  const match = ISSUE_BRANCH_RE.exec(branch);
  if (!match) {
    throw new Error(`Branch ${branch} does not encode an owning issue.`);
  }
  return Number.parseInt(match[1], 10);
}

function parseIteration(value) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new Error('Development version iteration must be a positive integer.');
  }
  const iteration = Number.parseInt(value, 10);
  if (iteration < 1) {
    throw new Error('Development version iteration must be a positive integer.');
  }
  return iteration;
}

function locateVersionToken(text) {
  const matches = [...text.matchAll(VERSION_LINE_RE)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one userscript @version entry, found ${matches.length}.`);
  }

  const match = matches[0];
  const currentVersion = match[1];
  const tokenOffset = match[0].indexOf(currentVersion);
  const characterStart = match.index + tokenOffset;
  const characterEnd = characterStart + currentVersion.length;

  return { currentVersion, characterStart, characterEnd };
}

function releaseTarget(currentVersion, explicitRelease) {
  if (explicitRelease !== null) {
    if (!RELEASE_VERSION_RE.test(explicitRelease)) {
      throw new Error(`Release target must use x.y.z form; found ${explicitRelease}.`);
    }
    return explicitRelease;
  }

  const match = VERSION_WITH_OPTIONAL_ISSUE_RE.exec(currentVersion);
  if (!match) {
    throw new Error(`Cannot derive x.y.z release target from current version ${currentVersion}.`);
  }
  return match[1];
}

function byteOffset(text, characterOffset) {
  return Buffer.byteLength(text.slice(0, characterOffset), 'utf8');
}

function replaceVersionToken(bytes, text, token, newVersion) {
  const byteStart = byteOffset(text, token.characterStart);
  const byteEnd = byteOffset(text, token.characterEnd);
  return Buffer.concat([
    bytes.subarray(0, byteStart),
    Buffer.from(newVersion, 'utf8'),
    bytes.subarray(byteEnd)
  ]);
}

function runGuard(file, branch) {
  return execFileSync(process.execPath, [guardPath, '--file', file, '--branch', branch], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function rebuildCommittedArtifact() {
  return execFileSync(process.execPath, [buildPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function readArtifactSnapshot() {
  try {
    return await readFile(GENERATED_ARTIFACT);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreProductionFiles(headerBytes, artifactBytes) {
  await writeFile(DEFAULT_VERSION_SOURCE, headerBytes);
  if (artifactBytes === null) {
    await rm(GENERATED_ARTIFACT, { force: true });
  } else {
    await writeFile(GENERATED_ARTIFACT, artifactBytes);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const branch = resolveBranch(options.branch);
  const issue = owningIssue(branch);
  const iteration = parseIteration(options.iteration);
  const before = await readFile(options.file);
  const text = before.toString('utf8');
  const token = locateVersionToken(text);
  const release = releaseTarget(token.currentVersion, options.release);
  const newVersion = `${release}-issue.${issue}.${iteration}`;
  const productionSource = options.file === DEFAULT_VERSION_SOURCE;
  const artifactBefore = productionSource ? await readArtifactSnapshot() : null;

  try {
    if (newVersion !== token.currentVersion) {
      const after = replaceVersionToken(before, text, token, newVersion);
      await writeFile(options.file, after);
    }

    let buildOutput = '';
    if (productionSource) buildOutput = rebuildCommittedArtifact();
    const guardOutput = runGuard(options.file, branch);
    process.stdout.write(`Established development version ${newVersion} for branch ${branch}.\n`);
    if (buildOutput) process.stdout.write(buildOutput);
    process.stdout.write(guardOutput);
  } catch (error) {
    if (productionSource) await restoreProductionFiles(before, artifactBefore);
    throw error;
  }
}

try {
  await main();
} catch (error) {
  if (error?.stderr) {
    process.stderr.write(String(error.stderr));
  }
  fail(error instanceof Error ? error.message : String(error));
}
