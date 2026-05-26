// This import+export makes sure webgpu-direct.html is copied to dist and the
// import is not stripped out during bundling.
import index from './webgpu-direct.html';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { translateMaterialXFragmentGlsl } from '../src/materialx-glsl-translator.js';
import { materialSamples as materialSampleSources } from '../src/materialx-samples.js';

export function getFilePaths() {
  return { index };
}

const defaultGeometry = 'vendor/MaterialX/resources/Geometry/shaderball.glb';
const defaultEnvironment = 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.hdr';
const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);
const nagaShaderBaseUrl = new URL('./vendor/naga-materialx/', import.meta.url);
const appStartTime = performance.now();
const cameraFov = 60 * Math.PI / 180;
const cameraNear = 0.05;
const cameraFar = 100;
const sphereRadius = 0.8;
const initialDistance = sphereRadius * 2;
const maxPixelRatio = 2;
const depthFormat = 'depth24plus';
const queryParams = new URLSearchParams(document.location.search);
const shaderModeLabels = {
  bridge: 'Bridge',
  naga: 'Naga WGSL',
};
const requestedShaderMode = queryParams.get('shader') || queryParams.get('shaderMode');
let activeShaderMode = Object.hasOwn(shaderModeLabels, requestedShaderMode) ? requestedShaderMode : 'bridge';
const defaultEnvRadianceSamples = Number(queryParams.get('envSamples') || queryParams.get('samples') || 4);
const defaultEnvLightIntensity = Number(queryParams.get('envIntensity') || 1);
let envRadianceSamples = Number.isFinite(defaultEnvRadianceSamples)
  ? Math.max(0, Math.min(16, Math.round(defaultEnvRadianceSamples)))
  : 4;
let envLightIntensity = Number.isFinite(defaultEnvLightIntensity)
  ? Math.max(0, Math.min(8, defaultEnvLightIntensity))
  : 1;
const privateVertexFloatCount = 48;
const privatePixelByteLength = 96;
const lightDataFloatCount = 4;
const materialXBoolUniformWarning = 'WGSL does not allow boolean types to be stored in uniform or storage address spaces.';
const materialXKnownWarnings = new Set();
const webGpuErrors = [];
if (typeof window !== 'undefined') {
  window.__mxvWebGpuErrors = webGpuErrors;
}
const requestedEnvironment = queryParams.get('environment') || queryParams.get('env') || defaultEnvironment;

const materialPortIndex = {
  base: 0,
  baseColor: 1,
  diffuseRoughness: 2,
  metalness: 3,
  specular: 4,
  specularColor: 5,
  specularRoughness: 6,
  specularIor: 7,
  specularAnisotropy: 8,
  specularRotation: 9,
  transmission: 10,
  transmissionColor: 11,
  transmissionDepth: 12,
  transmissionScatter: 13,
  transmissionScatterAnisotropy: 14,
  transmissionDispersion: 15,
  transmissionExtraRoughness: 16,
  subsurface: 17,
  subsurfaceColor: 18,
  subsurfaceRadius: 19,
  subsurfaceScale: 20,
  subsurfaceAnisotropy: 21,
  sheen: 22,
  sheenColor: 23,
  sheenRoughness: 24,
  coat: 25,
  coatColor: 26,
  coatRoughness: 27,
  coatAnisotropy: 28,
  coatRotation: 29,
  coatIor: 30,
  coatAffectColor: 31,
  coatAffectRoughness: 32,
  thinFilmThickness: 33,
  thinFilmIor: 34,
  emission: 35,
  emissionColor: 36,
  opacity: 37,
  thinWalled: 38,
};

const materialPortTypes = {
  base: 'float',
  baseColor: 'color3',
  diffuseRoughness: 'float',
  metalness: 'float',
  specular: 'float',
  specularColor: 'color3',
  specularRoughness: 'float',
  specularIor: 'float',
  specularAnisotropy: 'float',
  specularRotation: 'float',
  transmission: 'float',
  transmissionColor: 'color3',
  transmissionDepth: 'float',
  transmissionScatter: 'color3',
  transmissionScatterAnisotropy: 'float',
  transmissionDispersion: 'float',
  transmissionExtraRoughness: 'float',
  subsurface: 'float',
  subsurfaceColor: 'color3',
  subsurfaceRadius: 'color3',
  subsurfaceScale: 'float',
  subsurfaceAnisotropy: 'float',
  sheen: 'float',
  sheenColor: 'color3',
  sheenRoughness: 'float',
  coat: 'float',
  coatColor: 'color3',
  coatRoughness: 'float',
  coatAnisotropy: 'float',
  coatRotation: 'float',
  coatIor: 'float',
  coatAffectColor: 'float',
  coatAffectRoughness: 'float',
  thinFilmThickness: 'float',
  thinFilmIor: 'float',
  emission: 'float',
  emissionColor: 'color3',
  opacity: 'color3',
  thinWalled: 'integer',
};

const materialPortFields = {
  base: 'base',
  baseColor: 'base_color',
  diffuseRoughness: 'diffuse_roughness',
  metalness: 'metalness',
  specular: 'specular',
  specularColor: 'specular_color',
  specularRoughness: 'specular_roughness',
  specularIor: 'specular_IOR',
  specularAnisotropy: 'specular_anisotropy',
  specularRotation: 'specular_rotation',
  transmission: 'transmission',
  transmissionColor: 'transmission_color',
  transmissionDepth: 'transmission_depth',
  transmissionScatter: 'transmission_scatter',
  transmissionScatterAnisotropy: 'transmission_scatter_anisotropy',
  transmissionDispersion: 'transmission_dispersion',
  transmissionExtraRoughness: 'transmission_extra_roughness',
  subsurface: 'subsurface',
  subsurfaceColor: 'subsurface_color',
  subsurfaceRadius: 'subsurface_radius',
  subsurfaceScale: 'subsurface_scale',
  subsurfaceAnisotropy: 'subsurface_anisotropy',
  sheen: 'sheen',
  sheenColor: 'sheen_color',
  sheenRoughness: 'sheen_roughness',
  coat: 'coat',
  coatColor: 'coat_color',
  coatRoughness: 'coat_roughness',
  coatAnisotropy: 'coat_anisotropy',
  coatRotation: 'coat_rotation',
  coatIor: 'coat_IOR',
  coatAffectColor: 'coat_affect_color',
  coatAffectRoughness: 'coat_affect_roughness',
  thinFilmThickness: 'thin_film_thickness',
  thinFilmIor: 'thin_film_IOR',
  emission: 'emission',
  emissionColor: 'emission_color',
  opacity: 'opacity',
  thinWalled: 'thin_walled',
};

const materialVariableAliases = {
  base_color: 'baseColor',
  coat_IOR: 'coatIor',
  coat_affect_color: 'coatAffectColor',
  coat_affect_roughness: 'coatAffectRoughness',
  coat_anisotropy: 'coatAnisotropy',
  coat_color: 'coatColor',
  coat_roughness: 'coatRoughness',
  coat_rotation: 'coatRotation',
  diffuse_roughness: 'diffuseRoughness',
  emission_color: 'emissionColor',
  sheen_color: 'sheenColor',
  sheen_roughness: 'sheenRoughness',
  specular_IOR: 'specularIor',
  specular_anisotropy: 'specularAnisotropy',
  specular_color: 'specularColor',
  specular_roughness: 'specularRoughness',
  specular_rotation: 'specularRotation',
  subsurface_anisotropy: 'subsurfaceAnisotropy',
  subsurface_color: 'subsurfaceColor',
  subsurface_radius: 'subsurfaceRadius',
  subsurface_scale: 'subsurfaceScale',
  thin_film_IOR: 'thinFilmIor',
  thin_film_thickness: 'thinFilmThickness',
  thin_walled: 'thinWalled',
  transmission_color: 'transmissionColor',
  transmission_depth: 'transmissionDepth',
  transmission_dispersion: 'transmissionDispersion',
  transmission_extra_roughness: 'transmissionExtraRoughness',
  transmission_scatter: 'transmissionScatter',
  transmission_scatter_anisotropy: 'transmissionScatterAnisotropy',
};

const materialUniformLayout = createMaterialUniformLayout();
const publicUniformByteLength = materialUniformLayout.byteLength;
const publicUniformStructSource = createPublicUniformStructSource();
const materialAccessorSource = createMaterialAccessorSource();
const generatedStandardSurfaceFunctionName = 'NG_standard_surface_surfaceshader_100';
const portedGeneratedPixelHelpers = [
  'mx_square',
  'mx_pow5',
  'mx_ior_to_f0',
  'mx_fresnel_schlick',
  'mx_average_alpha',
  'mx_ggx_NDF',
  'mx_ggx_smith_G1',
  'mx_ggx_smith_G2',
  'mx_luminance_color3',
  'mx_oren_nayar_diffuse',
  'mx_roughness_anisotropy',
  'mx_rotate_vector3',
  'numActiveLightSources',
  'sampleLightSource',
];
const privatePixelUniformPorts = [
  { type: 'matrix44', variable: 'u_envMatrix' },
  { type: 'float', variable: 'u_envLightIntensity' },
  { type: 'integer', variable: 'u_envRadianceMips' },
  { type: 'integer', variable: 'u_envRadianceSamples' },
  { type: 'integer', variable: 'u_refractionTwoSided' },
  { type: 'vector3', variable: 'u_viewPosition' },
  { type: 'integer', variable: 'u_numActiveLightSources' },
];
const privatePixelTexturePorts = new Set(['u_envRadiance', 'u_envIrradiance']);
const generatedPixelMainArguments = [
  ...materialUniformLayout.ports
    .slice(0, materialPortIndex.coatAffectColor)
    .map(port => port.field),
  'geomprop_Nworld_out',
  ...materialUniformLayout.ports
    .slice(materialPortIndex.coatAffectColor)
    .map(port => port.field),
  'geomprop_Nworld_out',
  'geomprop_Tworld_out',
  'SR_standard_out',
];
const generatedPixelFunctionParameters = [
  ...materialUniformLayout.ports
    .slice(0, materialPortIndex.coatAffectColor)
    .map(port => port.field),
  'coat_normal',
  ...materialUniformLayout.ports
    .slice(materialPortIndex.coatAffectColor)
    .map(port => port.field),
  'normal',
  'tangent',
  'out1',
];
const standardSurfaceBridgeParameters = createStandardSurfaceBridgeParameters();
const standardSurfaceBridgeSource = createStandardSurfaceBridgeSource();
const fragmentBridgeMainSource = createFragmentBridgeMainSource();

