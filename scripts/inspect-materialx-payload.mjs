import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
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

const generatorNames = [
  'EsslShaderGenerator',
  'GlslShaderGenerator',
  'VkShaderGenerator',
  'WgslShaderGenerator',
  'MslShaderGenerator',
  'OslShaderGenerator',
  'MdlShaderGenerator',
  'SlangShaderGenerator',
];
const enumNames = [
  'ShaderInterfaceType',
  'HwSpecularEnvironmentMethod',
  'HwDirectionalAlbedoMethod',
];
const enumOptionNames = {
  hwDirectionalAlbedoMethod: 'HwDirectionalAlbedoMethod',
  hwSpecularEnvironmentMethod: 'HwSpecularEnvironmentMethod',
  shaderInterfaceType: 'ShaderInterfaceType',
};
const stageNames = ['vertex', 'pixel'];
const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

const asJson = args.has('json');
const sampleName = args.get('sample') || 'pearl';
const materialPath = args.get('material');
const searchPath = args.get('search-path') || 'vendor/MaterialX/resources';
const interfaceMode = args.get('interface') || 'complete';
const listLimit = Number(args.get('limit') || 12);

if (!existsSync(runtimeLoader)) {
  console.error(`Missing ${path.relative(root, runtimeLoader)}. Rebuild or reinstall @graysonlang/mx.`);
  process.exit(1);
}

