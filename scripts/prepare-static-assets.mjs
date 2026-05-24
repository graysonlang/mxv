import { mkdir, readdir, rm, stat, copyFile, writeFile } from 'node:fs/promises';
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

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
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

async function copyMatching(root, outdir, srcRoot, extensionSet) {
  const absoluteSrcRoot = path.join(root, srcRoot);
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

async function copyViewerAssets(root, outdir) {
  const srcRoot = 'vendor/MaterialX/javascript/MaterialXView/public';
  const files = await walkFiles(path.join(root, srcRoot));
  const copied = [];

  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.svg') continue;

    const rel = path.relative(root, file);
    await copyIfChanged(file, path.join(outdir, rel));
    copied.push(rel);
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
    rm(path.join(outdir, 'vendor', 'MaterialX', 'resources'), { recursive: true, force: true }),
    rm(path.join(outdir, 'vendor', 'MaterialX', 'javascript', 'MaterialXView', 'public'), { recursive: true, force: true }),
  ]);

  const [
    imagePaths,
    materialXPathPaths,
    materialXResourcePaths,
    materialXViewerAssetPaths,
  ] = await Promise.all([
    copyMatching(root, outdir, 'assets', imageExtensions),
    copyMatching(root, outdir, 'vendor/materialx-runtime', runtimeExtensions),
    copyMatching(root, outdir, 'vendor/MaterialX/resources', materialXResourceExtensions),
    copyViewerAssets(root, outdir),
  ]);

  const manifest = {
    imagePaths,
    materialXPathPaths,
    materialXResourcePaths,
    materialXViewerAssetPaths,
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
