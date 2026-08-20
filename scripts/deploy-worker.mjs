import { execFileSync } from 'node:child_process';

const environment = process.argv[2];
if (!['staging', 'production'].includes(environment)) {
  throw new Error('Usage: node scripts/deploy-worker.mjs <staging|production>');
}

const commit =
  process.env.BUILD_SHA ||
  process.env.GITHUB_SHA ||
  execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
const builtAt = process.env.BUILD_TIME || new Date().toISOString();

execFileSync(
  'wrangler',
  [
    'deploy',
    '--env',
    environment,
    '--var',
    `BUILD_SHA:${commit}`,
    '--var',
    `BUILD_TIME:${builtAt}`,
  ],
  { stdio: 'inherit' },
);
