import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, 'vendor', 'materialx-runtime');
const runtimeLoader = path.join(runtimeDir, 'JsMaterialXGenShader.js');

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

const materialSamples = {
  standard: `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_standard" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <input name="diffuse_roughness" type="float" value="0.2" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="0.2" />
    <input name="specular_IOR" type="float" value="1.5" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="MAT_standard" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_standard" />
  </surfacematerial>
</materialx>`,
  pearl: `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_pearl" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.965, 0.945, 0.902" />
    <input name="diffuse_roughness" type="float" value="0.180" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="0.969, 0.957, 1.000" />
    <input name="specular_roughness" type="float" value="0.180" />
    <input name="specular_IOR" type="float" value="1.520" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0.080" />
    <input name="transmission_color" type="color3" value="1.000, 0.973, 0.906" />
    <input name="subsurface" type="float" value="0.380" />
    <input name="subsurface_color" type="color3" value="1.000, 0.941, 0.847" />
    <input name="subsurface_radius" type="color3" value="1.000, 0.851, 0.749" />
    <input name="subsurface_scale" type="float" value="0.420" />
    <input name="sheen" type="float" value="0.220" />
    <input name="sheen_color" type="color3" value="0.812, 0.847, 1.000" />
    <input name="sheen_roughness" type="float" value="0.380" />
    <input name="coat" type="float" value="0.920" />
    <input name="coat_color" type="color3" value="0.973, 0.984, 1.000" />
    <input name="coat_roughness" type="float" value="0.060" />
    <input name="coat_IOR" type="float" value="1.620" />
    <input name="coat_affect_color" type="float" value="0.350" />
    <input name="coat_affect_roughness" type="float" value="0.180" />
    <input name="thin_film_thickness" type="float" value="520.000" />
    <input name="thin_film_IOR" type="float" value="1.420" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="MAT_pearl" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_pearl" />
  </surfacematerial>
</materialx>`,
};

const sampleName = args.get('sample') || 'pearl';
const asJson = args.has('json');

if (!existsSync(runtimeLoader)) {
  console.error(`Missing ${path.relative(root, runtimeLoader)}. Run \`npm run build:wasm\` first.`);
  process.exit(1);
}

if (!materialSamples[sampleName]) {
  console.error(`Unknown sample "${sampleName}". Expected one of: ${Object.keys(materialSamples).join(', ')}.`);
  process.exit(1);
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

function inspectSource(source) {
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

async function generateShader(mx, generatorClassName, materialx) {
  if (!mx[generatorClassName]) {
    return {
      available: false,
      generatorClassName,
    };
  }

  const document = mx.createDocument();
  await mx.readFromXmlString(document, materialx);

  const generator = mx[generatorClassName].create();
  const context = new mx.GenContext(generator);
  const standardLibraries = mx.loadStandardLibraries(context);
  document.importLibrary(standardLibraries);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error('No renderable MaterialX element found.');
  }

  context.getOptions().shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;
  const shader = generator.generate(element.getNamePath(), element, context);
  const vertex = shader.getSourceCode('vertex');
  const pixel = shader.getSourceCode('pixel');

  return {
    available: true,
    generatorClassName,
    renderable: element.getNamePath(),
    target: typeof generator.getTarget === 'function' ? generator.getTarget() : null,
    stages: {
      pixel: inspectSource(pixel),
      vertex: inspectSource(vertex),
    },
  };
}

function summarize(result) {
  const wgsl = result.generators.wgsl;
  if (!wgsl.available) {
    return 'WgslShaderGenerator is not available in this runtime.';
  }

  const classifications = Object.values(wgsl.stages).map(stage => stage.classification);
  if (classifications.every(classification => classification === 'wgsl-like')) {
    return 'WgslShaderGenerator emits WGSL-like browser shader source.';
  }

  if (classifications.every(classification => classification === 'vulkan-glsl-like')) {
    return 'WgslShaderGenerator is available, but this runtime emits Vulkan-style GLSL, not browser WGSL.';
  }

  return `WgslShaderGenerator emitted mixed or unknown shader syntax: ${classifications.join(', ')}.`;
}

function printText(result) {
  console.log(`MaterialX runtime: ${result.materialxVersion}`);
  console.log(`Sample: ${result.sample}`);
  console.log('');

  for (const [name, generator] of Object.entries(result.generators)) {
    console.log(`${name}: ${generator.available ? 'available' : 'missing'}`);
    if (!generator.available) continue;
    console.log(`  class: ${generator.generatorClassName}`);
    console.log(`  target: ${generator.target || '-'}`);
    console.log(`  renderable: ${generator.renderable}`);
    for (const [stage, inspection] of Object.entries(generator.stages)) {
      console.log(`  ${stage}: ${inspection.classification}`);
      console.log(`    first line: ${inspection.firstNonEmptyLine}`);
      console.log(`    lines: ${inspection.lines}`);
      console.log(`    bytes: ${inspection.bytes}`);
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
const materialx = materialSamples[sampleName];
const generators = {
  essl: await generateShader(mx, 'EsslShaderGenerator', materialx),
  wgsl: await generateShader(mx, 'WgslShaderGenerator', materialx),
};
const result = {
  conclusion: '',
  generators,
  materialxVersion: mx.getVersionString(),
  sample: sampleName,
  warnings,
};
result.conclusion = summarize(result);

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}