const baseMaterialPorts = {
  base: 1,
  baseColor: [0.8, 0.8, 0.8],
  diffuseRoughness: 0.2,
  metalness: 0,
  specular: 1,
  specularColor: [1, 1, 1],
  specularRoughness: 0.2,
  specularIor: 1.5,
  specularAnisotropy: 0,
  specularRotation: 0,
  transmission: 0,
  transmissionColor: [1, 1, 1],
  transmissionDepth: 0,
  transmissionScatter: [0, 0, 0],
  transmissionScatterAnisotropy: 0,
  transmissionDispersion: 0,
  transmissionExtraRoughness: 0,
  subsurface: 0,
  subsurfaceColor: [1, 1, 1],
  subsurfaceRadius: [1, 1, 1],
  subsurfaceScale: 1,
  subsurfaceAnisotropy: 0,
  sheen: 0,
  sheenColor: [1, 1, 1],
  sheenRoughness: 0.3,
  coat: 0,
  coatColor: [1, 1, 1],
  coatRoughness: 0.1,
  coatAnisotropy: 0,
  coatRotation: 0,
  coatIor: 1.5,
  coatAffectColor: 0,
  coatAffectRoughness: 0,
  thinFilmThickness: 0,
  thinFilmIor: 1.5,
  emission: 0,
  emissionColor: [1, 1, 1],
  opacity: [1, 1, 1],
  thinWalled: 0,
};

const fallbackMaterialSamples = {
  standard: {
    label: 'Standard',
    ports: baseMaterialPorts,
  },
  pearl: {
    label: 'Pearl',
    ports: {
      ...baseMaterialPorts,
      baseColor: [0.965, 0.945, 0.902],
      coat: 0.92,
      coatAffectColor: 0.35,
      coatAffectRoughness: 0.18,
      coatColor: [0.973, 0.984, 1],
      coatIor: 1.62,
      coatRoughness: 0.06,
      diffuseRoughness: 0.18,
      sheen: 0.22,
      sheenColor: [0.812, 0.847, 1],
      sheenRoughness: 0.38,
      specularColor: [0.969, 0.957, 1],
      specularIor: 1.52,
      specularRoughness: 0.18,
      subsurface: 0.38,
      subsurfaceColor: [1, 0.941, 0.847],
      subsurfaceRadius: [1, 0.851, 0.749],
      subsurfaceScale: 0.42,
      thinFilmIor: 1.42,
      thinFilmThickness: 520,
      transmission: 0.08,
      transmissionColor: [1, 0.973, 0.906],
    },
  },
  brushedMetal: {
    label: 'Brushed Metal',
    ports: {
      ...baseMaterialPorts,
      baseColor: [0.76, 0.72, 0.65],
      coat: 0.18,
      coatRoughness: 0.12,
      diffuseRoughness: 0.45,
      metalness: 1,
      specularAnisotropy: 0.78,
      specularColor: [0.95, 0.9, 0.82],
      specularRotation: 0.16,
      specularRoughness: 0.28,
    },
  },
  carPaint: {
    label: 'Car Paint',
    ports: {
      ...baseMaterialPorts,
      base: 0.5,
      baseColor: [0.1037792, 0.59212029, 0.85064936],
      coat: 1,
      coatRoughness: 0,
      specular: 1,
      specularAnisotropy: 0.5,
      specularColor: [1, 1, 1],
      specularRoughness: 0.4,
    },
  },
  smokedGlass: {
    label: 'Smoked Glass',
    ports: {
      ...baseMaterialPorts,
      base: 0.12,
      baseColor: [0.28, 0.34, 0.38],
      coat: 0.15,
      coatRoughness: 0.02,
      diffuseRoughness: 0.05,
      opacity: [0.35, 0.42, 0.5],
      specular: 0.85,
      specularColor: [0.9, 0.96, 1],
      specularIor: 1.52,
      specularRoughness: 0.03,
      thinWalled: 1,
      transmission: 0.82,
      transmissionColor: [0.68, 0.86, 1],
      transmissionDepth: 0.35,
      transmissionExtraRoughness: 0.08,
      transmissionScatter: [0.05, 0.08, 0.1],
    },
  },
  emissivePlastic: {
    label: 'Emissive Plastic',
    ports: {
      ...baseMaterialPorts,
      base: 0.85,
      baseColor: [0.05, 0.08, 0.12],
      diffuseRoughness: 0.55,
      emission: 2.2,
      emissionColor: [0.2, 0.85, 1],
      specular: 0.35,
      specularColor: [0.8, 0.9, 1],
      specularRoughness: 0.45,
    },
  },
  coatedFabric: {
    label: 'Coated Fabric',
    ports: {
      ...baseMaterialPorts,
      base: 0.9,
      baseColor: [0.45, 0.07, 0.12],
      coat: 0.45,
      coatAffectColor: 0.3,
      coatAffectRoughness: 0.45,
      coatColor: [1, 0.85, 0.75],
      coatRoughness: 0.22,
      diffuseRoughness: 0.65,
      sheen: 0.65,
      sheenColor: [1, 0.42, 0.5],
      sheenRoughness: 0.55,
      specular: 0.65,
      specularColor: [1, 0.76, 0.82],
      specularRoughness: 0.45,
    },
  },
};
let materialSamples = createFallbackMaterialSamples();
const requestedMaterial = queryParams.get('material');
let activeMaterialId = Object.hasOwn(materialSamples, requestedMaterial) ? requestedMaterial : 'standard';
let pendingMaterialSwitch = null;
let materialSwitchId = 0;
let materialBenchmarkTimer = null;
const materialSwitchSamples = [];

const shaderSource = `
struct PrivateUniformsVertex {
  u_worldMatrix: mat4x4<f32>,
  u_viewProjectionMatrix: mat4x4<f32>,
  u_worldInverseTransposeMatrix: mat4x4<f32>,
};

struct PrivateUniformsPixel {
  u_envMatrix: mat4x4<f32>,
  u_envLightIntensity: f32,
  u_envRadianceMips: i32,
  u_envRadianceSamples: i32,
  u_refractionTwoSided: i32,
  u_viewPosition: vec3<f32>,
  u_numActiveLightSources: i32,
};

${publicUniformStructSource}

struct LightDataPixel {
  lightDirection: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u_vertex: PrivateUniformsVertex;
@group(0) @binding(1) var<uniform> u_privatePixel: PrivateUniformsPixel;
@group(0) @binding(2) var u_envRadianceTexture: texture_2d<f32>;
@group(0) @binding(3) var u_envRadianceSampler: sampler;
@group(0) @binding(4) var u_envIrradianceTexture: texture_2d<f32>;
@group(0) @binding(5) var u_envIrradianceSampler: sampler;
@group(0) @binding(6) var<uniform> u_public: PublicUniformsPixel;
@group(0) @binding(7) var<uniform> u_lightData: LightDataPixel;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPosition = u_vertex.u_worldMatrix * vec4<f32>(input.position, 1.0);
  output.clipPosition = u_vertex.u_viewProjectionMatrix * worldPosition;
  output.worldPosition = worldPosition.xyz;
  output.normal = normalize((u_vertex.u_worldInverseTransposeMatrix * vec4<f32>(input.normal, 0.0)).xyz);
  output.tangent = normalize((u_vertex.u_worldMatrix * vec4<f32>(input.tangent, 0.0)).xyz);
  return output;
}

fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

${materialAccessorSource}

${standardSurfaceBridgeSource}

${fragmentBridgeMainSource}
`;

const viewState = {
  distance: initialDistance,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  pitch: 0.12,
  yaw: 0.22,
};

function setText(selector, text) {
  const node = document.querySelector(selector);
  if (node) node.textContent = text;
}

function setStatus(text) {
  setText('[data-status]', text);
}

function setMetric(name, value) {
  setText(`[data-metric="${name}"]`, value);
}

function recordWebGpuError(scope, error) {
  const message = error?.message || String(error);
  webGpuErrors.push({
    message,
    scope,
  });
  setStatus('WebGPU error');
  setMetric('renderer', `${scope}: ${message}`);
  console.error(`[WebGPU] ${scope}: ${message}`, error);
}

