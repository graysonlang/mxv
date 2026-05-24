import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor');
const materialXDir = path.join(vendorDir, 'MaterialX');

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

const repo = args.get('repo') || process.env.MATERIALX_REPO || 'https://github.com/AcademySoftwareFoundation/MaterialX.git';
const ref = args.get('ref') || process.env.MATERIALX_REF || 'main';
const force = args.has('force') || process.env.MATERIALX_VENDOR_FORCE === '1';

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hasMaterialXShape() {
  return existsSync(path.join(materialXDir, 'source', 'JsMaterialX'))
    && existsSync(path.join(materialXDir, 'libraries'));
}

mkdirSync(vendorDir, { recursive: true });

if (existsSync(materialXDir) && force) {
  console.log(`Removing existing ${path.relative(root, materialXDir)} because --force was supplied.`);
  rmSync(materialXDir, { recursive: true, force: true });
}

if (!existsSync(materialXDir)) {
  console.log(`Cloning MaterialX ${ref} into ${path.relative(root, materialXDir)}...`);
  run('git', [
    'clone',
    '--depth=1',
    '--branch', ref,
    '--recurse-submodules',
    '--shallow-submodules',
    repo,
    materialXDir,
  ]);
} else if (existsSync(path.join(materialXDir, '.git'))) {
  console.log(`Updating MaterialX checkout in ${path.relative(root, materialXDir)}...`);
  run('git', ['fetch', '--tags', 'origin'], { cwd: materialXDir });
  run('git', ['checkout', ref], { cwd: materialXDir });
  run('git', ['pull', '--ff-only'], { cwd: materialXDir });
  run('git', ['submodule', 'update', '--init', '--recursive'], { cwd: materialXDir });
} else if (hasMaterialXShape()) {
  console.log(`Using existing ${path.relative(root, materialXDir)} directory. It is not a git checkout; pass --force to replace it.`);
} else {
  console.error(`${path.relative(root, materialXDir)} exists, but does not look like a MaterialX checkout.`);
  console.error('Move it aside or rerun with --force.');
  process.exit(1);
}

if (!hasMaterialXShape()) {
  console.error('MaterialX setup did not produce the expected source/JsMaterialX and libraries folders.');
  process.exit(1);
}

console.log('MaterialX vendor setup is ready.');
