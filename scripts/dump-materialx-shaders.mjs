import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materialSamples } from './materialx-samples.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const materialXPackageJson = requireFromRoot.resolve('@graysonlang/mx/package.json');
const packageRoot = path.dirname(materialXPackageJson);
const runtimeDir = path.join(packageRoot, 'dist', 'runtime');
const runtimeLoader = path.join(runtimeDir, 'JsMaterialXGenShader.js');
const runtimeMetadataPath = path.join(runtimeDir, 'metadata.json');
const stageNames = ['vertex', 'pixel'];
const generatorMap = {
  essl: 'EsslShaderGenerator',
  glsl: 'GlslShaderGenerator',
  vk: 'VkShaderGenerator',
  wgsl: 'WgslShaderGenerator',
};

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

const outputRoot = path.resolve(root, args.get('out') || 'vendor/.cache/materialx-shaders');
const interfaceMode = args.get('interface') || 'complete';
const materialPath = args.get('material');
const searchPath = args.get('search-path') || 'vendor/MaterialX/resources';
const lightRigPath = args.get('light-rig') === 'none'
  ? null
  : args.get('light-rig') || 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.mtlx';

if (!existsSync(runtimeLoader)) {
  console.error(`Missing ${path.relative(root, runtimeLoader)}. Rebuild or reinstall @graysonlang/mx.`);
  process.exit(1);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseList(value, defaultItems) {
  if (!value || value === true) return defaultItems;
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function expandChoices(value, defaultItems, allItems) {
  const choices = parseList(value, defaultItems);
  if (choices.includes('all')) return allItems;
  return choices;
}

function sanitizeId(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function locateRuntimeFile(file) {
  return path.join(runtimeDir, file);
}

async function loadMaterialX() {
  const warnings = [];
  const { default: createMaterialX } = await import(pathToFileURL(runtimeLoader).href);
  const mx = await createMaterialX({
    locateFile: locateRuntimeFile,
    printErr: value => warnings.push(String(value)),
  });
  return { mx, warnings };
}

function setInterfaceMode(mx, options, mode) {
  if (mode === 'complete') {
    options.shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;
    return;
  }
  if (mode === 'reduced') {
    options.shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_REDUCED;
    return;
  }
  throw new Error(`Unsupported interface mode "${mode}". Expected complete or reduced.`);
}

function inspectSyntax(source) {
  const firstNonEmptyLine = source.split('\n').find(line => line.trim())?.trim() || '';
  const syntax = {
    glslLayoutQualifiers: /\blayout\s*\(/.test(source),
    glslMain: /\bvoid\s+main\s*\(/.test(source),
    pragmaShaderStage: /#pragma\s+shader_stage/.test(source),
    versionDirective: /^#version\b/m.test(source),
    wgslAttributes: /@(vertex|fragment|group|binding)\b/.test(source),
    wgslMain: /\bfn\s+main\b/.test(source),
  };

  let classification = 'unknown';
  if (syntax.wgslAttributes || syntax.wgslMain) {
    classification = 'wgsl-like';
  } else if (syntax.versionDirective && syntax.pragmaShaderStage) {
    classification = 'vulkan-glsl-like';
  } else if (syntax.versionDirective || syntax.glslMain) {
    classification = 'glsl-like';
  }

  return {
    bytes: new TextEncoder().encode(source).byteLength,
    classification,
    firstNonEmptyLine,
    lines: source.split('\n').length,
    syntax,
  };
}

function uniqueLines(lines) {
  return [...new Set(lines.map(line => line.trim()).filter(Boolean))];
}

function inspectDeclarations(source) {
  const lines = source.split('\n');
  return {
    entryPoints: uniqueLines(lines.filter(line => /#pragma\s+shader_stage|\bvoid\s+main\s*\(|@(vertex|fragment)\b|\bfn\s+main\b/.test(line))),
    layoutBindings: uniqueLines(lines.filter(line => /\blayout\s*\([^)]*\bbinding\s*=\s*\d+/.test(line))),
    layoutLocations: uniqueLines(lines.filter(line => /\blayout\s*\([^)]*\blocation\s*=\s*\d+/.test(line))),
    plainUniforms: uniqueLines(lines.filter(line => /^\s*uniform\b/.test(line))),
    wgslBindings: uniqueLines(lines.filter(line => /@(group|binding)\b/.test(line))),
  };
}

function inspectUniformBlocks(shader, stageName) {
  const blocks = shader.getStage(stageName).getUniformBlocks();
  const result = {};

  for (const [blockName, block] of Object.entries(blocks || {})) {
    const ports = [];
    const size = typeof block.size === 'function' ? block.size() : 0;
    for (let index = 0; index < size; index++) {
      const port = block.get(index);
      const value = port.getValue?.();
      ports.push({
        index,
        path: port.getPath?.() || '',
        type: port.getType?.()?.getName?.() || '',
        value: value?.getValueString?.() || '',
        variable: port.getVariable?.() || '',
      });
    }
    result[blockName] = {
      count: ports.length,
      ports,
    };
  }

  return result;
}

function sourceExtension(sourceInfo) {
  if (sourceInfo.classification === 'wgsl-like') return 'wgsl';
  return 'glsl';
}

async function loadSampleDocument(mx, sample) {
  const document = mx.createDocument();
  if (sample.materialPath) {
    await mx.readFromXmlFile(document, sample.materialPath, sample.searchPath);
  } else {
    await mx.readFromXmlString(document, sample.materialx);
  }
  return document;
}

function findMaterialXLights(document) {
  const lights = [];
  for (const node of document.getNodes()) {
    if (node.getType?.() === 'lightshader') {
      lights.push(node);
    }
  }
  return lights;
}

function getMaterialXVector(valueElement) {
  const data = valueElement?.getValue?.()?.getData?.();
  if (!data) return null;
  if (typeof data.data === 'function') return Array.from(data.data()).slice(0, 3);
  if (Array.isArray(data)) return data.slice(0, 3);
  return null;
}

function getMaterialXFloat(valueElement, fallback = 0) {
  const data = valueElement?.getValue?.()?.getData?.();
  return Number.isFinite(Number(data)) ? Number(data) : fallback;
}

async function applyLightRig(mx, document, context) {
  if (!lightRigPath) return [];
  if (!mx.HwShaderGenerator) {
    throw new Error('MaterialX runtime does not expose HwShaderGenerator light registration.');
  }

  const lightDocument = mx.createDocument();
  await mx.readFromXmlFile(lightDocument, lightRigPath, searchPath);
  document.importLibrary(lightDocument);

  mx.HwShaderGenerator.unbindLightShaders(context);
  const lightTypeIds = new Map();
  const lightData = [];
  let nextLightTypeId = 1;

  for (const light of findMaterialXLights(document)) {
    const nodeDef = light.getNodeDef?.();
    const nodeDefName = nodeDef?.getName?.();
    if (!nodeDef || !nodeDefName) continue;

    if (!lightTypeIds.has(nodeDefName)) {
      lightTypeIds.set(nodeDefName, nextLightTypeId);
      mx.HwShaderGenerator.bindLightShader(nodeDef, nextLightTypeId, context);
      nextLightTypeId++;
    }

    lightData.push({
      color: getMaterialXVector(light.getValueElement('color')) || [1, 1, 1],
      direction: getMaterialXVector(light.getValueElement('direction')) || [0, -1, 0],
      intensity: getMaterialXFloat(light.getValueElement('intensity'), 1),
      type: lightTypeIds.get(nodeDefName),
    });
  }

  context.getOptions().hwMaxActiveLightSources = Math.max(
    context.getOptions().hwMaxActiveLightSources,
    lightData.length,
  );

  return lightData;
}

async function generateShader(mx, sample, generatorId, mode) {
  const generatorClassName = generatorMap[generatorId];
  if (!generatorClassName) {
    throw new Error(`Unsupported generator "${generatorId}". Expected one of: ${Object.keys(generatorMap).join(', ')}, all.`);
  }
  if (typeof mx[generatorClassName]?.create !== 'function') {
    return {
      available: false,
      generatorClassName,
      generatorId,
      interfaceMode: mode,
    };
  }

  const document = await loadSampleDocument(mx, sample);
  const generator = mx[generatorClassName].create();
  const context = new mx.GenContext(generator);
  const libraries = mx.loadStandardLibraries(context);
  document.importLibrary(libraries);
  setInterfaceMode(mx, context.getOptions(), mode);
  const lightData = await applyLightRig(mx, document, context);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error(`No renderable MaterialX element found for sample "${sample.id}".`);
  }

  const shader = generator.generate(element.getNamePath(), element, context);
  const stages = {};
  for (const stageName of stageNames) {
    const source = shader.getSourceCode(stageName);
    const sourceInfo = inspectSyntax(source);
    stages[stageName] = {
      declarations: inspectDeclarations(source),
      source,
      sourceInfo,
      uniformBlocks: inspectUniformBlocks(shader, stageName),
    };
  }

  return {
    available: true,
    generatorClassName,
    generatorId,
    interfaceMode: mode,
    lightData,
    lightRig: lightRigPath,
    renderable: element.getNamePath(),
    stages,
    target: typeof generator.getTarget === 'function' ? generator.getTarget() : null,
  };
}

function getSamples() {
  if (materialPath) {
    const absoluteMaterialPath = path.resolve(root, materialPath);
    const ext = path.extname(absoluteMaterialPath);
    const id = sanitizeId(args.get('name') || path.basename(absoluteMaterialPath, ext));
    return [
      {
        id,
        materialPath: absoluteMaterialPath,
        materialx: readFileSync(absoluteMaterialPath, 'utf8'),
        searchPath,
      },
    ];
  }

  const sampleIds = expandChoices(args.get('sample'), ['all'], Object.keys(materialSamples));
  for (const sampleId of sampleIds) {
    if (!Object.hasOwn(materialSamples, sampleId)) {
      throw new Error(`Unknown sample "${sampleId}". Expected one of: ${Object.keys(materialSamples).join(', ')}, all.`);
    }
  }

  return sampleIds.map(sampleId => ({
    id: sampleId,
    materialPath: null,
    materialx: materialSamples[sampleId],
    searchPath: null,
  }));
}

function getGenerators() {
  return expandChoices(args.get('generator'), ['wgsl'], Object.keys(generatorMap));
}

function getInterfaceModes() {
  return expandChoices(interfaceMode, ['complete'], ['complete', 'reduced']);
}

function getPackageInfo() {
  const packageJson = readJson(materialXPackageJson);
  return {
    name: packageJson?.name || '@graysonlang/mx',
    path: path.relative(root, packageRoot),
    version: packageJson?.version || null,
  };
}

async function writeShaderDump(mx) {
  if (args.has('clean')) {
    await rm(outputRoot, { force: true, recursive: true });
  }
  await mkdir(outputRoot, { recursive: true });

  const samples = getSamples();
  const generators = getGenerators();
  const interfaceModes = getInterfaceModes();
  const manifest = {
    generatedAt: new Date().toISOString(),
    generators,
    interfaceModes,
    materialxVersion: mx.getVersionString(),
    metadata: readJson(runtimeMetadataPath),
    outdir: path.relative(root, outputRoot),
    package: getPackageInfo(),
    samples: [],
  };

  for (const sample of samples) {
    const sampleDir = path.join(outputRoot, sample.id);
    await mkdir(sampleDir, { recursive: true });
    const materialFile = path.join(sampleDir, 'material.mtlx');
    await writeFile(materialFile, `${sample.materialx.trim()}\n`);

    const sampleReport = {
      id: sample.id,
      materialFile: path.relative(root, materialFile),
      materialPath: sample.materialPath ? path.relative(root, sample.materialPath) : null,
      outputs: [],
    };

    for (const generatorId of generators) {
      for (const mode of interfaceModes) {
        const report = await generateShader(mx, sample, generatorId, mode);
        if (!report.available) {
          sampleReport.outputs.push(report);
          continue;
        }

        const output = {
          generatorClassName: report.generatorClassName,
          generatorId,
          interfaceMode: mode,
          lightData: report.lightData,
          lightRig: report.lightRig ? path.relative(root, path.resolve(root, report.lightRig)) : null,
          renderable: report.renderable,
          stages: {},
          target: report.target,
        };

        for (const stageName of stageNames) {
          const stage = report.stages[stageName];
          const ext = sourceExtension(stage.sourceInfo);
          const filename = `${generatorId}-${mode}.${stageName}.${ext}`;
          const filePath = path.join(sampleDir, filename);
          await writeFile(filePath, stage.source);
          output.stages[stageName] = {
            declarations: stage.declarations,
            file: path.relative(root, filePath),
            source: stage.sourceInfo,
            uniformBlocks: stage.uniformBlocks,
          };
        }

        sampleReport.outputs.push(output);
      }
    }

    manifest.samples.push(sampleReport);
  }

  const manifestPath = path.join(outputRoot, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function printSummary(manifest, warnings) {
  console.log(`Dumped MaterialX shaders to ${manifest.outdir}`);
  console.log(`  runtime: ${manifest.materialxVersion}`);
  if (manifest.metadata) {
    console.log(`  upstream: ${manifest.metadata.materialxRef} ${manifest.metadata.materialxCommit}`);
  }
  for (const sample of manifest.samples) {
    const files = sample.outputs
      .filter(output => output.available !== false)
      .flatMap(output => Object.values(output.stages).map(stage => stage.file));
    console.log(`  ${sample.id}: ${files.length} shader files`);
    for (const file of files) {
      console.log(`    ${file}`);
    }
  }
  if (warnings.length) {
    console.log(`  warnings: ${warnings.length}`);
    for (const warning of warnings) {
      console.log(`    ${warning}`);
    }
  }
}

const { mx, warnings } = await loadMaterialX();
const manifest = await writeShaderDump(mx);
printSummary(manifest, warnings);