function installWebGpuErrorReporting(device) {
  device.addEventListener('uncapturederror', (event) => {
    recordWebGpuError(event.error?.constructor?.name || 'uncaptured', event.error);
  });
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function getUniformTypeLayout(type) {
  if (type === 'color3' || type === 'vector3') {
    return {
      align: 16,
      size: 12,
      wgsl: 'vec3<f32>',
    };
  }

  if (type === 'integer') {
    return {
      align: 4,
      size: 4,
      wgsl: 'i32',
    };
  }

  return {
    align: 4,
    size: 4,
    wgsl: 'f32',
  };
}

function createMaterialUniformLayout() {
  const ports = Object.entries(materialPortIndex)
    .sort((a, b) => a[1] - b[1])
    .map(([name, index]) => {
      const type = materialPortTypes[name];
      const field = materialPortFields[name];
      if (!type || !field) {
        throw new Error(`Missing MaterialX public uniform metadata for "${name}".`);
      }
      return {
        field,
        index,
        name,
        type,
      };
    });
  let offset = 0;
  const byName = {};

  for (const port of ports) {
    const layout = getUniformTypeLayout(port.type);
    offset = alignTo(offset, layout.align);
    Object.assign(port, {
      byteOffset: offset,
      wgsl: layout.wgsl,
    });
    byName[port.name] = port;
    offset += layout.size;
  }

  return {
    byName,
    byteLength: alignTo(offset, 16),
    ports,
  };
}

function createPublicUniformStructSource() {
  const fields = materialUniformLayout.ports
    .map(port => `  ${port.field}: ${port.wgsl},`)
    .join('\n');
  return `struct PublicUniformsPixel {\n${fields}\n};`;
}

function createMaterialAccessorSource() {
  const floatCases = materialUniformLayout.ports
    .filter(port => port.type !== 'color3' && port.type !== 'vector3')
    .map((port) => {
      const value = port.type === 'integer'
        ? `f32(u_public.${port.field})`
        : `u_public.${port.field}`;
      return `    case ${port.index}u: { return ${value}; }`;
    })
    .join('\n');
  const colorCases = materialUniformLayout.ports
    .filter(port => port.type === 'color3' || port.type === 'vector3')
    .map(port => `    case ${port.index}u: { return u_public.${port.field}; }`)
    .join('\n');

  return `fn materialFloat(index: u32) -> f32 {
  switch index {
${floatCases}
    default: { return 0.0; }
  }
}

fn materialColor(index: u32) -> vec3<f32> {
  switch index {
${colorCases}
    default: { return vec3<f32>(materialFloat(index)); }
  }
}`;
}

function createStandardSurfaceBridgeParameters() {
  const publicParameter = port => ({
    expression: port.type === 'integer' ? `u_public.${port.field} != 0` : `u_public.${port.field}`,
    name: port.field,
    wgsl: port.type === 'integer' ? 'bool' : port.wgsl,
  });
  return [
    ...materialUniformLayout.ports
      .slice(0, materialPortIndex.coatAffectColor)
      .map(publicParameter),
    {
      expression: 'geomprop_Nworld_out',
      name: 'coat_normal',
      wgsl: 'vec3<f32>',
    },
    ...materialUniformLayout.ports
      .slice(materialPortIndex.coatAffectColor)
      .map(publicParameter),
    {
      expression: 'geomprop_Nworld_out',
      name: 'normal',
      wgsl: 'vec3<f32>',
    },
    {
      expression: 'geomprop_Tworld_out',
      name: 'tangent',
      wgsl: 'vec3<f32>',
    },
    {
      expression: 'input.worldPosition',
      name: 'position_world',
      wgsl: 'vec3<f32>',
    },
  ];
}

function createStandardSurfaceBridgeSource() {
  const parameters = standardSurfaceBridgeParameters
    .map(parameter => `  ${parameter.name}: ${parameter.wgsl}`)
    .join(',\n');

  return `struct SurfaceShader {
  color: vec3<f32>,
  transparency: vec3<f32>,
};

struct LightShader {
  intensity: vec3<f32>,
  direction: vec3<f32>,
};

fn numActiveLightSources() -> i32 {
  return min(u_privatePixel.u_numActiveLightSources, 1);
}

fn sampleLightSource(position: vec3<f32>) -> LightShader {
  _ = position;
  return LightShader(vec3<f32>(1.0), normalize(-u_lightData.lightDirection.xyz));
}

fn mx_square(x: f32) -> f32 {
  return x * x;
}

fn mx_pow5(x: f32) -> f32 {
  return mx_square(mx_square(x)) * x;
}

fn mx_ior_to_f0(ior: f32) -> f32 {
  let ratio = (ior - 1.0) / (ior + 1.0);
  return ratio * ratio;
}

fn mx_fresnel_schlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  let x = clamp(1.0 - cosTheta, 0.0, 1.0);
  return f0 + (vec3<f32>(1.0) - f0) * mx_pow5(x);
}

fn mx_average_alpha(alpha: vec2<f32>) -> f32 {
  return (alpha.x + alpha.y) * 0.5;
}

fn mx_ggx_NDF(H: vec3<f32>, alpha: vec2<f32>) -> f32 {
  let safeAlpha = max(alpha, vec2<f32>(0.001));
  let He = H.xy / safeAlpha;
  let denom = dot(He, He) + mx_square(H.z);
  return 1.0 / (3.1415926535897932 * safeAlpha.x * safeAlpha.y * mx_square(denom));
}

fn mx_ggx_smith_G1(cosTheta: f32, alpha: f32) -> f32 {
  let safeCosTheta = max(cosTheta, 0.001);
  let cosTheta2 = mx_square(safeCosTheta);
  let tanTheta2 = (1.0 - cosTheta2) / cosTheta2;
  return 2.0 / (1.0 + sqrt(1.0 + mx_square(alpha) * tanTheta2));
}

fn mx_ggx_smith_G2(NdotL: f32, NdotV: f32, alpha: f32) -> f32 {
  let alpha2 = mx_square(alpha);
  let lambdaL = sqrt(alpha2 + (1.0 - alpha2) * mx_square(NdotL));
  let lambdaV = sqrt(alpha2 + (1.0 - alpha2) * mx_square(NdotV));
  return 2.0 * NdotL * NdotV / max(lambdaL * NdotV + lambdaV * NdotL, 0.001);
}

fn mx_roughness_anisotropy(roughness: f32, anisotropy: f32) -> vec2<f32> {
  let roughness_sqr = clamp(roughness * roughness, 0.00000001, 1.0);
  if (anisotropy > 0.0) {
    let aspect = sqrt(1.0 - clamp(anisotropy, 0.0, 0.98));
    return vec2<f32>(min(roughness_sqr / aspect, 1.0), roughness_sqr * aspect);
  }
  return vec2<f32>(roughness_sqr);
}

fn mx_luminance_color3(inputValue: vec3<f32>, lumacoeffs: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(inputValue, lumacoeffs));
}

fn mx_rotate_vector3(inputValue: vec3<f32>, amount: f32, axisValue: vec3<f32>) -> vec3<f32> {
  let axis = normalize(axisValue);
  let rotationRadians = amount * 0.017453292519943295;
  let s = sin(rotationRadians);
  let c = cos(rotationRadians);
  let oc = 1.0 - c;
  return inputValue * c + cross(inputValue, axis) * s + axis * dot(axis, inputValue) * oc;
}

fn mx_latlong_uv(direction: vec3<f32>) -> vec2<f32> {
  let transformedDirection = normalize((u_privatePixel.u_envMatrix * vec4<f32>(normalize(direction), 0.0)).xyz);
  let u = fract(atan2(transformedDirection.x, -transformedDirection.z) * 0.15915494309189535 + 0.5);
  let v = acos(clamp(transformedDirection.y, -1.0, 1.0)) * 0.3183098861837907;
  return vec2<f32>(u, v);
}

fn mx_sample_environment_radiance(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
  let uv = mx_latlong_uv(direction);
  let sampleColor = textureSample(u_envRadianceTexture, u_envRadianceSampler, uv).rgb;
  return sampleColor * u_privatePixel.u_envLightIntensity * mix(1.0, 0.62, saturate(roughness));
}

fn mx_sample_environment_irradiance(direction: vec3<f32>) -> vec3<f32> {
  let uv = mx_latlong_uv(direction);
  return textureSample(u_envIrradianceTexture, u_envIrradianceSampler, uv).rgb * u_privatePixel.u_envLightIntensity;
}

fn mx_bridge_specular_lobe(N: vec3<f32>, L: vec3<f32>, V: vec3<f32>, X: vec3<f32>, alphaInput: vec2<f32>) -> f32 {
  let alpha = clamp(alphaInput, vec2<f32>(0.045), vec2<f32>(1.0));
  let Nn = normalize(N);
  let Xn = normalize(X - dot(X, Nn) * Nn);
  let Yn = normalize(cross(Nn, Xn));
  let H = normalize(L + V);
  let Ht = vec3<f32>(dot(H, Xn), dot(H, Yn), max(dot(H, Nn), 0.0));
  let NdotL = saturate(dot(Nn, L));
  let NdotV = max(saturate(dot(Nn, V)), 0.001);
  let D = mx_ggx_NDF(Ht, alpha);
  let G = mx_ggx_smith_G2(NdotL, NdotV, mx_average_alpha(alpha));
  return clamp(D * G * NdotL / (4.0 * NdotV) * 0.35, 0.0, 1.5);
}

fn mx_bridge_thin_film_tint(thickness: f32, coatWeight: f32) -> vec3<f32> {
  let strength = saturate(thickness / 700.0) * saturate(coatWeight);
  let phase = vec3<f32>(0.0, 2.0943951, 4.1887902) + thickness * 0.018;
  let tint = vec3<f32>(0.64) + 0.36 * cos(phase);
  return vec3<f32>(1.0) * (1.0 - strength) + tint * strength;
}

fn mx_oren_nayar_diffuse(NdotV: f32, NdotL: f32, LdotV: f32, roughness: f32) -> f32 {
  let s = LdotV - NdotL * NdotV;
  let stinv = select(0.0, s / max(NdotL, NdotV), s > 0.0);
  let sigma2 = mx_square(roughness);
  let A = 1.0 - 0.5 * (sigma2 / (sigma2 + 0.33));
  let B = 0.45 * sigma2 / (sigma2 + 0.09);
  return A + B * stinv;
}

fn ${generatedStandardSurfaceFunctionName}(
${parameters}
) -> SurfaceShader {
  let shadingNormal = normalize(normal);
  let shadingTangent = normalize(tangent);
  let viewDirection = normalize(u_privatePixel.u_viewPosition - position_world);
  let lightShader = sampleLightSource(position_world);
  let lightDirection = lightShader.direction;
  let halfVector = normalize(lightDirection + viewDirection);
  let coatTangent = mx_rotate_vector3(shadingTangent, coat_rotation * 360.0, coat_normal);
  let rotatedMainTangent = mx_rotate_vector3(shadingTangent, specular_rotation * 360.0, shadingNormal);
  let mainTangent = select(shadingTangent, rotatedMainTangent, specular_anisotropy > 0.0);
  let baseColor = max(base_color * base, vec3<f32>(0.0));
  let diffuseRoughness = saturate(diffuse_roughness);
  let metalnessWeight = saturate(metalness);
  let specularWeight = saturate(specular);
  let specularColor = max(specular_color, vec3<f32>(0.0));
  let specularRoughness = clamp(specular_roughness, 0.04, 1.0);
  let specularIor = max(specular_IOR, 1.01);
  let transmissionWeight = saturate(transmission);
  let transmissionColor = max(transmission_color, vec3<f32>(0.0));
  let subsurfaceWeight = saturate(subsurface);
  let subsurfaceColor = max(subsurface_color, vec3<f32>(0.0));
  let sheenWeight = saturate(sheen);
  let sheenColor = max(sheen_color, vec3<f32>(0.0));
  let sheenRoughness = saturate(sheen_roughness);
  let coatWeight = saturate(coat);
  let coatColor = max(coat_color, vec3<f32>(0.0));
  let coatRoughness = clamp(coat_roughness, 0.03, 1.0);
  let coatIor = max(coat_IOR, 1.01);
  let coatAffectColor = saturate(coat_affect_color);
  let coatAffectRoughness = saturate(coat_affect_roughness);
  let thinFilmThickness = max(thin_film_thickness, 0.0);
  let emissionWeight = max(emission, 0.0);
  let emissionColor = max(emission_color, vec3<f32>(0.0));
  let surfaceOpacity = saturate(mx_luminance_color3(opacity, vec3<f32>(0.272229, 0.674082, 0.053689)).x);
  let activeLightCount = f32(numActiveLightSources());
  let nDotL = saturate(dot(shadingNormal, lightDirection));
  let nDotV = saturate(dot(shadingNormal, viewDirection));
  let vDotH = saturate(dot(viewDirection, halfVector));
  let lDotV = saturate(dot(lightDirection, viewDirection));
  let tDotH = abs(dot(mainTangent, halfVector));
  let irradiance = mx_sample_environment_irradiance(shadingNormal);
  let radiance = mx_sample_environment_radiance(reflect(-viewDirection, shadingNormal), specularRoughness);
  let directMask = max(activeLightCount, 1.0);
  let transmissionMix = transmissionWeight * 0.35;
  let diffuseColor = baseColor * (1.0 - transmissionMix) + transmissionColor * transmissionMix;
  let coatGamma = 1.0 + coatWeight * coatAffectColor;
  let coatAffectedDiffuse = pow(max(diffuseColor, vec3<f32>(0.0)), vec3<f32>(coatGamma));
  let diffuseResponse = mx_oren_nayar_diffuse(nDotV, nDotL, lDotV, diffuseRoughness);
  let diffuseLight = vec3<f32>(0.12) + lightShader.intensity * (nDotL * diffuseResponse * mix(0.82, 0.58, diffuseRoughness) * directMask) + irradiance * 0.28;
  let diffuse = coatAffectedDiffuse * diffuseLight * (1.0 - metalnessWeight);
  let dielectricF0 = vec3<f32>(mx_ior_to_f0(specularIor)) * specularColor * specularWeight;
  let f0 = dielectricF0 * (1.0 - metalnessWeight) + baseColor * metalnessWeight;
  let specularFresnel = mx_fresnel_schlick(vDotH, f0);
  let mainRoughness = mx_roughness_anisotropy(mix(specularRoughness, 1.0, coatWeight * coatAffectRoughness), specular_anisotropy);
  let specularTerm = mx_bridge_specular_lobe(shadingNormal, lightDirection, viewDirection, mainTangent, mainRoughness);
  let envSpecular = radiance * mx_fresnel_schlick(nDotV, f0) * mix(0.35, 0.08, specularRoughness);
  let coatF0 = vec3<f32>(mx_ior_to_f0(coatIor)) * coatColor;
  let film = mx_bridge_thin_film_tint(thinFilmThickness, coatWeight);
  let coatRoughnessVector = mx_roughness_anisotropy(coatRoughness, coat_anisotropy);
  let coatTerm = coatWeight * mx_bridge_specular_lobe(coat_normal, lightDirection, viewDirection, coatTangent, coatRoughnessVector) * mx_fresnel_schlick(vDotH, coatF0) * film;
  let sheenTerm = sheenWeight * sheenColor * pow(1.0 - nDotV, mix(6.0, 1.4, sheenRoughness)) * 0.32;
  let subsurfaceTerm = subsurfaceWeight * subsurfaceColor * (0.1 + 0.42 * pow(1.0 - nDotV, 2.0));
  let tangentGlint = vec3<f32>(pow(tDotH, 36.0)) * coatWeight * film * 0.06;
  let emissionTerm = emissionWeight * emissionColor;
  let color = diffuse
    + specularFresnel * specularTerm * lightShader.intensity * (0.45 + nDotL * 1.6)
    + envSpecular
    + coatTerm * lightShader.intensity * (0.8 + nDotL * 1.35)
    + sheenTerm
    + subsurfaceTerm
    + tangentGlint
    + emissionTerm;
  let transparency = select(vec3<f32>(0.0), vec3<f32>(1.0 - surfaceOpacity), thin_walled);
  return SurfaceShader(color * surfaceOpacity, transparency);
}
`;
}

function createFragmentBridgeMainSource() {
  const callArguments = standardSurfaceBridgeParameters
    .map(parameter => `    ${parameter.expression}`)
    .join(',\n');
  return `@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let geomprop_Nworld_out = normalize(input.normal);
  let geomprop_Tworld_out = normalize(input.tangent);
  let SR_bridge_out = ${generatedStandardSurfaceFunctionName}(
${callArguments}
  );
  let gammaCorrected = pow(max(SR_bridge_out.color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  let out1 = vec4<f32>(gammaCorrected, 1.0);
  return out1;
}`;
}

function clonePorts(ports) {
  return Object.fromEntries(
    Object.entries(ports).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function createFallbackMaterialSamples() {
  return Object.fromEntries(
    Object.entries(fallbackMaterialSamples).map(([id, sample]) => [
      id,
      {
        label: sample.label,
        ports: clonePorts(sample.ports),
        source: 'fallback',
      },
    ]),
  );
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function recordDuration(name, startTime) {
  const duration = performance.now() - startTime;
  setMetric(name, formatDuration(duration));
  return duration;
}

async function loadMaterialX() {
  const loaderUrl = new URL('JsMaterialXGenShader.js', runtimeBaseUrl).href;
  const { default: createMaterialX } = await import(loaderUrl);
  return createMaterialX({
    locateFile: file => new URL(file, runtimeBaseUrl).href,
    printErr: handleMaterialXPrintErr,
  });
}

function handleMaterialXPrintErr(value) {
  const message = String(value);
  if (message.includes(materialXBoolUniformWarning)) {
    materialXKnownWarnings.add(materialXBoolUniformWarning);
    setMetric('shaderNotes', 'bool uniform mapped');
    return;
  }

  console.warn(`[MaterialX] ${message}`);
}

function replaceShaderVertexMain(source, vertexMainSource) {
  const start = source.indexOf('@vertex\nfn vertexMain');
  const endMarker = '\n\nfn saturate(value: f32)';
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate the bridge vertex stage in the direct WebGPU shader.');
  }

  return `${source.slice(0, start)}${vertexMainSource}${source.slice(end)}`;
}

function adaptGeneratedVertexSource(generatedSource) {
  const checks = [
    {
      label: 'binding 0 PrivateUniforms_vertex',
      pattern: /layout\s*\(\s*std140\s*,\s*binding\s*=\s*0\s*\)\s*uniform\s+PrivateUniforms_vertex/,
    },
    {
      label: 'position location 0',
      pattern: /layout\s*\(\s*location\s*=\s*0\s*\)\s*in\s+vec3\s+i_position/,
    },
    {
      label: 'normal location 1',
      pattern: /layout\s*\(\s*location\s*=\s*1\s*\)\s*in\s+vec3\s+i_normal/,
    },
    {
      label: 'tangent location 2',
      pattern: /layout\s*\(\s*location\s*=\s*2\s*\)\s*in\s+vec3\s+i_tangent/,
    },
    {
      label: 'world position transform',
      pattern: /hPositionWorld\s*=\s*u_worldMatrix\s*\*\s*vec4\s*\(\s*i_position\s*,\s*1\.0\s*\)/,
    },
    {
      label: 'clip position transform',
      pattern: /gl_Position\s*=\s*u_viewProjectionMatrix\s*\*\s*hPositionWorld/,
    },
    {
      label: 'normal output',
      pattern: /vd\.normalWorld\s*=\s*normalize\s*\([^;]*u_worldInverseTransposeMatrix[^;]*i_normal/s,
    },
    {
      label: 'tangent output',
      pattern: /vd\.tangentWorld\s*=\s*normalize\s*\([^;]*u_worldMatrix[^;]*i_tangent/s,
    },
    {
      label: 'world position output',
      pattern: /vd\.positionWorld\s*=\s*hPositionWorld\.xyz/,
    },
  ];
  const missing = checks
    .filter(check => !check.pattern.test(generatedSource))
    .map(check => check.label);

  if (missing.length) {
    throw new Error(`Generated vertex source does not match the narrow adapter contract: ${missing.join(', ')}.`);
  }

  const vertexMainSource = `@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let hPositionWorld = u_vertex.u_worldMatrix * vec4<f32>(input.position, 1.0);
  output.clipPosition = u_vertex.u_viewProjectionMatrix * hPositionWorld;
  output.worldPosition = hPositionWorld.xyz;
  output.normal = normalize((u_vertex.u_worldInverseTransposeMatrix * vec4<f32>(input.normal, 0.0)).xyz);
  output.tangent = normalize((u_vertex.u_worldMatrix * vec4<f32>(input.tangent, 0.0)).xyz);
  return output;
}`;

  return {
    lineCount: generatedSource.split('\n').length,
    shaderSource: replaceShaderVertexMain(shaderSource, vertexMainSource),
  };
}

function normalizeMaterialVariableName(variable) {
  return materialVariableAliases[variable] || variable;
}

function parseMaterialValue(type, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (normalized === 'true') return 1;
  if (normalized === 'false') return 0;

  if (type === 'color3' || type === 'vector3') {
    return normalized.split(',').map(component => Number(component.trim()));
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function getBlockPorts(block) {
  const size = typeof block?.size === 'function' ? block.size() : 0;
  const ports = [];
  for (let index = 0; index < size; index++) {
    const port = block.get(index);
    const value = port.getValue?.();
    ports.push({
      type: port.getType?.()?.getName?.() || '',
      value: value?.getValueString?.() || '',
      variable: port.getVariable?.() || '',
    });
  }
  return ports;
}

function validateGeneratedPublicUniforms(generatedPorts, sampleId) {
  const expected = materialUniformLayout.ports;
  if (generatedPorts.length !== expected.length) {
    throw new Error(`Generated public uniform count changed for "${sampleId}": expected ${expected.length}, got ${generatedPorts.length}.`);
  }

  const mismatches = [];
  for (const expectedPort of expected) {
    const generatedPort = generatedPorts[expectedPort.index];
    const generatedName = normalizeMaterialVariableName(generatedPort?.variable);
    if (generatedName !== expectedPort.name) {
      mismatches.push(`${expectedPort.index}: expected ${expectedPort.name}, got ${generatedPort?.variable || '<missing>'}`);
      continue;
    }

    if (generatedPort.type !== expectedPort.type) {
      mismatches.push(`${expectedPort.name}: expected ${expectedPort.type}, got ${generatedPort.type || '<unknown>'}`);
    }
  }

  if (mismatches.length) {
    throw new Error(`Generated public uniform block no longer matches the bridge layout for "${sampleId}": ${mismatches.join('; ')}.`);
  }
}

function validateGeneratedPrivateUniforms(generatedPorts, sampleId) {
  const generatedBufferPorts = generatedPorts.filter(port => !privatePixelTexturePorts.has(port.variable));
  if (generatedBufferPorts.length !== privatePixelUniformPorts.length) {
    throw new Error(`Generated private uniform count changed for "${sampleId}": expected ${privatePixelUniformPorts.length}, got ${generatedBufferPorts.length}.`);
  }

  const mismatches = [];
  for (const [index, expectedPort] of privatePixelUniformPorts.entries()) {
    const generatedPort = generatedBufferPorts[index];
    if (generatedPort?.variable !== expectedPort.variable) {
      mismatches.push(`${index}: expected ${expectedPort.variable}, got ${generatedPort?.variable || '<missing>'}`);
      continue;
    }

    if (generatedPort.type !== expectedPort.type) {
      mismatches.push(`${expectedPort.variable}: expected ${expectedPort.type}, got ${generatedPort.type || '<unknown>'}`);
    }
  }

  if (mismatches.length) {
    throw new Error(`Generated private uniform block no longer matches the bridge layout for "${sampleId}": ${mismatches.join('; ')}.`);
  }

  return generatedBufferPorts.length;
}

function countGeneratedFunctions(source) {
  return (source.match(/^[A-Za-z_][\w<>\s]*?\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/gm) || []).length;
}

function splitTopLevelArguments(source) {
  const args = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '(' || character === '[' || character === '{') {
      depth++;
    } else if (character === ')' || character === ']' || character === '}') {
      depth--;
    } else if (character === ',' && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

function extractParenthesizedSource(source, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index++) {
    const character = source[index];
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth === 0) {
        return source.slice(openParenIndex + 1, index);
      }
    }
  }

  return '';
}

function extractFunctionSignatureArguments(source, functionName) {
  const signaturePattern = new RegExp(`\\bvoid\\s+${functionName}\\s*\\(`);
  const signature = signaturePattern.exec(source);
  if (!signature) return [];
  const openParenIndex = source.indexOf('(', signature.index);
  return splitTopLevelArguments(extractParenthesizedSource(source, openParenIndex));
}

function extractMainCallArguments(source, functionName) {
  const main = /\bvoid\s+main\s*\(\s*\)\s*\{/.exec(source);
  if (!main) return [];
  const callIndex = source.indexOf(`${functionName}(`, main.index);
  if (callIndex < 0) return [];
  const openParenIndex = source.indexOf('(', callIndex);
  return splitTopLevelArguments(extractParenthesizedSource(source, openParenIndex));
}

function getGlslParameterName(parameter) {
  return parameter
    .trim()
    .replace(/^out\s+/, '')
    .split(/\s+/)
    .pop()
    ?.replace(/\[[^\]]*\]$/, '') || '';
}

function describeMismatches(actual, expected) {
  if (actual.length !== expected.length) {
    return [`expected ${expected.length} entries, got ${actual.length}`];
  }

  return expected
    .map((expectedValue, index) => (actual[index] === expectedValue
      ? null
      : `${index}: expected ${expectedValue}, got ${actual[index] || '<missing>'}`))
    .filter(Boolean);
}

function validateGeneratedPixelSource(source, sampleId) {
  const checks = [
    {
      label: 'fragment stage pragma',
      pattern: /#pragma\s+shader_stage\s*\(\s*fragment\s*\)/,
    },
    {
      label: 'binding 1 PrivateUniforms_pixel',
      pattern: /layout\s*\(\s*std140\s*,\s*binding\s*=\s*1\s*\)\s*uniform\s+PrivateUniforms_pixel/,
    },
    {
      label: 'binding 6 PublicUniforms_pixel',
      pattern: /layout\s*\(\s*std140\s*,\s*binding\s*=\s*6\s*\)\s*uniform\s+PublicUniforms_pixel/,
    },
    {
      label: 'binding 7 LightData_pixel',
      pattern: /layout\s*\(\s*std140\s*,\s*binding\s*=\s*7\s*\)\s*uniform\s+LightData_pixel/,
    },
    {
      label: 'VertexData input',
      pattern: /layout\s*\(\s*location\s*=\s*0\s*\)\s*in\s+VertexData/,
    },
    {
      label: 'out1 color output',
      pattern: /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+vec4\s+out1/,
    },
    {
      label: 'standard surface function',
      pattern: new RegExp(`\\bvoid\\s+${generatedStandardSurfaceFunctionName}\\s*\\(`),
    },
    {
      label: 'main entry point',
      pattern: /\bvoid\s+main\s*\(\s*\)/,
    },
  ];
  const missing = checks
    .filter(check => !check.pattern.test(source))
    .map(check => check.label);

  if (missing.length) {
    throw new Error(`Generated pixel source does not match the narrow fragment contract for "${sampleId}": ${missing.join(', ')}.`);
  }

  const signatureNames = extractFunctionSignatureArguments(source, generatedStandardSurfaceFunctionName)
    .map(getGlslParameterName);
  const signatureMismatches = describeMismatches(signatureNames, generatedPixelFunctionParameters);
  if (signatureMismatches.length) {
    throw new Error(`Generated standard-surface function signature changed for "${sampleId}": ${signatureMismatches.join('; ')}.`);
  }

  const mainCallArguments = extractMainCallArguments(source, generatedStandardSurfaceFunctionName);
  const expectedMainCallArguments = [...generatedPixelMainArguments];
  const surfaceOutputArgument = mainCallArguments.at(-1) || '';
  if (/^SR_\w+_out$/.test(surfaceOutputArgument)) {
    expectedMainCallArguments[expectedMainCallArguments.length - 1] = surfaceOutputArgument;
  }
  const mainCallMismatches = describeMismatches(mainCallArguments, expectedMainCallArguments);
  if (mainCallMismatches.length) {
    throw new Error(`Generated fragment main call changed for "${sampleId}": ${mainCallMismatches.join('; ')}.`);
  }

  const missingPortedHelpers = portedGeneratedPixelHelpers.filter((helperName) => {
    const helperPattern = new RegExp(`\\b${helperName}\\s*\\(`);
    return !helperPattern.test(source);
  });
  if (missingPortedHelpers.length) {
    throw new Error(`Generated pixel source no longer contains ported helper functions for "${sampleId}": ${missingPortedHelpers.join(', ')}.`);
  }

  const translatedFragment = translateMaterialXFragmentGlsl(source);
  if (translatedFragment.skipped.length) {
    const skipped = translatedFragment.skipped
      .map(entry => `${entry.name}: ${entry.reason}`)
      .join('; ');
    throw new Error(`Generated pixel source is outside the current fragment translator slice for "${sampleId}": ${skipped}`);
  }

  return {
    functionCount: countGeneratedFunctions(source),
    translatedFragment,
    mainCallArgumentCount: mainCallArguments.length,
    portedHelperCount: portedGeneratedPixelHelpers.length,
    standardSurfaceParameterCount: signatureNames.length,
  };
}

async function generateMaterialSample(mx, sampleId) {
  if (!mx.WgslShaderGenerator) {
    throw new Error('MaterialX runtime does not expose WgslShaderGenerator.');
  }

  const materialx = materialSampleSources[sampleId];
  const fallback = fallbackMaterialSamples[sampleId] || fallbackMaterialSamples.standard;
  const document = mx.createDocument();
  await mx.readFromXmlString(document, materialx);

  const generator = mx.WgslShaderGenerator.create();
  const context = new mx.GenContext(generator);
  const libraries = mx.loadStandardLibraries(context);
  document.importLibrary(libraries);
  context.getOptions().shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error(`No renderable MaterialX element found for sample "${sampleId}".`);
  }

  const shader = generator.generate(element.getNamePath(), element, context);
  const pixelStage = shader.getStage('pixel');
  const uniformBlocks = pixelStage.getUniformBlocks();
  const publicUniforms = uniformBlocks.PublicUniforms;
  const privateUniforms = uniformBlocks.PrivateUniforms;
  const ports = clonePorts(fallback.ports);
  const generatedPorts = getBlockPorts(publicUniforms);
  validateGeneratedPublicUniforms(generatedPorts, sampleId);
  const privateUniformCount = validateGeneratedPrivateUniforms(getBlockPorts(privateUniforms), sampleId);

  for (const port of generatedPorts) {
    const name = normalizeMaterialVariableName(port.variable);
    if (materialPortIndex[name] === undefined) continue;

    const parsedValue = parseMaterialValue(port.type, port.value);
    if (parsedValue !== null) ports[name] = parsedValue;
  }

  const vertexSource = shader.getSourceCode('vertex');
  const pixelSource = shader.getSourceCode('pixel');
  const pixelContract = validateGeneratedPixelSource(pixelSource, sampleId);
  return {
    label: fallback.label,
    ports,
    renderable: element.getNamePath(),
    source: 'shadergen',
    target: typeof generator.getTarget === 'function' ? generator.getTarget() : 'unknown',
    pixelContract,
    privateUniformCount,
    uniformCount: generatedPorts.length,
    vertexSource,
    vertexLines: vertexSource.split('\n').length,
    pixelLines: pixelSource.split('\n').length,
  };
}

async function initializeMaterialXShaderSupport(materialControl, pipelineControl = {}) {
  try {
    setStatus('Loading MaterialX shadergen');
    const materialXStart = performance.now();
    const mx = await loadMaterialX();
    recordDuration('materialXLoad', materialXStart);

    setStatus('Generating MaterialX shader contract');
    const shaderStart = performance.now();
    const generatedEntries = [];
    for (const sampleId of Object.keys(materialSampleSources)) {
      generatedEntries.push([sampleId, await generateMaterialSample(mx, sampleId)]);
    }

    materialSamples = Object.fromEntries(generatedEntries);
    const activeSample = materialSamples[activeMaterialId] || generatedEntries[0]?.[1];
    recordDuration('shaderGeneration', shaderStart);
    setMetric('shaderTarget', activeSample?.target || '-');
    setMetric('shaderContract', activeSample ? `${activeSample.uniformCount} public ports / ${publicUniformByteLength} B` : '-');
    setMetric('contract', activeSample ? `bindings 0-7 / ${activeSample.privateUniformCount} private ports / ${privatePixelByteLength} B` : '-');
    setMetric('shaderSource', activeSample ? `${activeSample.vertexLines}v / ${activeSample.pixelLines}p lines` : '-');
    setMetric('fragmentAdapter', activeSample ? `${activeSample.pixelContract.portedHelperCount}/${activeSample.pixelContract.functionCount} funcs / ${activeSample.pixelContract.standardSurfaceParameterCount} params` : '-');
    setMetric('fragmentTranslator', activeSample ? `${activeSample.pixelContract.translatedFragment.translatedCount} translated / ${activeSample.pixelContract.translatedFragment.requestedCount} requested` : '-');
    setMetric('shaderNotes', materialXKnownWarnings.size ? 'bool uniform mapped' : 'none');
    materialControl.refreshOptions();
    materialControl.applyMaterial(activeMaterialId, { updateUrl: false });
    if (activeSample?.vertexSource && pipelineControl.applyGeneratedVertexSource) {
      try {
        setStatus('Adapting MaterialX vertex shader');
        await pipelineControl.applyGeneratedVertexSource(activeSample.vertexSource);
      } catch (error) {
        console.warn('Generated vertex adaptation failed, keeping bridge vertex stage.', error);
        setMetric('vertexAdapter', 'bridge fallback');
      }
    }
    if (activeSample?.pixelContract.translatedFragment.wgsl && pipelineControl.validateGeneratedFragmentTranslation) {
      try {
        setStatus('Validating fragment translator');
        const validationDuration = await pipelineControl.validateGeneratedFragmentTranslation(activeSample.pixelContract.translatedFragment.wgsl);
        const { requestedCount, translatedCount } = activeSample.pixelContract.translatedFragment;
        setMetric('fragmentTranslator', `${translatedCount}/${requestedCount} translated / ${formatDuration(validationDuration)}`);
      } catch (error) {
        console.warn('Generated fragment translation validation failed.', error);
        setMetric('fragmentTranslator', 'compile failed');
      }
    }
    setStatus('Ready');
  } catch (error) {
    console.error(error);
    setMetric('shaderTarget', 'fallback');
    setMetric('shaderContract', error?.message || String(error));
    setMetric('fragmentAdapter', 'fallback active');
    setMetric('fragmentTranslator', 'fallback active');
    setMetric('vertexAdapter', 'fallback active');
    setMetric('shaderNotes', 'fallback active');
    setStatus('Shadergen fallback active');
  }
}

function recordMaterialSwitchSample(duration) {
  if (!Number.isFinite(duration)) return;

  materialSwitchSamples.push(duration);
  if (materialSwitchSamples.length > 24) materialSwitchSamples.shift();

  const sorted = [...materialSwitchSamples].sort((a, b) => a - b);
  const average = materialSwitchSamples.reduce((sum, value) => sum + value, 0) / materialSwitchSamples.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  setMetric('materialSwitchAverage', formatDuration(average));
  setMetric('materialSwitchP95', formatDuration(p95));
}

function createIdentityMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = far * near / (near - far);
  return out;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function lookAt(out, eye, target, up) {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

function multiplyMatrices(out, a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      const value = a[0 * 4 + row] * b[column * 4 + 0]
        + a[1 * 4 + row] * b[column * 4 + 1]
        + a[2 * 4 + row] * b[column * 4 + 2]
        + a[3 * 4 + row] * b[column * 4 + 3];
      result[column * 4 + row] = value;
    }
  }
  out.set(result);
  return out;
}

function createSphereGeometry(radius = sphereRadius, widthSegments = 96, heightSegments = 48) {
  const vertices = [];
  const indices = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const normal = [
        sinTheta * cosPhi,
        cosTheta,
        sinTheta * sinPhi,
      ];
      const tangent = normalize([-sinPhi, 0, cosPhi]);

      vertices.push(
        normal[0] * radius,
        normal[1] * radius,
        normal[2] * radius,
        normal[0],
        normal[1],
        normal[2],
        tangent[0],
        tangent[1],
        tangent[2],
      );
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a + 1, b, a, a + 1, b + 1, b);
    }
  }

  return {
    indices: new Uint32Array(indices),
    vertices: new Float32Array(vertices),
  };
}

