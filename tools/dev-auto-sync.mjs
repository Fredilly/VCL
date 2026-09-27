import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { dirname, join } from 'node:path';

const POLL_MS = 20_000;
const root = process.cwd();
const pnpm = process.env.npm_execpath || join(dirname(process.execPath), 'pnpm');
let dev = null;
let stopping = false;

function run(cmd, args, stdio = 'pipe') {
  return execFileSync(cmd, args, { cwd: root, stdio, encoding: 'utf8' }).trim();
}

function log(message) {
  console.log(`[scoop-auto] ${message}`);
}

function currentBranch() {
  return run('git', ['branch', '--show-current']);
}

function cleanWorktree() {
  return run('git', ['status', '--porcelain']) === '';
}

function startDev() {
  if (dev || stopping) return;
  dev = spawn(pnpm, ['--filter', '@vcl/extension', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  dev.on('exit', () => {
    dev = null;
    if (!stopping) setTimeout(startDev, 1500);
  });
}

function syncMain() {
  if (currentBranch() !== 'main') {
    log('Waiting: local repo is not on main.');
    return;
  }
  if (!cleanWorktree()) {
    log('Waiting: local changes detected; leaving them untouched.');
    return;
  }

  run('git', ['fetch', 'origin', 'main']);
  const local = run('git', ['rev-parse', 'HEAD']);
  const remote = run('git', ['rev-parse', 'origin/main']);
  if (local === remote) return;

  log('New main detected. Fast-forwarding…');
  run('git', ['pull', '--ff-only', 'origin', 'main'], 'inherit');
  log('Synced. WXT dev mode will rebuild and reload Scoop automatically.');
}

function stop() {
  stopping = true;
  if (dev) dev.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try { syncMain(); }
catch (error) {
  console.error('[scoop-auto] Initial sync failed:', error instanceof Error ? error.message : String(error));
}

log(`Watching ${root} for merges to origin/main every ${POLL_MS / 1000}s.`);
startDev();

setInterval(() => {
  try { syncMain(); }
  catch (error) {
    console.error('[scoop-auto] Sync failed:', error instanceof Error ? error.message : String(error));
  }
}, POLL_MS);
