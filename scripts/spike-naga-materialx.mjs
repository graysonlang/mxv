import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const shaderCacheDir = path.join(repoRoot, 'vendor/.cache/materialx-shaders');
const outputRoot = path.join(repoRoot, 'vendor/.cache/naga-materialx');
const defaultNaga = path.join(repoRoot, 'vendor/.cache/naga-cli/bin/naga');
const nagaBin = process.env.MXV_NAGA || defaultNaga;

const nagaVersion = await run(nagaBin, ['--version']);
await run(process.execPath, [
  'scripts/dump-materialx-shaders.mjs',
  '--sample=all',
  '--generator=wgsl',
]);

const sampleIds = (await readdir(shaderCacheDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (!sampleIds.length) {
  throw new Error(`No shader samples found in ${path.relative(repoRoot, shaderCacheDir)}.`);
}

const results = [];
for (const sampleId of sampleIds) {
  const sampleOutputDir = path.join(outputRoot, sampleId);
  await mkdir(sampleOutputDir, { recursive: true });

  const vertexResult = await convertStage(sampleId, 'vertex', 'vert', sampleOutputDir);
  const pixelResult = await convertStage(sampleId, 'pixel', 'frag', sampleOutputDir);
  results.push({ pixel: pixelResult, sampleId, vertex: vertexResult });
}

console.log(`Naga MaterialX spike used ${nagaVersion.stdout.trim() || nagaBin}`);
console.log(`Naga MaterialX spike wrote ${path.relative(repoRoot, outputRoot)}`);
for (const result of results) {
  console.log(`${result.sampleId}: vertex ${formatResult(result.vertex)}, pixel ${formatResult(result.pixel)}`);
}

const failures = results.flatMap(result => [result.vertex, result.pixel].filter(stage => !stage.ok));
if (failures.length) {
  process.exitCode = 1;
}

async function convertStage(sampleId, stageName, nagaStage, sampleOutputDir) {
  const sourcePath = path.join(shaderCacheDir, sampleId, `wgsl-complete.${stageName}.glsl`);
  const source = await readFile(sourcePath, 'utf8');
  const preprocessed = preprocessMaterialXGlsl(source);
  const preprocessedPath = path.join(sampleOutputDir, `${stageName}.naga.glsl`);
  const outputPath = path.join(sampleOutputDir, `${stageName}.wgsl`);
  await writeFile(preprocessedPath, preprocessed);

  const result = await run(nagaBin, [
    '--input-kind',
    'glsl',
    '--shader-stage',
    nagaStage,
    preprocessedPath,
    outputPath,
  ], { reject: false });

  if (result.code !== 0) {
    return {
      ok: false,
      outputPath,
      stderr: result.stderr.trim(),
    };
  }

  const output = await readFile(outputPath, 'utf8');
  return {
    lines: output.split('\n').length,
    ok: true,
    outputPath,
  };
}

function preprocessMaterialXGlsl(source) {
  return source
    .replace(/^#define\s+(thin_walled|u_refractionTwoSided)\s+bool\(\1\)\n/gm, '')
    .replace(/\bif\s*\(\s*u_refractionTwoSided\s*\)/g, 'if (u_refractionTwoSided != 0)')
    .replace(/\bopacity\s*,\s*thin_walled\s*,\s*geomprop_Nworld_out\b/g, 'opacity, (thin_walled != 0), geomprop_Nworld_out');
}

function formatResult(result) {
  if (result.ok) return `${result.lines} lines`;
  const firstLine = result.stderr.split('\n').find(Boolean) || 'failed';
  return `failed (${firstLine})`;
}

function run(command, args, options = {}) {
  const reject = options.reject !== false;
  return new Promise((resolve, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      const hint = command === nagaBin
        ? `${error.message}. Install naga-cli with: cargo install naga-cli --root vendor/.cache/naga-cli`
        : error.message;
      rejectPromise(new Error(hint));
    });
    child.on('close', (code) => {
      if (reject && code !== 0) {
        rejectPromise(new Error(stderr || `${command} exited with ${code}`));
        return;
      }
      resolve({ code, stderr, stdout });
    });
  });
}