function getAttributeVector3(attribute, index, fallback = [0, 0, 0]) {
  if (!attribute) return fallback;

  return [
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
  ];
}

function getFallbackTangent(normal) {
  const helper = Math.abs(normal[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(helper, normal));
}

function collectMeshGeometries(root) {
  const geometries = [];
  root.updateWorldMatrix(true, true);

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }

    if (!geometry.attributes.tangent && geometry.index && geometry.attributes.uv) {
      geometry.computeTangents();
    }

    geometries.push({
      geometry,
      name: child.name || 'mesh',
    });
  });

  return geometries;
}

function packGeometries(geometries, label) {
  if (!geometries.length) {
    throw new Error(`No renderable meshes found in ${label}.`);
  }

  const bounds = new Box3();
  for (const { geometry } of geometries) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }

  const center = new Vector3();
  const size = new Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const scale = (sphereRadius * 2) / maxSize;
  const vertices = [];
  const indices = [];

  for (const { geometry } of geometries) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const tangent = geometry.attributes.tangent;
    const index = geometry.index;
    const vertexOffset = vertices.length / 9;

    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      const rawPosition = getAttributeVector3(position, vertexIndex);
      const rawNormal = normalize(getAttributeVector3(normal, vertexIndex, [0, 1, 0]));
      const rawTangent = tangent
        ? normalize(getAttributeVector3(tangent, vertexIndex, getFallbackTangent(rawNormal)))
        : getFallbackTangent(rawNormal);

      vertices.push(
        (rawPosition[0] - center.x) * scale,
        (rawPosition[1] - center.y) * scale,
        (rawPosition[2] - center.z) * scale,
        rawNormal[0],
        rawNormal[1],
        rawNormal[2],
        rawTangent[0],
        rawTangent[1],
        rawTangent[2],
      );
    }

    if (index) {
      for (let indexIndex = 0; indexIndex < index.count; indexIndex++) {
        indices.push(vertexOffset + index.getX(indexIndex));
      }
    } else {
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        indices.push(vertexOffset + vertexIndex);
      }
    }
  }

  return {
    indices: new Uint32Array(indices),
    label,
    vertices: new Float32Array(vertices),
  };
}

