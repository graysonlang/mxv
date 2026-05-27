import { mkdir, readdir, rm, stat, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const imageExtensions = new Set(['.jpg', '.png']);
const materialXResourceExtensions = new Set([
  '.bmp',
  '.exr',
  '.gif',
  '.glb',
  '.hdr',
  '.jpeg',
  '.jpg',
  '.mtlx',
  '.png',
  '.tga',
]);
const runtimeExtensions = new Set(['.data', '.js', '.wasm']);
const nagaRuntimeExtensions = new Set(['.wasm']);
const nagaShaderExtensions = new Set(['.wgsl']);
const requiredRuntimeFiles = [
  'JsMaterialXGenShader.data',
  'JsMaterialXGenShader.js',
  'JsMaterialXGenShader.wasm',
];
const requiredNagaRuntimeFiles = [
  'graysonlang_naga.wasm',
];
const materialXResourceRoot = 'vendor/MaterialX/resources';
const materialXViewerAssetRoot = 'vendor/MaterialX/javascript/MaterialXView/public';
const nagaShaderRoot = 'vendor/.cache/naga-materialx';

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function missingMaterialXAssetsMessage(srcRoot) {
  return [
    `Missing ${srcRoot}.`,
    'Run `npm run setup:assets` to clone the filtered MaterialX viewer assets.',
  ].join(' ');
}

function missingRuntimeMessage(filename) {
  return [
    `Missing @graysonlang/mx runtime file: ${filename}.`,
    'Run `npm install` to restore the runtime package, or refresh the GitHub dependency if the package shape changed.',
  ].join(' ');
}

async function walkFiles(dir) {
  if (!await exists(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    if (entry.isFile()) return [entryPath];
    return [];
  }));

  return files.flat();
}

async function copyIfChanged(src, dest) {
  await mkdir(path.dirname(dest), { recursive: true });

  const srcStat = await stat(src);
  if (await exists(dest)) {
    const destStat = await stat(dest);
    if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
      return;
    }
  }

  await copyFile(src, dest);
}

async function copyMatching(root, outdir, srcRoot, extensionSet, { required = false } = {}) {
  const absoluteSrcRoot = path.join(root, srcRoot);
  if (required && !await directoryExists(absoluteSrcRoot)) {
    throw new Error(missingMaterialXAssetsMessage(srcRoot));
  }

  const files = await walkFiles(absoluteSrcRoot);
  const copied = [];

  for (const file of files) {
    if (!extensionSet.has(path.extname(file).toLowerCase())) continue;

    const rel = path.relative(root, file);
    await copyIfChanged(file, path.join(outdir, rel));
    copied.push(rel);
  }

  return copied.sort();
}

function resolveMaterialXRuntimeRoot(root) {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  try {
    const packageJsonPath = requireFromRoot.resolve('@graysonlang/mx/package.json');
    return path.join(path.dirname(packageJsonPath), 'dist', 'runtime');
  } catch (error) {
    throw new Error('Missing @graysonlang/mx runtime package. Run `npm install` before building.', { cause: error });
  }
}

function resolveNagaRuntimeRoot(root) {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  try {
    const packageJsonPath = requireFromRoot.resolve('@graysonlang/naga/package.json');
    return path.join(path.dirname(packageJsonPath), 'dist', 'runtime');
  } catch (error) {
    throw new Error('Missing @graysonlang/naga runtime package. Run `npm install` before building.', { cause: error });
  }
}

async function copyMaterialXRuntime(root, outdir) {
  const runtimeRoot = resolveMaterialXRuntimeRoot(root);
  await Promise.all(requiredRuntimeFiles.map(async (filename) => {
    const runtimeFile = path.join(runtimeRoot, filename);
    if (!await exists(runtimeFile)) {
      throw new Error(missingRuntimeMessage(filename));
    }
  }));

  const files = await walkFiles(runtimeRoot);
  const copied = [];

  for (const file of files) {
    if (!runtimeExtensions.has(path.extname(file).toLowerCase())) continue;

    const rel = path.relative(runtimeRoot, file);
    const destRel = path.join('vendor', 'materialx-runtime', rel);
    await copyIfChanged(file, path.join(outdir, destRel));
    copied.push(destRel);
  }

  return copied.sort();
}