if (!materialPath && !materialSamples[sampleName]) {
  console.error(`Unknown sample "${sampleName}". Expected one of: ${Object.keys(materialSamples).join(', ')}.`);
  process.exit(1);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getPackageInstallInfo() {
  const packageJson = readJson(materialXPackageJson);
  const relativePackageRoot = path.relative(root, packageRoot);
  const stat = lstatSync(packageRoot);
  const linked = stat.isSymbolicLink();
  return {
    linked,
    linkTarget: linked ? readlinkSync(packageRoot) : null,
    name: packageJson?.name || '@graysonlang/mx',
    path: relativePackageRoot,
    version: packageJson?.version || null,
  };
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

function enumMembers(mx, enumName) {
  const enumObject = mx[enumName];
  if (!enumObject) return [];
  return Object.keys(enumObject)
    .filter(key => !['argCount', 'values'].includes(key))
    .sort();
}

function enumValueName(mx, value, enumName) {
  const enumObject = mx[enumName];
  if (!enumObject) return null;
  return enumMembers(mx, enumName).find(key => enumObject[key] === value) || null;
}

function describeValue(mx, name, value) {
  const enumName = enumOptionNames[name];
  if (enumName) {
    return enumValueName(mx, value, enumName) || '<unknown enum value>';
  }

  if (value === null || value === undefined) return value;
  if (['boolean', 'number', 'string'].includes(typeof value)) return value;
  return String(value);
}

function getGenOptions(mx) {
  const generatorName = generatorNames.find(name => typeof mx[name]?.create === 'function');
  if (!generatorName) return { defaults: {}, errors: { generator: 'No shader generator is available.' } };

  const generator = mx[generatorName].create();
  const context = new mx.GenContext(generator);
  const options = context.getOptions();
  const defaults = {};
  const errors = {};
  const optionNames = Object.getOwnPropertyNames(mx.GenOptions.prototype)
    .filter(name => name !== 'constructor')
    .sort();

  for (const name of optionNames) {
    try {
      defaults[name] = describeValue(mx, name, options[name]);
    } catch (error) {
      errors[name] = error.message;
    }
  }

  return { defaults, errors };
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

async function loadMaterialDocument(mx) {
  const document = mx.createDocument();
  if (materialPath) {
    await mx.readFromXmlFile(document, materialPath, searchPath);
  } else {
    await mx.readFromXmlString(document, materialSamples[sampleName]);
  }
  return document;
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

async function generateReportForGenerator(mx, generatorName, mode) {
  if (typeof mx[generatorName]?.create !== 'function') {
    return {
      available: false,
      generatorName,
    };
  }

  const document = await loadMaterialDocument(mx);
  const generator = mx[generatorName].create();
  const context = new mx.GenContext(generator);
  const libraries = mx.loadStandardLibraries(context);
  document.importLibrary(libraries);
  setInterfaceMode(mx, context.getOptions(), mode);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error('No renderable MaterialX element found.');
  }

  const shader = generator.generate(element.getNamePath(), element, context);
  const stages = {};
  for (const stageName of stageNames) {
    const source = shader.getSourceCode(stageName);
    stages[stageName] = {
      declarations: inspectDeclarations(source),
      source: inspectSyntax(source),
      uniformBlocks: inspectUniformBlocks(shader, stageName),
    };
  }

  return {
    available: true,
    generatorName,
    interfaceMode: mode,
    renderable: element.getNamePath(),
    target: typeof generator.getTarget === 'function' ? generator.getTarget() : null,
    stages,
  };
}

function getInterfaceModes() {
  if (interfaceMode === 'both') return ['complete', 'reduced'];
  return [interfaceMode];
}

function summarize(result) {
  const wgslReports = Object.values(result.generators)
    .flat()
    .filter(report => report.available && report.generatorName === 'WgslShaderGenerator');
  if (!wgslReports.length) return 'WgslShaderGenerator is not available in this runtime.';

  const classifications = wgslReports.flatMap(report => Object.values(report.stages).map(stage => stage.source.classification));
  if (classifications.every(classification => classification === 'wgsl-like')) {
    return 'WgslShaderGenerator emits WGSL-like browser shader source.';
  }
  if (classifications.every(classification => classification === 'vulkan-glsl-like')) {
    return 'WgslShaderGenerator emits Vulkan-style GLSL with WebGPU-flavored texture/sampler declarations, not browser WGSL.';
  }
  return `WgslShaderGenerator emitted mixed or unknown shader syntax: ${classifications.join(', ')}.`;
}

function limitedList(items) {
  if (items.length <= listLimit) return items;
  return [...items.slice(0, listLimit), `... ${items.length - listLimit} more`];
}

function printDeclarations(declarations, indent) {
  for (const [name, items] of Object.entries(declarations)) {
    if (!items.length) continue;
    console.log(`${indent}${name}:`);
    for (const item of limitedList(items)) {
      console.log(`${indent}  ${item}`);
    }
  }
}

function printUniformBlocks(blocks, indent) {
  for (const [blockName, block] of Object.entries(blocks)) {
    console.log(`${indent}${blockName}: ${block.count} ports`);
    for (const port of limitedList(block.ports)) {
      if (typeof port === 'string') {
        console.log(`${indent}  ${port}`);
        continue;
      }
      const value = port.value ? ` = ${port.value}` : '';
      const pathSuffix = port.path ? ` (${port.path})` : '';
      console.log(`${indent}  ${port.variable}: ${port.type}${value}${pathSuffix}`);
    }
  }
}

function printText(result) {
  console.log('MaterialX payload');
  console.log(`  runtime: ${result.materialxVersion}`);
  console.log(`  package: ${result.package.name}@${result.package.version}`);
  console.log(`  package path: ${result.package.path}${result.package.linked ? ` -> ${result.package.linkTarget}` : ''}`);
  if (result.metadata) {
    console.log(`  upstream: ${result.metadata.materialxRef} ${result.metadata.materialxCommit}`);
  }
  console.log(`  sample: ${result.material.materialPath || result.material.sample}`);
  console.log('');

  console.log('Exposed generators');
  for (const generatorName of Object.keys(result.generatorAvailability)) {
    console.log(`  ${generatorName}: ${result.generatorAvailability[generatorName] ? 'available' : 'missing'}`);
  }
  console.log('');

  console.log('GenOptions defaults');
  for (const [name, value] of Object.entries(result.genOptions.defaults)) {
    console.log(`  ${name}: ${value}`);
  }
  for (const [name, message] of Object.entries(result.genOptions.errors)) {
    console.log(`  ${name}: <unreadable: ${message}>`);
  }
  console.log('');

  console.log('Enums');
  for (const [name, values] of Object.entries(result.enums)) {
    console.log(`  ${name}: ${values.join(', ') || '-'}`);
  }
  console.log('');

  console.log('Generator reports');
  for (const reports of Object.values(result.generators)) {
    for (const report of reports) {
      console.log(`${report.generatorName}: ${report.available ? 'available' : 'missing'}`);
      if (!report.available) continue;
      console.log(`  target: ${report.target || '-'}`);
      console.log(`  interface: ${report.interfaceMode}`);
      console.log(`  renderable: ${report.renderable}`);

      for (const [stageName, stage] of Object.entries(report.stages)) {
        console.log(`  ${stageName}: ${stage.source.classification}`);
        console.log(`    first line: ${stage.source.firstNonEmptyLine}`);
        console.log(`    lines: ${stage.source.lines}`);
        console.log(`    bytes: ${stage.source.bytes}`);
        printDeclarations(stage.declarations, '    ');
        console.log('    uniformBlocks:');
        printUniformBlocks(stage.uniformBlocks, '      ');
      }
    }
  }

  if (result.warnings.length) {
    console.log('');
    console.log(`Warnings captured: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`  ${warning}`);
    }
  }

  console.log('');
  console.log(`Conclusion: ${result.conclusion}`);
}

const { mx, warnings } = await loadMaterialX();
const metadata = readJson(runtimeMetadataPath);
const generatorAvailability = Object.fromEntries(
  generatorNames.map(name => [name, typeof mx[name]?.create === 'function']),
);
const enums = Object.fromEntries(enumNames.map(name => [name, enumMembers(mx, name)]));
const generators = {};
for (const generatorName of generatorNames) {
  generators[generatorName] = [];
  for (const mode of getInterfaceModes()) {
    generators[generatorName].push(await generateReportForGenerator(mx, generatorName, mode));
  }
}

const result = {
  conclusion: '',
  enums,
  genOptions: getGenOptions(mx),
  generatorAvailability,
  generators,
  material: {
    materialPath: materialPath || null,
    sample: materialPath ? null : sampleName,
    searchPath: materialPath ? searchPath : null,
  },
  materialxVersion: mx.getVersionString(),
  metadata,
  package: getPackageInstallInfo(),
  warnings,
};
result.conclusion = summarize(result);

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}