async function loadShaderballGeometry() {
  const geometryUrl = queryParams.get('geom') || defaultGeometry;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(geometryUrl);
  const geometries = collectMeshGeometries(gltf.scene);
  return packGeometries(geometries, prettyGeometryName(geometryUrl));
}

async function loadGeometry() {
  try {
    setStatus('Loading shaderball');
    return await loadShaderballGeometry();
  } catch (error) {
    console.warn('Could not load shaderball geometry, using generated sphere fallback.', error);
    setMetric('model', 'Generated sphere');
    return {
      ...createSphereGeometry(),
      label: 'Generated sphere',
    };
  }
}

function prettyAssetName(path) {
  return decodeURIComponent(path)
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function prettyGeometryName(path) {
  return prettyAssetName(path);
}

function createBuffer(device, label, data, usage) {
  const buffer = device.createBuffer({
    label,
    mappedAtCreation: true,
    size: Math.ceil(data.byteLength / 4) * 4,
    usage,
  });
  const target = data instanceof Float32Array
    ? new Float32Array(buffer.getMappedRange())
    : new Uint32Array(buffer.getMappedRange());
  target.set(data);
  buffer.unmap();
  return buffer;
}

function createUniformBuffer(device, label, data) {
  return device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
  });
}

function createPlaceholderTexture(device, label, color) {
  const texture = device.createTexture({
    format: 'rgba8unorm',
    label,
    size: [1, 1],
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array(color.map(component => Math.round(saturateNumber(component) * 255))),
    { bytesPerRow: 4, rowsPerImage: 1 },
    { height: 1, width: 1 },
  );
  return texture;
}

function getEnvironmentIrradiancePath(environmentPath) {
  return environmentPath.replace('/Lights/', '/Lights/irradiance/');
}

function halfToFloat(value) {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;

  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 1024);
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }

  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Number.POSITIVE_INFINITY) return 0x7c00;
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00;

  float32Scratch[0] = value;
  const bits = uint32Scratch[0];
  const sign = (bits >> 16) & 0x8000;
  let exponent = ((bits >> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((mantissa + 0x1000) >> 13);
  }

  if (exponent >= 0x1f) {
    return sign | 0x7c00;
  }

  const roundedMantissa = mantissa + 0x1000;
  if (roundedMantissa & 0x800000) {
    mantissa = 0;
    exponent++;
    if (exponent >= 0x1f) return sign | 0x7c00;
  } else {
    mantissa = roundedMantissa;
  }

  return sign | (exponent << 10) | (mantissa >> 13);
}

