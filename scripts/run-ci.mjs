import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeCommand = process.execPath;

function run(name, args) {
  console.log(`\n=== ${name} ===`);
  console.log(`$ ${nodeCommand} ${args.join(' ')}`);
  const result = spawnSync(nodeCommand, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) {
    console.error(`${name}: ${result.error.message}`);
    return 2;
  }
  return result.status ?? 2;
}

const args = process.argv.slice(2);
const tagRequested = args.includes('--tag');
if (args.some(argument => argument !== '--tag')) {
  console.error('Usage: node scripts/run-ci.mjs [--tag]');
  process.exitCode = 2;
} else {
  console.log('DownloadConversation local CI');
  console.log(`Repository: ${root}`);

  const prepared = run(
    'Prepare committed test-cycle artifact',
    ['scripts/test-cycle-artifact.mjs', 'prepare']
  );
  if (prepared !== 0) {
    console.warn('INCOMPLETE: the deterministic test artifact could not be prepared; no tag will be created.');
    process.exitCode = 2;
  } else {
    const validation = run('Run repository-owned validation', ['scripts/ci-environment.mjs']);
    if (validation === 0) {
      if (tagRequested) {
        const published = run(
          'Publish tested artifact commit and version tag',
          ['scripts/test-cycle-artifact.mjs', 'publish']
        );
        process.exitCode = published === 0 ? 0 : 2;
      } else {
        console.log('\nPASS: validation completed. No tag requested; rerun with --tag only when publication is intended.');
      }
    } else if (validation === 2) {
      console.warn('\nINCOMPLETE: validation prerequisites were unavailable; no tag will be created.');
      process.exitCode = 2;
    } else {
      console.error('\nFAIL: genuine validation failures were observed; no stable-release tag will be created.');
      process.exitCode = 1;
    }
  }
}
