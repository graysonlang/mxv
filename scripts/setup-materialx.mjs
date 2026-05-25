import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor');
const materialXDir = path.join(vendorDir, 'MaterialX');
const sourceConfigPath = path.join(root, 'materialx-source.json');

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

function readSourceConfig() {
  if (!existsSync(sourceConfigPath)) return {};
  try {
    return JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${path.relative(root, sourceConfigPath)}.`);
    console.error(error.message);
    process.exit(1);
  }
}

const sourceConfig = readSourceConfig();
const repo = args.get('repo') || process.env.MATERIALX_REPO || sourceConfig.repo || 'https://github.com/AcademySoftwareFoundation/MaterialX.git';
const ref = args.get('ref') || process.env.MATERIALX_REF || sourceConfig.ref || 'main';
const updateSubmodulesEnabled = sourceConfig.updateSubmodules !== false;
const force = args.has('force') || process.env.MATERIALX_VENDOR_FORCE === '1';

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0 && !options.allowFailure) process.exit(result.status ?? 1);
  return result;
}

function runOutput(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
    env: process.env,
  });
}

function hasMaterialXAssets() {
  return requiredAssetRoots.every(assetRoot => existsSync(path.join(materialXDir, assetRoot)));
}

function isCommitHash(value) {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function normalizeSparsePath(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function readPathList(name) {
  return Array.isArray(sourceConfig[name])
    ? sourceConfig[name].map(normalizeSparsePath).filter(Boolean)
    : [];
}

function sparseDirectoryPattern(value) {
  return `/${value}/`;
}

function formatRequiredAssetRoots() {
  return requiredAssetRoots
    .map(assetRoot => path.join('vendor', 'MaterialX', assetRoot))
    .join(', ');
}

const sparseIncludes = readPathList('sparseIncludes');
const sparseExcludes = readPathList('sparseExcludes');
const requiredAssetRoots = readPathList('requiredAssetRoots');
if (requiredAssetRoots.length === 0) {
  requiredAssetRoots.push('resources', 'javascript/MaterialXView/public');
}

function configureSparseCheckout() {
  if (sparseIncludes.length === 0 && sparseExcludes.length === 0) return;

  run('git', ['sparse-checkout', 'init', '--no-cone'], { cwd: materialXDir });
  const patterns = sparseIncludes.length > 0
    ? sparseIncludes.map(sparseDirectoryPattern)
    : ['/*'];

  run('git', [
    'sparse-checkout',
    'set',
    ...patterns,
    ...sparseExcludes.map(excludePath => `!/${excludePath}/`),
  ], { cwd: materialXDir });
}

function updateSubmodules() {
  if (!updateSubmodulesEnabled) return;
  run('git', ['submodule', 'update', '--init', '--recursive', '--depth=1'], { cwd: materialXDir });
}

function checkoutRef() {
  configureSparseCheckout();
  run('git', ['fetch', '--filter=blob:none', '--tags', 'origin'], { cwd: materialXDir });
  let checkout = run('git', ['checkout', ref], { cwd: materialXDir, allowFailure: true });

  if (checkout.status !== 0) {
    run('git', ['fetch', '--filter=blob:none', 'origin', ref], { cwd: materialXDir });
    checkout = run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: materialXDir });
  }

  const branch = runOutput('git', ['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: materialXDir, quiet: true });
  if (branch.status === 0 && branch.stdout.trim()) {
    run('git', ['pull', '--ff-only'], { cwd: materialXDir });
  }

  updateSubmodules();
}

function cloneAtRef() {
  if (!isCommitHash(ref)) {
    const clone = run('git', [
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      '--branch', ref,
      repo,
      materialXDir,
    ], { allowFailure: true });

    if (clone.status === 0) {
      configureSparseCheckout();
      run('git', ['checkout', ref], { cwd: materialXDir });
      updateSubmodules();
      return;
    }
    rmSync(materialXDir, { recursive: true, force: true });
  }

  console.log(`Falling back to commit checkout for MaterialX ${ref}...`);
  run('git', ['clone', '--filter=blob:none', '--no-checkout', repo, materialXDir]);
  configureSparseCheckout();
  run('git', ['fetch', '--filter=blob:none', 'origin', ref], { cwd: materialXDir });
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: materialXDir });
  updateSubmodules();
}

mkdirSync(vendorDir, { recursive: true });

if (existsSync(materialXDir) && force) {
  console.log(`Removing existing ${path.relative(root, materialXDir)} because --force was supplied.`);
  rmSync(materialXDir, { recursive: true, force: true });
}

if (!existsSync(materialXDir)) {
  console.log(`Cloning MaterialX ${ref} into ${path.relative(root, materialXDir)}...`);
  cloneAtRef();
} else if (existsSync(path.join(materialXDir, '.git'))) {
  console.log(`Updating MaterialX checkout in ${path.relative(root, materialXDir)}...`);
  checkoutRef();
} else if (hasMaterialXAssets()) {
  console.log(`Using existing ${path.relative(root, materialXDir)} asset directory. It is not a git checkout; pass --force to replace it.`);
} else {
  console.error(`${path.relative(root, materialXDir)} exists, but does not include the expected MaterialX viewer asset folders.`);
  console.error('Move it aside or rerun with --force.');
  process.exit(1);
}

if (!hasMaterialXAssets()) {
  console.error(`MaterialX setup did not produce the expected viewer asset folders: ${formatRequiredAssetRoots()}.`);
  process.exit(1);
}

console.log('MaterialX viewer asset setup is ready.');