function createHdrMipLevels(hdr) {
  const levels = [{
    data: hdr.data,
    height: hdr.height,
    width: hdr.width,
  }];
  let current = levels[0];

  while (current.width > 1 || current.height > 1) {
    const width = Math.max(1, Math.floor(current.width / 2));
    const height = Math.max(1, Math.floor(current.height / 2));
    const data = new Uint16Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sum = [0, 0, 0, 0];
        let count = 0;

        for (let offsetY = 0; offsetY < 2; offsetY++) {
          for (let offsetX = 0; offsetX < 2; offsetX++) {
            const srcX = Math.min(current.width - 1, x * 2 + offsetX);
            const srcY = Math.min(current.height - 1, y * 2 + offsetY);
            const srcIndex = (srcY * current.width + srcX) * 4;
            for (let channel = 0; channel < 4; channel++) {
              sum[channel] += halfToFloat(current.data[srcIndex + channel]);
            }
            count++;
          }
        }

        const destIndex = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel++) {
          data[destIndex + channel] = floatToHalf(sum[channel] / count);
        }
      }
    }

    current = { data, height, width };
    levels.push(current);
  }

  return levels;
}

function writeTextureMipLevel(device, texture, mipLevel, mip, bytesPerPixel) {
  const rowBytes = mip.width * bytesPerPixel;

  if (mip.height === 1 || rowBytes % 256 === 0) {
    device.queue.writeTexture(
      { mipLevel, texture },
      mip.data,
      { bytesPerRow: rowBytes, rowsPerImage: mip.height },
      { height: mip.height, width: mip.width },
    );
    return;
  }

  const paddedRowBytes = alignTo(rowBytes, 256);
  const sourceBytes = new Uint8Array(mip.data.buffer, mip.data.byteOffset, mip.data.byteLength);
  const paddedBytes = new Uint8Array(paddedRowBytes * mip.height);
  for (let row = 0; row < mip.height; row++) {
    const sourceStart = row * rowBytes;
    paddedBytes.set(sourceBytes.subarray(sourceStart, sourceStart + rowBytes), row * paddedRowBytes);
  }

  device.queue.writeTexture(
    { mipLevel, texture },
    paddedBytes,
    { bytesPerRow: paddedRowBytes, rowsPerImage: mip.height },
    { height: mip.height, width: mip.width },
  );
}

async function loadHdrTexture(url) {
  const texture = await new HDRLoader().loadAsync(url);
  const { data, height, width } = texture.image || {};
  texture.dispose();

  if (!(data instanceof Uint16Array) || !height || !width) {
    throw new Error(`Expected ${url} to load as rgba16float HDR data.`);
  }

  return {
    data,
    height,
    url,
    width,
  };
}

function createHdrTexture(device, label, hdr, options = {}) {
  const bytesPerPixel = 8;
  const mipLevels = options.generateMipmaps
    ? createHdrMipLevels(hdr)
    : [{
        data: hdr.data,
        height: hdr.height,
        width: hdr.width,
      }];
  const texture = device.createTexture({
    format: 'rgba16float',
    label,
    mipLevelCount: mipLevels.length,
    size: [hdr.width, hdr.height],
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  for (const [mipLevel, mip] of mipLevels.entries()) {
    writeTextureMipLevel(device, texture, mipLevel, mip, bytesPerPixel);
  }
  return {
    mipLevelCount: mipLevels.length,
    texture,
  };
}

function createPlaceholderEnvironmentTextures(device) {
  return {
    envIrradianceTexture: createPlaceholderTexture(device, 'MaterialX env irradiance placeholder', [0.62, 0.66, 0.68, 1]),
    envRadianceMipCount: 1,
    envRadianceTexture: createPlaceholderTexture(device, 'MaterialX env radiance placeholder', [0.32, 0.36, 0.42, 1]),
  };
}

async function createEnvironmentTextures(device) {
  const start = performance.now();
  const environmentLabel = prettyAssetName(requestedEnvironment);

  try {
    setStatus(`Loading environment: ${environmentLabel}`);
    const [radiance, irradiance] = await Promise.all([
      loadHdrTexture(requestedEnvironment),
      loadHdrTexture(getEnvironmentIrradiancePath(requestedEnvironment)),
    ]);
    const envIrradiance = createHdrTexture(device, 'MaterialX env irradiance HDR', irradiance);
    const envRadiance = createHdrTexture(device, 'MaterialX env radiance HDR', radiance, { generateMipmaps: true });

    setMetric('environment', environmentLabel);
    setMetric('environmentSize', `${radiance.width}x${radiance.height} mips ${envRadiance.mipLevelCount} / ${irradiance.width}x${irradiance.height}`);
    recordDuration('environmentLoad', start);

    return {
      envIrradianceTexture: envIrradiance.texture,
      envRadianceMipCount: envRadiance.mipLevelCount,
      envRadianceTexture: envRadiance.texture,
    };
  } catch (error) {
    console.warn('Could not load direct WebGPU HDR environment, using placeholder lighting.', error);
    setMetric('environment', 'Placeholder');
    setMetric('environmentSize', '1x1 / 1x1');
    recordDuration('environmentLoad', start);
    return createPlaceholderEnvironmentTextures(device);
  }
}

function saturateNumber(value) {
  return Math.min(1, Math.max(0, value));
}

async function createDevice() {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const start = performance.now();
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter was returned.');
  }

  const device = await adapter.requestDevice();
  setMetric('renderer', 'Direct WebGPU');
  setMetric('adapter', adapter.info?.device || adapter.info?.description || adapter.info?.vendor || 'available');
  recordDuration('deviceInit', start);
  return { adapter, device };
}

function configureCanvas(canvas, device, context, format) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

  canvas.width = width;
  canvas.height = height;
  context.configure({
    alphaMode: 'opaque',
    device,
    format,
  });

  return { height, pixelRatio, width };
}

