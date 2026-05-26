import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createNagaTranslator,
  nagaVersion,
  preprocessMaterialXGlsl,
} from '@graysonlang/naga';

const repoRoot = process.cwd();
const shaderCacheDir = path.join(repoRoot, 'vendor/.cache/materialx-shaders');
const outputRoot = path.join(repoRoot, 'vendor/.cache/naga-materialx');

await run(process.execPath, [
  'scripts/dump-materialx-shaders.mjs',
  '--sample=all',
  '--generator=wgsl',
]);
const translator = await createNagaTranslator();

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

  const vertexResult = await convertStage(sampleId, 'vertex', sampleOutputDir);
  const pixelResult = await convertStage(sampleId, 'pixel', sampleOutputDir);
  results.push({ pixel: pixelResult, sampleId, vertex: vertexResult });
}

console.log(`Naga MaterialX spike used @graysonlang/naga ${nagaVersion}`);
console.log(`Naga MaterialX spike wrote ${path.relative(repoRoot, outputRoot)}`);
for (const result of results) {
  console.log(`${result.sampleId}: vertex ${formatResult(result.vertex)}, pixel ${formatResult(result.pixel)}`);
}

const failures = results.flatMap(result => [result.vertex, result.pixel].filter(stage => !stage.ok));
if (failures.length) {
  process.exitCode = 1;
}

async function convertStage(sampleId, stageName, sampleOutputDir) {
  const sourcePath = path.join(shaderCacheDir, sampleId, `wgsl-complete.${stageName}.glsl`);
  const source = await readFile(sourcePath, 'utf8');
  const preprocessed = preprocessMaterialXGlsl(source);
  const preprocessedPath = path.join(sampleOutputDir, `${stageName}.naga.glsl`);
  const outputPath = path.join(sampleOutputDir, `${stageName}.wgsl`);
  await writeFile(preprocessedPath, preprocessed);

  try {
    const result = translator.translateGlslToWgsl(preprocessed, { stage: stageName });
    await writeFile(outputPath, result.wgsl);
    return {
      lines: result.wgsl.split('\n').length,
      ok: true,
      outputPath,
    };
  } catch (error) {
    return {
      error,
      ok: false,
      outputPath,
      stderr: error?.result?.diagnostics || error?.message || String(error),
    };
  }
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
      rejectPromise(error);
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