async function copyNagaRuntime(root, outdir) {
  const runtimeRoot = resolveNagaRuntimeRoot(root);
  await Promise.all(requiredNagaRuntimeFiles.map(async (filename) => {
    const runtimeFile = path.join(runtimeRoot, filename);
    if (!await exists(runtimeFile)) {
      throw new Error(`Missing @graysonlang/naga runtime file: ${filename}. Run \`npm install\` to restore the runtime package.`);
    }
  }));

  const files = await walkFiles(runtimeRoot);
  const copied = [];

  for (const file of files) {
    if (!nagaRuntimeExtensions.has(path.extname(file).toLowerCase())) continue;

    const rel = path.relative(runtimeRoot, file);
    const destRel = path.join('vendor', 'naga-runtime', rel);
    await copyIfChanged(file, path.join(outdir, destRel));
    copied.push(destRel);
  }

  return copied.sort();
}

async function copyViewerAssets(root, outdir) {
  if (!await directoryExists(path.join(root, materialXViewerAssetRoot))) {
    throw new Error(missingMaterialXAssetsMessage(materialXViewerAssetRoot));
  }

  const files = await walkFiles(path.join(root, materialXViewerAssetRoot));
  const copied = [];

  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.svg') continue;

    const rel = path.relative(root, file);
    await copyIfChanged(file, path.join(outdir, rel));
    copied.push(rel);
  }

  return copied.sort();
}

async function copyNagaShaderAssets(root, outdir) {
  const absoluteSrcRoot = path.join(root, nagaShaderRoot);
  if (!await directoryExists(absoluteSrcRoot)) return [];

  const files = await walkFiles(absoluteSrcRoot);
  const copied = [];

  for (const file of files) {
    if (!nagaShaderExtensions.has(path.extname(file).toLowerCase())) continue;

    const rel = path.relative(absoluteSrcRoot, file);
    const destRel = path.join('vendor', 'naga-materialx', rel);
    await copyIfChanged(file, path.join(outdir, destRel));
    copied.push(destRel);
  }

  return copied.sort();
}

export async function prepareStaticAssets({
  root = process.cwd(),
  outdir = path.join(root, 'dist'),
} = {}) {
  await mkdir(outdir, { recursive: true });

  await Promise.all([
    rm(path.join(outdir, 'asset-manifest.json'), { force: true }),
    rm(path.join(outdir, 'assets'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'materialx-runtime'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'naga-runtime'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'naga-materialx'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'MaterialX', 'resources'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'MaterialX', 'javascript', 'MaterialXView', 'public'), { recursive: true, force: true }),
  ]);

  const [
    imagePaths,
    materialXPathPaths,
    materialXResourcePaths,
    materialXViewerAssetPaths,
    nagaRuntimePaths,
    nagaShaderPaths,
  ] = await Promise.all([
    copyMatching(root, outdir, 'assets', imageExtensions),
    copyMaterialXRuntime(root, outdir),
    copyMatching(root, outdir, materialXResourceRoot, materialXResourceExtensions, { required: true }),
    copyViewerAssets(root, outdir),
    copyNagaRuntime(root, outdir),
    copyNagaShaderAssets(root, outdir),
  ]);

  const manifest = {
    imagePaths,
    materialXPathPaths,
    materialXResourcePaths,
    materialXViewerAssetPaths,
    nagaRuntimePaths,
    nagaShaderPaths,
  };

  await writeFile(
    path.join(outdir, 'asset-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = await prepareStaticAssets();
  console.log(`Prepared ${manifest.materialXResourcePaths.length} MaterialX resources.`);
}