function createDepthTexture(device, dimensions) {
  return device.createTexture({
    format: depthFormat,
    label: 'Direct WebGPU depth buffer',
    size: [dimensions.width, dimensions.height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

async function createPipeline(device, format, options = {}) {
  const {
    fragmentEntryPoint = 'fragmentMain',
    fragmentSource = options.source || shaderSource,
    label = 'Direct WebGPU proof shader',
    source = shaderSource,
    vertexEntryPoint = 'vertexMain',
    vertexSource = source,
  } = options;
  device.pushErrorScope('validation');
  try {
    const moduleStart = performance.now();
    const vertexModule = device.createShaderModule({
      code: vertexSource,
      label: `${label} vertex`,
    });
    const fragmentModule = fragmentSource === vertexSource
      ? vertexModule
      : device.createShaderModule({
          code: fragmentSource,
          label: `${label} fragment`,
        });
    setMetric('shaderModule', formatDuration(performance.now() - moduleStart));

    const start = performance.now();
    const pipeline = await device.createRenderPipelineAsync({
      depthStencil: {
        depthCompare: 'less',
        depthWriteEnabled: true,
        format: depthFormat,
      },
      fragment: {
        entryPoint: fragmentEntryPoint,
        module: fragmentModule,
        targets: [{ format }],
      },
      label: label.replace(/\bshader\b/i, 'pipeline'),
      layout: 'auto',
      primitive: {
        cullMode: 'back',
        frontFace: 'ccw',
        topology: 'triangle-list',
      },
      vertex: {
        buffers: [
          {
            arrayStride: 9 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32x3', offset: 3 * Float32Array.BYTES_PER_ELEMENT, shaderLocation: 1 },
              { format: 'float32x3', offset: 6 * Float32Array.BYTES_PER_ELEMENT, shaderLocation: 2 },
            ],
          },
        ],
        entryPoint: vertexEntryPoint,
        module: vertexModule,
      },
    });
    const error = await device.popErrorScope();
    if (error) {
      throw error;
    }
    recordDuration('pipeline', start);
    return pipeline;
  } catch (error) {
    const scopedError = await device.popErrorScope().catch(() => null);
    const reportedError = scopedError || error;
    recordWebGpuError('pipeline validation', reportedError);
    throw reportedError;
  }
}

async function validateGeneratedFragmentTranslation(device, wgsl) {
  const source = `${wgsl}

@compute @workgroup_size(1)
fn validateFragmentTranslation() {
}
`;
  device.pushErrorScope('validation');
  const start = performance.now();
  try {
    const shaderModule = device.createShaderModule({
      code: source,
      label: 'MaterialX generated fragment translator validation',
    });
    if (typeof shaderModule.compilationInfo === 'function') {
      const info = await shaderModule.compilationInfo();
      const errors = info.messages
        .filter(message => message.type === 'error')
        .map(message => message.message);
      if (errors.length) {
        throw new Error(errors.join('; '));
      }
    }

    const error = await device.popErrorScope();
    if (error) {
      throw error;
    }
    return performance.now() - start;
  } catch (error) {
    const scopedError = await device.popErrorScope().catch(() => null);
    const reportedError = scopedError || error;
    recordWebGpuError('fragment translator validation', reportedError);
    throw reportedError;
  }
}

function bindCanvasControls(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    viewState.isDragging = true;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!viewState.isDragging) return;
    const dx = event.clientX - viewState.lastX;
    const dy = event.clientY - viewState.lastY;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    viewState.yaw -= dx * 0.008;
    viewState.pitch = Math.max(-1.2, Math.min(1.2, viewState.pitch + dy * 0.008));
  });

  canvas.addEventListener('pointerup', (event) => {
    viewState.isDragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const scale = Math.exp(event.deltaY * 0.0012);
    viewState.distance = Math.max(0.95, Math.min(8, viewState.distance * scale));
  }, { passive: false });
}

function getCameraPosition() {
  const cosPitch = Math.cos(viewState.pitch);
  return [
    Math.sin(viewState.yaw) * cosPitch * viewState.distance,
    Math.sin(viewState.pitch) * viewState.distance,
    Math.cos(viewState.yaw) * cosPitch * viewState.distance,
  ];
}

function writeFrameUniforms(privateVertexData, privatePixelData, dimensions, envRadianceMipCount = 1) {
  const aspect = dimensions.width / dimensions.height;
  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  const model = createIdentityMatrix();
  const normal = createIdentityMatrix();
  const viewProjection = new Float32Array(16);
  const cameraPosition = getCameraPosition();

  perspective(projection, cameraFov, aspect, cameraNear, cameraFar);
  lookAt(view, cameraPosition, [0, 0, 0], [0, 1, 0]);
  multiplyMatrices(viewProjection, projection, view);

  privateVertexData.set(model, 0);
  privateVertexData.set(viewProjection, 16);
  privateVertexData.set(normal, 32);

  privatePixelData.bytes.fill(0);
  privatePixelData.floats.set([
    -1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -1, 0,
    0, 0, 0, 1,
  ], 0);
  privatePixelData.floats[16] = envLightIntensity;
  privatePixelData.ints[17] = envRadianceMipCount;
  privatePixelData.ints[18] = envRadianceSamples;
  privatePixelData.ints[19] = 0;
  privatePixelData.floats.set(cameraPosition, 20);
  privatePixelData.ints[23] = 1;
}

function createPrivatePixelUniformData() {
  const buffer = new ArrayBuffer(privatePixelByteLength);
  return {
    bytes: new Uint8Array(buffer),
    floats: new Float32Array(buffer),
    ints: new Int32Array(buffer),
  };
}

function createMaterialUniformData() {
  const buffer = new ArrayBuffer(publicUniformByteLength);
  return {
    bytes: new Uint8Array(buffer),
    floats: new Float32Array(buffer),
    ints: new Int32Array(buffer),
  };
}

function writeMaterialUniforms(publicUniformData, materialId) {
  const sample = materialSamples[materialId] || materialSamples.standard;
  publicUniformData.bytes.fill(0);

  for (const [name, value] of Object.entries(sample.ports)) {
    const port = materialUniformLayout.byName[name];
    if (!port) continue;

    const offset = port.byteOffset / Float32Array.BYTES_PER_ELEMENT;
    if (Array.isArray(value)) {
      publicUniformData.floats.set(value, offset);
    } else if (port.type === 'integer') {
      publicUniformData.ints[offset] = value ? 1 : 0;
    } else if (typeof value === 'boolean') {
      publicUniformData.floats[offset] = value ? 1 : 0;
    } else {
      publicUniformData.floats[offset] = value;
    }
  }

  return sample;
}

function updateQueryParam(name, value) {
  const nextUrl = new URL(document.location.href);
  nextUrl.searchParams.set(name, value);
  history.replaceState(null, '', nextUrl);
}

function bindShaderModeSelect(onModeChanged) {
  const select = document.getElementById('shader-mode');
  if (!select) {
    return {
      refresh: () => {},
    };
  }

  const refresh = () => {
    select.value = activeShaderMode;
  };

  select.addEventListener('change', () => {
    activeShaderMode = Object.hasOwn(shaderModeLabels, select.value) ? select.value : 'bridge';
    updateQueryParam('shader', activeShaderMode);
    const result = onModeChanged?.(activeShaderMode);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.warn('Shader mode update failed.', error);
        setMetric('shaderNotes', error?.message || String(error));
      });
    }
  });

  refresh();
  return {
    refresh,
  };
}

function bindEnvironmentControls() {
  const sampleSelect = document.getElementById('env-radiance-samples');
  const intensityInput = document.getElementById('env-light-intensity');

  if (sampleSelect) {
    sampleSelect.value = String(envRadianceSamples);
    sampleSelect.addEventListener('change', () => {
      const nextSamples = Number(sampleSelect.value);
      envRadianceSamples = Number.isFinite(nextSamples)
        ? Math.max(0, Math.min(16, Math.round(nextSamples)))
        : 4;
      sampleSelect.value = String(envRadianceSamples);
      updateQueryParam('envSamples', envRadianceSamples);
    });
  }

  if (intensityInput) {
    intensityInput.value = String(envLightIntensity);
    intensityInput.addEventListener('change', () => {
      const nextIntensity = Number(intensityInput.value);
      envLightIntensity = Number.isFinite(nextIntensity)
        ? Math.max(0, Math.min(8, nextIntensity))
        : 1;
      intensityInput.value = String(envLightIntensity);
      updateQueryParam('envIntensity', envLightIntensity);
    });
  }
}

