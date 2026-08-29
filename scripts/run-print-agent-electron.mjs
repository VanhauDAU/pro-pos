import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(command, ['exec', 'electron', '.'], {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
