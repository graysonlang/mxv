import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const materialXDir = path.join(root, 'vendor', 'MaterialX');
const outputDir = path.join(root, 'vendor', 'materialx-runtime');
const makefile = path.join(root, 'scripts', 'materialx-gen-shader.Makefile');

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: options.env ?? process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findEmscriptenCompiler() {
  if (process.env.CXX) return process.env.CXX;
  if (process.env.EMSDK) {
    const candidate = path.join(process.env.EMSDK, 'upstream', 'emscripten', 'em++');
    if (existsSync(candidate)) return candidate;
  }
  const which = spawnSync('sh', ['-lc', 'command -v em++'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  console.error('Could not find em++. Run `source /path/to/emsdk/emsdk_env.sh` or set CXX=/path/to/em++.');
  process.exit(1);
}

if (!existsSync(path.join(materialXDir, 'source', 'JsMaterialX'))) {
  run('node', [path.join(root, 'scripts', 'setup-materialx.mjs')]);
}

const clean = args.has('clean');
const cleanOnly = args.has('clean-only');
const jobs = args.get('jobs') || process.env.MATERIALX_JOBS || String(os.availableParallelism?.() ?? os.cpus().length ?? 8);
const cxx = findEmscriptenCompiler();
const emCache = process.env.EM_CACHE || path.join(root, 'vendor', '.cache', 'emscripten');

const makeArgs = [
  '-f', makefile,
  `-j${jobs}`,
  `CXX=${cxx}`,
  `EM_CACHE=${emCache}`,
];

if (clean || cleanOnly) run('make', [...makeArgs, 'clean']);
if (cleanOnly) process.exit(0);
run('make', makeArgs);

for (const file of ['JsMaterialXGenShader.js', 'JsMaterialXGenShader.wasm', 'JsMaterialXGenShader.data']) {
  const output = path.join(outputDir, file);
  if (!existsSync(output)) {
    console.error(`Expected ${path.relative(root, output)} to exist after build.`);
    process.exit(1);
  }
}

console.log(`MaterialX WASM bundle is ready in ${path.relative(root, outputDir)}.`);