async function fetchTextResource(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} unavailable (${response.status}). Run npm run spike:naga, then npm run build or refresh the dev server.`);
  }
  return response.text();
}

function encodeNagaFragmentOutput(source) {
  const pattern = /(\n\s*)return FragmentOutput\(([^)]+)\);(\n\})\s*$/;
  const adapted = source.replace(pattern, (match, indent, outputExpression, suffix) => {
    const output = outputExpression.trim();
    return `${indent}let mxv_encodedOutput = vec4<f32>(mx_srgb_encode(max(${output}.rgb, vec3<f32>(0.0))), ${output}.a);${indent}return FragmentOutput(mxv_encodedOutput);${suffix}`;
  });

  if (adapted === source) {
    throw new Error('Naga fragment output shape changed; could not apply display encoding.');
  }

  return adapted;
}

async function loadNagaShaderPair(materialId) {
  const sampleId = Object.hasOwn(materialSamples, materialId) ? materialId : 'standard';
  const baseUrl = new URL(`${encodeURIComponent(sampleId)}/`, nagaShaderBaseUrl);
  const [vertexSource, rawFragmentSource] = await Promise.all([
    fetchTextResource(new URL('vertex.wgsl', baseUrl), `${sampleId} Naga vertex WGSL`),
    fetchTextResource(new URL('pixel.wgsl', baseUrl), `${sampleId} Naga pixel WGSL`),
  ]);
  const fragmentSource = encodeNagaFragmentOutput(rawFragmentSource);

  return {
    fragmentLineCount: fragmentSource.split('\n').length,
    fragmentSource,
    sampleId,
    vertexLineCount: vertexSource.split('\n').length,
    vertexSource,
  };
}

async function createNagaPipeline(device, format, materialId) {
  const loadStart = performance.now();
  const loaded = await loadNagaShaderPair(materialId);
  setMetric('shaderSource', `Naga ${loaded.vertexLineCount}v / ${loaded.fragmentLineCount}p lines`);

  const pipeline = await createPipeline(device, format, {
    fragmentEntryPoint: 'main',
    fragmentSource: loaded.fragmentSource,
    label: `Direct WebGPU Naga ${loaded.sampleId} shader`,
    vertexEntryPoint: 'main',
    vertexSource: loaded.vertexSource,
  });

  setMetric('shaderTarget', 'Naga WGSL');
  setMetric('vertexAdapter', `Naga ${loaded.vertexLineCount} WGSL lines`);
  setMetric('fragmentAdapter', `Naga ${loaded.fragmentLineCount} WGSL lines`);
  setMetric('fragmentTranslator', `Naga fixture / ${formatDuration(performance.now() - loadStart)}`);
  setMetric('shaderNotes', materialXKnownWarnings.size ? 'bool uniform mapped / Naga translated' : 'Naga translated');
  return pipeline;
}

function updateBridgeShaderMetrics(sample) {
  if (!sample || sample.source !== 'shadergen') {
    setMetric('shaderTarget', 'Wgsl bridge');
    setMetric('shaderSource', 'bridge fallback');
    setMetric('fragmentAdapter', 'bridge fallback');
    setMetric('fragmentTranslator', 'bridge fallback');
    return;
  }

  setMetric('shaderTarget', sample.target || 'genglsl');
  setMetric('shaderSource', `${sample.vertexLines}v / ${sample.pixelLines}p lines`);
  setMetric('fragmentAdapter', `${sample.pixelContract.portedHelperCount}/${sample.pixelContract.functionCount} funcs / ${sample.pixelContract.standardSurfaceParameterCount} params`);
  setMetric('fragmentTranslator', `${sample.pixelContract.translatedFragment.translatedCount}/${sample.pixelContract.translatedFragment.requestedCount} translated`);
  setMetric('shaderNotes', materialXKnownWarnings.size ? 'bool uniform mapped' : 'none');
}

function bindMaterialSelect(device, publicUniformBuffer, publicUniformData, options = {}) {
  const { onMaterialApplied = null } = options;
  const select = document.getElementById('material-sample');
  if (!select) {
    return {
      applyMaterial: () => {},
      refreshOptions: () => {},
    };
  }

  const refreshOptions = () => {
    select.innerHTML = Object.entries(materialSamples)
      .map(([id, sample]) => `<option value="${id}">${sample.label}</option>`)
      .join('');
    select.value = activeMaterialId;
  };

  const applyMaterial = (materialId, options = {}) => {
    const {
      measure = false,
      updateUrl = true,
    } = options;
    const uploadStart = performance.now();
    activeMaterialId = materialId;
    const sample = writeMaterialUniforms(publicUniformData, activeMaterialId);
    device.queue.writeBuffer(publicUniformBuffer, 0, publicUniformData.bytes);
    setMetric('materialUpload', formatDuration(performance.now() - uploadStart));
    setMetric('material', `${sample.label} (${sample.source})`);
    const callbackResult = onMaterialApplied?.(activeMaterialId, sample, options);
    if (callbackResult && typeof callbackResult.catch === 'function') {
      callbackResult.catch((error) => {
        console.warn('Material pipeline update failed.', error);
        setMetric('shaderNotes', error?.message || String(error));
      });
    }

    if (measure) {
      pendingMaterialSwitch = {
        id: ++materialSwitchId,
        start: uploadStart,
      };
    }

    if (updateUrl) {
      updateQueryParam('material', activeMaterialId);
    }
  };

  const runBenchmark = () => {
    const button = document.querySelector('[data-benchmark-switches]');
    const materialIds = Object.keys(materialSamples);
    const totalSwitches = 12;
    let switchIndex = 0;

    window.clearTimeout(materialBenchmarkTimer);
    materialSwitchSamples.length = 0;
    setMetric('materialSwitchAverage', '-');
    setMetric('materialSwitchP95', '-');
    if (button) button.disabled = true;
    setStatus('Benchmarking material switches');

    const step = () => {
      const materialId = materialIds[switchIndex % materialIds.length];
      select.value = materialId;
      applyMaterial(materialId, { measure: true, updateUrl: false });
      switchIndex++;

      if (switchIndex < totalSwitches) {
        materialBenchmarkTimer = window.setTimeout(step, 180);
        return;
      }

      if (button) button.disabled = false;
      setStatus('Ready');
    };

    step();
  };

  select.addEventListener('change', () => applyMaterial(select.value, { measure: true }));
  document.querySelector('[data-benchmark-switches]')?.addEventListener('click', runBenchmark);
  refreshOptions();
  applyMaterial(activeMaterialId, { updateUrl: false });

  return {
    applyMaterial,
    refreshOptions,
  };
}

function createFpsMeter() {
  let frameCount = 0;
  let lastTime = performance.now();
  let lastFrameTime = 0;
  const frameTimes = [];

  return function updateFps(now) {
    if (lastFrameTime) {
      frameTimes.push(now - lastFrameTime);
      if (frameTimes.length > 180) frameTimes.shift();
    }
    lastFrameTime = now;

    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed < 500) return;

    const fps = Math.round(frameCount * 1000 / elapsed);
    setText('[data-fps]', `${fps} fps`);

    if (frameTimes.length) {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const average = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      setMetric('frameAverage', `${average.toFixed(1)} ms`);
      setMetric('frameP95', `${p95.toFixed(1)} ms`);
    }

    frameCount = 0;
    lastTime = now;
  };
}

function createDirectBindGroup(device, pipeline, resources) {
  return device.createBindGroup({
    entries: [
      {
        binding: 0,
        resource: { buffer: resources.privateVertexBuffer },
      },
      {
        binding: 1,
        resource: { buffer: resources.privatePixelBuffer },
      },
      {
        binding: 2,
        resource: resources.envRadianceTexture.createView(),
      },
      {
        binding: 3,
        resource: resources.envSampler,
      },
      {
        binding: 4,
        resource: resources.envIrradianceTexture.createView(),
      },
      {
        binding: 5,
        resource: resources.envSampler,
      },
      {
        binding: 6,
        resource: { buffer: resources.publicUniformBuffer },
      },
      {
        binding: 7,
        resource: { buffer: resources.lightDataBuffer },
      },
    ],
    layout: pipeline.getBindGroupLayout(0),
  });
}

async function main() {
  const canvas = document.getElementById('direct-webgpu-canvas');
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not create a WebGPU canvas context.');
  }

  setStatus('Requesting WebGPU device');
  const { device } = await createDevice();
  installWebGpuErrorReporting(device);
  const format = navigator.gpu.getPreferredCanvasFormat();
  let dimensions = configureCanvas(canvas, device, context, format);
  let depthTexture = createDepthTexture(device, dimensions);
  let bridgeShaderSource = shaderSource;
  let pipeline = await createPipeline(device, format);

  const meshStart = performance.now();
  const geometry = await loadGeometry();
  const vertexBuffer = createBuffer(device, 'Shaderball vertices', geometry.vertices, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(device, 'Shaderball indices', geometry.indices, GPUBufferUsage.INDEX);
  setMetric('model', geometry.label);
  recordDuration('modelLoad', meshStart);
  setMetric('mesh', `${geometry.indices.length / 3} triangles`);
  const environmentTextures = await createEnvironmentTextures(device);

  const privateVertexData = new Float32Array(privateVertexFloatCount);
  const privatePixelData = createPrivatePixelUniformData();
  const publicUniformData = createMaterialUniformData();
  const lightData = new Float32Array(lightDataFloatCount);
  lightData.set([0.45, -0.8, -0.35, 0], 0);
  const privateVertexBuffer = createUniformBuffer(device, 'MaterialX PrivateUniforms vertex', privateVertexData);
  const privatePixelBuffer = createUniformBuffer(device, 'MaterialX PrivateUniforms pixel', privatePixelData.bytes);
  const publicUniformBuffer = createUniformBuffer(device, 'MaterialX PublicUniforms pixel port table', publicUniformData.bytes);
  const lightDataBuffer = createUniformBuffer(device, 'MaterialX LightData pixel placeholder', lightData);
  const envSampler = device.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  device.queue.writeBuffer(lightDataBuffer, 0, lightData);
  setMetric('contract', `bindings 0-7 / private ${privatePixelByteLength} B`);
  const bindGroupResources = {
    ...environmentTextures,
    envSampler,
    lightDataBuffer,
    privatePixelBuffer,
    privateVertexBuffer,
    publicUniformBuffer,
  };
  let bindGroup = createDirectBindGroup(device, pipeline, bindGroupResources);
  let pipelineSwitchId = 0;
  bindEnvironmentControls();
  const applyPipelineForShaderMode = async (materialId, options = {}) => {
    const switchId = ++pipelineSwitchId;
    const material = materialSamples[materialId] || materialSamples.standard;
    if (options.requireShadergen && material?.source !== 'shadergen') return;

    setStatus(activeShaderMode === 'naga' ? 'Loading Naga WGSL shader' : 'Loading bridge shader');
    let nextPipeline;
    if (activeShaderMode === 'naga') {
      nextPipeline = await createNagaPipeline(device, format, materialId);
    } else {
      nextPipeline = await createPipeline(device, format, {
        label: 'Direct WebGPU generated vertex bridge shader',
        source: bridgeShaderSource,
      });
      updateBridgeShaderMetrics(material);
    }
    if (switchId !== pipelineSwitchId) return;

    pipeline = nextPipeline;
    bindGroup = createDirectBindGroup(device, pipeline, bindGroupResources);
    setStatus('Ready');
  };
  bindShaderModeSelect(() => applyPipelineForShaderMode(activeMaterialId, { requireShadergen: activeShaderMode === 'naga' }));
  const materialControl = bindMaterialSelect(device, publicUniformBuffer, publicUniformData, {
    onMaterialApplied: (materialId, sample, options = {}) => {
      if (activeShaderMode !== 'naga' || sample.source !== 'shadergen') return null;
      return applyPipelineForShaderMode(materialId, {
        requireShadergen: true,
        switchReason: options.measure ? 'material' : 'refresh',
      });
    },
  });
  const pipelineControl = {
    applyGeneratedVertexSource: async (generatedVertexSource) => {
      const adapterStart = performance.now();
      const adapted = adaptGeneratedVertexSource(generatedVertexSource);
      const adapterDuration = performance.now() - adapterStart;
      bridgeShaderSource = adapted.shaderSource;
      if (activeShaderMode === 'bridge') {
        pipeline = await createPipeline(device, format, {
          label: 'Direct WebGPU generated vertex bridge shader',
          source: bridgeShaderSource,
        });
        bindGroup = createDirectBindGroup(device, pipeline, bindGroupResources);
      }
      setMetric('vertexAdapter', `${adapted.lineCount} GLSL -> WGSL / ${formatDuration(adapterDuration)}`);
    },
    validateGeneratedFragmentTranslation: generatedFragmentWgsl => validateGeneratedFragmentTranslation(device, generatedFragmentWgsl),
  };

  initializeMaterialXShaderSupport(materialControl, pipelineControl).catch((error) => {
    console.error(error);
    setStatus('Shadergen fallback active');
  });

  bindCanvasControls(canvas);
  window.addEventListener('resize', () => {
    dimensions = configureCanvas(canvas, device, context, format);
    depthTexture.destroy();
    depthTexture = createDepthTexture(device, dimensions);
  });

  const updateFps = createFpsMeter();
  let firstFrameRecorded = false;
  setStatus('Ready');

  function render(now) {
    writeFrameUniforms(privateVertexData, privatePixelData, dimensions, environmentTextures.envRadianceMipCount);
    device.queue.writeBuffer(privateVertexBuffer, 0, privateVertexData);
    device.queue.writeBuffer(privatePixelBuffer, 0, privatePixelData.bytes);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 1, b: 0.08, g: 0.07, r: 0.06 },
          loadOp: 'clear',
          storeOp: 'store',
          view: context.getCurrentTexture().createView(),
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        view: depthTexture.createView(),
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint32');
    pass.drawIndexed(geometry.indices.length);
    pass.end();
    device.queue.submit([encoder.finish()]);

    if (pendingMaterialSwitch) {
      const materialSwitch = pendingMaterialSwitch;
      pendingMaterialSwitch = null;
      const frameDuration = performance.now() - materialSwitch.start;
      setMetric('materialSwitchFrame', formatDuration(frameDuration));

      device.queue.onSubmittedWorkDone().then(() => {
        if (materialSwitch.id < materialSwitchId) return;
        const gpuDuration = performance.now() - materialSwitch.start;
        setMetric('materialSwitchGpu', formatDuration(gpuDuration));
        recordMaterialSwitchSample(gpuDuration);
      }).catch((error) => {
        console.warn('Material switch timing failed.', error);
      });
    }

    if (!firstFrameRecorded) {
      firstFrameRecorded = true;
      setMetric('firstFrame', formatDuration(now - appStartTime));
    }
    updateFps(now);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

window.addEventListener('load', () => {
  main().catch((error) => {
    console.error(error);
    setStatus('Failed');
    setMetric('renderer', error?.message || String(error));
  });
});
