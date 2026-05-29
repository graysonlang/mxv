// This import+export makes sure webgpu-direct.html is copied to dist and the
// import is not stripped out during bundling.
import index from './webgpu-direct.html';
import { Box3, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { translateMaterialXFragmentGlsl } from '../src/materialx-glsl-translator.js';
import { materialSamples as materialSampleSources } from '../src/materialx-samples.js';
import {
  createMaterialPropertyModel,
  renderMaterialPropertiesPanel,
  setMaterialPropertyValue,
  summarizeMaterialPropertySupport,
} from './material-properties.js';
import { loadAssetManifest } from '../src/index.js';
import { createNagaTranslator, nagaVersion } from '@graysonlang/naga';

export function getFilePaths() {
  return { index };
}

const defaultGeometry = 'vendor/MaterialX/resources/Geometry/shaderball.glb';
const defaultEnvironment = 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.hdr';
const defaultLightRig = 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.mtlx';
const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);
const nagaRuntimeBaseUrl = new URL('./vendor/naga-runtime/', import.meta.url);
const nagaShaderBaseUrl = new URL('./vendor/naga-materialx/', import.meta.url);
const appStartTime = performance.now();
const cameraFovDegrees = 60;
const cameraFov = cameraFovDegrees * Math.PI / 180;
const cameraNear = 0.05;
const cameraFar = 100;
const sphereRadius = 0.8;
const initialDistance = sphereRadius * 3.2;
const maxPixelRatio = 2;
const depthFormat = 'depth24plus';
const queryParams = new URLSearchParams(document.location.search);
const shaderModeLabels = {
  bridge: 'Bridge',
  naga: 'Naga WGSL',
};
const rendererModeLabels = {
  auto: 'Auto',
  direct: 'Direct WebGPU',
  webgl: 'WebGL fallback',
};
const requestedShaderMode = queryParams.get('shader') || queryParams.get('shaderMode');
let activeShaderMode = Object.hasOwn(shaderModeLabels, requestedShaderMode) ? requestedShaderMode : 'naga';
const requestedRendererMode = (queryParams.get('renderer') || queryParams.get('renderMode') || 'auto').toLowerCase();
let activeRendererMode = Object.hasOwn(rendererModeLabels, requestedRendererMode) ? requestedRendererMode : 'auto';
const requestedMaterialSettings = queryParams.get('settings');
const defaultEnvRadianceSamples = Number(queryParams.get('envSamples') || queryParams.get('samples') || 4);
const defaultEnvLightIntensity = Number(queryParams.get('envIntensity') || 1);
const defaultDrawEnvironment = parseBooleanQueryParam(
  queryParams.get('drawEnvironment') || queryParams.get('envBackground'),
  false,
);
const defaultDirectLightEnabled = parseBooleanQueryParam(queryParams.get('directLight'), true);
const defaultEnvironmentToneMode = getRequestedEnvironmentToneMode();
const defaultEnvironmentToneDebugEnabled = parseBooleanQueryParam(
  queryParams.get('envToneDebug') || queryParams.get('toneDebug'),
  false,
);
let envRadianceSamples = Number.isFinite(defaultEnvRadianceSamples)
  ? Math.max(0, Math.min(16, Math.round(defaultEnvRadianceSamples)))
  : 4;
let envLightIntensity = Number.isFinite(defaultEnvLightIntensity)
  ? Math.max(0, Math.min(8, defaultEnvLightIntensity))
  : 1;
let drawEnvironment = defaultDrawEnvironment;
let directLightEnabled = defaultDirectLightEnabled;
let adaptiveEnvironmentToneEnabled = defaultEnvironmentToneMode === 'adaptive';
let environmentToneDebugEnabled = defaultEnvironmentToneDebugEnabled;
const privateVertexFloatCount = 48;
const privatePixelByteLength = 96;
const maxPublicUniformByteLength = 4096;
const environmentBackgroundFloatCount = 20;
const lightDataByteLength = 48;
const vertexStrideFloats = 11;
const environmentToneSampleCount = 89;
const environmentToneGoldenAngle = Math.PI * (3 - Math.sqrt(5));
const environmentToneMapWidth = 128;
const environmentToneMapHeight = 64;
const environmentToneBlurPasses = 2;
const environmentToneTargetReference = 0.1;
const environmentToneMaxExposure = 32;
const environmentToneMaxBrightenExposure = 4;
const environmentToneDimPlateauStops = 0.2;
const environmentToneDimKneeStops = 0.75;
const environmentToneBrightenPlateauStops = 1.25;
const environmentToneBrightenKneeStops = 2.0;
const environmentToneHighlightStartStops = 1.5;
const environmentToneHighlightEndStops = 3.0;
const environmentToneHighlightMaskStart = 0.75;
const environmentToneHighlightMaskEnd = 2.0;
const environmentToneLogLuminanceFloor = 0.00001;
const environmentToneReferenceTrimLow = 0.2;
const environmentToneReferenceTrimHigh = 0.8;
let activeDirectLight = {
  color: [1, 0.894474, 0.567234],
  direction: [0.514434, -0.479014, -0.711269],
  intensity: 2.52776,
  type: 1,
};
let activeLightRigPath = '';
let activeEnvironmentToneSource = null;
let activeEnvironmentToneStats = null;
let activeEnvironmentToneDebugImageData = null;
let environmentToneLastMetricTime = 0;
const materialXBoolUniformWarning = 'WGSL does not allow boolean types to be stored in uniform or storage address spaces.';
const materialXKnownWarnings = new Set();
let nagaTranslatorPromise;
const webGpuErrors = [];
let fallbackRouting = false;
if (typeof window !== 'undefined') {
  window.__mxvWebGpuErrors = webGpuErrors;
}
let environmentFilename = getRequestedEnvironmentPath();
let materialXResourcePaths = [];

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
  woodTiled: {
    label: 'Tiled Wood',
    ports: {
      ...baseMaterialPorts,
      baseColor: [0.72, 0.48, 0.28],
      coat: 0.1,
      coatAnisotropy: 0.5,
      coatRoughness: 0.2,
      specular: 0.4,
      specularAnisotropy: 0.5,
      specularRoughness: 0.32,
    },
  },
  brassTiled: {
    label: 'Tiled Brass',
    ports: {
      ...baseMaterialPorts,
      baseColor: [1, 1, 1],
      coat: 1,
      coatColor: [0.85, 0.64, 0.36],
      coatRoughness: 0.2,
      metalness: 1,
      specular: 0,
      specularRoughness: 0.2,
    },
  },
};
let materialSamples = createFallbackMaterialSamples();
const requestedMaterial = queryParams.get('material');
let activeMaterialId = Object.hasOwn(materialSamples, requestedMaterial) ? requestedMaterial : 'standard';
let materialSettingsDefaults = createMaterialSettingsDefaults(materialSamples);
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

struct LightData {
  direction: vec3<f32>,
  color: vec3<f32>,
  light_type: i32,
  intensity: f32,
};

struct LightDataPixel {
  u_lightData: array<LightData, 1>,
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

const environmentBackgroundSource = `
struct EnvironmentBackgroundUniforms {
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  params: vec4<f32>,
  toneParams: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u_background: EnvironmentBackgroundUniforms;
@group(0) @binding(1) var u_envRadianceTexture: texture_2d<f32>;
@group(0) @binding(2) var u_envRadianceSampler: sampler;

struct BackgroundVertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> BackgroundVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let position = positions[vertexIndex];
  var output: BackgroundVertexOutput;
  output.clipPosition = vec4<f32>(position, 0.0, 1.0);
  output.ndc = position;
  return output;
}

fn mx_srgb_encode(linearColor: vec3<f32>) -> vec3<f32> {
  let lo = linearColor * 12.92;
  let hi = pow(linearColor, vec3<f32>(1.0 / 2.4)) * 1.055 - vec3<f32>(0.055);
  return select(hi, lo, linearColor <= vec3<f32>(0.0031308));
}

fn mx_aces_tonemap(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + vec3<f32>(b))) / (color * (c * color + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn mx_latlong_uv(direction: vec3<f32>) -> vec2<f32> {
  let normalizedDirection = normalize(direction);
  let u = atan2(normalizedDirection.x, -normalizedDirection.z) * 0.15915494309189535 + 0.5;
  let v = acos(clamp(normalizedDirection.y, -1.0, 1.0)) * 0.3183098861837907;
  return vec2<f32>(u, v);
}

@fragment
fn fragmentMain(input: BackgroundVertexOutput) -> @location(0) vec4<f32> {
  let aspect = u_background.params.x;
  let tanHalfFov = u_background.params.y;
  let intensity = u_background.params.z;
  let adaptiveExposure = u_background.toneParams.x;
  let exposureStrength = clamp(u_background.toneParams.y, 0.0, 1.0);
  let highlightStrength = clamp(u_background.toneParams.z, 0.0, 1.0);
  let direction = normalize(
    u_background.cameraForward.xyz +
    u_background.cameraRight.xyz * input.ndc.x * aspect * tanHalfFov +
    u_background.cameraUp.xyz * input.ndc.y * tanHalfFov
  );
  let uv = mx_latlong_uv(direction);
  let rotatedUv = vec2<f32>(fract(uv.x + 0.5), uv.y);
  let color = textureSampleLevel(u_envRadianceTexture, u_envRadianceSampler, rotatedUv, 0.0).rgb * intensity;
  var displayColor = max(color, vec3<f32>(0.0));
  let highlightValue = max(max(displayColor.r, displayColor.g), displayColor.b);
  let highlightMask = smoothstep(${environmentToneHighlightMaskStart.toFixed(2)}, ${environmentToneHighlightMaskEnd.toFixed(2)}, highlightValue);
  let adaptiveStrength = max(exposureStrength, highlightStrength * highlightMask);
  if (adaptiveExposure > 0.0 && adaptiveStrength > 0.0) {
    let adaptedDisplayColor = mx_aces_tonemap(displayColor * adaptiveExposure);
    displayColor = mix(displayColor, adaptedDisplayColor, adaptiveStrength);
  }
  return vec4<f32>(mx_srgb_encode(displayColor), 1.0);
}
`;

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

function isWebGpuProbeAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

function describeFallbackStatus(detail = '') {
  const probeStatus = isWebGpuProbeAvailable() ? 'WebGPU probe available' : 'WebGPU probe missing';
  if (activeRendererMode === 'webgl') {
    return detail || `forced WebGL fallback / ${probeStatus}`;
  }
  if (activeRendererMode === 'direct') {
    return detail || `disabled by Direct WebGPU override / ${probeStatus}`;
  }
  return detail || `auto route on startup failure / ${probeStatus}`;
}

function updateFallbackStatus(detail) {
  setMetric('fallback', describeFallbackStatus(detail));
}

function buildWebGlFallbackUrl(reason = 'manual') {
  const fallbackUrl = new URL('./webgl.html', document.location.href);
  const currentParams = new URLSearchParams(document.location.search);
  const material = currentParams.get('material') || currentParams.get('materials') || currentParams.get('file');
  const geometry = currentParams.get('model') || currentParams.get('geom');
  const environment = currentParams.get('environment') || currentParams.get('env');

  if (material) fallbackUrl.searchParams.set('material', material);
  if (geometry) fallbackUrl.searchParams.set('model', geometry);
  if (environment) fallbackUrl.searchParams.set('environment', environment);
  fallbackUrl.searchParams.set('fallback', 'direct-webgpu');
  fallbackUrl.searchParams.set('fallbackReason', reason);
  return fallbackUrl;
}

function routeToWebGlFallback(reason = 'manual') {
  if (fallbackRouting) return true;
  fallbackRouting = true;
  const reasonText = reason?.message || String(reason || 'manual');
  updateFallbackStatus(`opening WebGL fallback / ${reasonText}`);
  setStatus('Opening WebGL fallback');

  if (window.parent && window.parent !== window) {
    try {
      window.parent.location.hash = '#webgl';
      return true;
    } catch (error) {
      console.warn('Could not switch parent viewer mode, navigating directly.', error);
    }
  }

  window.location.assign(buildWebGlFallbackUrl(reasonText));
  return true;
}

function handleDirectStartupError(error) {
  console.error(error);
  if (activeRendererMode === 'auto') {
    routeToWebGlFallback(error?.message || 'Direct WebGPU startup failed');
    return;
  }

  setStatus('Failed');
  setMetric('renderer', error?.message || String(error));
  updateFallbackStatus(activeRendererMode === 'direct'
    ? 'fallback disabled / Direct WebGPU forced'
    : 'startup failed');
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

function parseBooleanQueryParam(value, fallback = false) {
  if (value == null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function getRequestedEnvironmentToneMode() {
  const requested = (queryParams.get('envTone') || queryParams.get('backgroundTone') || '').toLowerCase();
  if (['adaptive', 'auto'].includes(requested)) return 'adaptive';
  if (['linear', 'manual', 'off', 'none'].includes(requested)) return 'linear';
  return parseBooleanQueryParam(queryParams.get('adaptiveEnvTone') || queryParams.get('adaptiveTone'), false)
    ? 'adaptive'
    : 'linear';
}

function getRequestedEnvironmentPath() {
  return queryParams.get('environment') || queryParams.get('env') || defaultEnvironment;
}

function getUniformTypeLayout(type) {
  if (type === 'vector2') {
    return {
      align: 8,
      size: 8,
      wgsl: 'vec2<f32>',
    };
  }

  if (type === 'color3' || type === 'vector3') {
    return {
      align: 16,
      size: 12,
      wgsl: 'vec3<f32>',
    };
  }

  if (type === 'integer' || type === 'string') {
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

function createMaterialUniformLayoutFromPorts(generatedPorts) {
  const ports = generatedPorts
    .filter(port => port.type !== 'filename')
    .map((port, index) => ({
      field: port.variable,
      index,
      name: normalizeMaterialVariableName(port.variable),
      sourceType: port.type,
      type: port.type === 'string' ? 'integer' : port.type,
    }));
  let offset = 0;
  const byName = {};
  const byField = {};

  for (const port of ports) {
    const layout = getUniformTypeLayout(port.type);
    offset = alignTo(offset, layout.align);
    Object.assign(port, {
      byteOffset: offset,
      wgsl: layout.wgsl,
    });
    byName[port.name] = port;
    byField[port.field] = port;
    offset += layout.size;
  }

  return {
    byField,
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
  let light = u_lightData.u_lightData[0];
  return LightShader(light.color * light.intensity, normalize(-light.direction));
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

function loadNagaTranslator() {
  nagaTranslatorPromise ??= createNagaTranslator({
    wasmUrl: new URL('graysonlang_naga.wasm', nagaRuntimeBaseUrl).href,
  });
  return nagaTranslatorPromise;
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

  if (type === 'color3' || type === 'vector2' || type === 'vector3') {
    return normalized.split(',').map(component => Number(component.trim()));
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractLightDataBinding(source) {
  const match = /layout\s*\(\s*std140\s*,\s*binding\s*=\s*(\d+)\s*\)\s*uniform\s+LightData_pixel/.exec(source);
  return match ? Number(match[1]) : 7;
}

function extractTextureBindings(source, generatedPorts) {
  const filenamePorts = new Map(
    generatedPorts
      .filter(port => port.type === 'filename')
      .map(port => [port.variable, port]),
  );
  const samplerBindings = new Map(
    [...source.matchAll(/layout\s*\(\s*binding\s*=\s*(\d+)\s*\)\s*uniform\s+sampler\s+(\w+)_sampler\s*;/g)]
      .map(match => [match[2], Number(match[1])]),
  );

  return [...source.matchAll(/layout\s*\(\s*binding\s*=\s*(\d+)\s*\)\s*uniform\s+texture2D\s+(\w+)_texture\s*;/g)]
    .map((match) => {
      const name = match[2];
      const port = filenamePorts.get(name);
      if (!port) return null;
      return {
        label: name.replace(/_file$/, '').replace(/_/g, ' '),
        path: port.value || '',
        samplerBinding: samplerBindings.get(name),
        textureBinding: Number(match[1]),
        variable: name,
      };
    })
    .filter(binding => binding && Number.isFinite(binding.samplerBinding));
}

function createGeneratedUniformValues(generatedPorts) {
  const values = {};
  for (const port of generatedPorts) {
    if (port.type === 'filename') continue;
    const parsedValue = parseMaterialValue(port.type, port.value);
    values[port.variable] = parsedValue ?? 0;
  }
  return values;
}

function getMaterialXVector(valueElement) {
  const data = valueElement?.getValue?.()?.getData?.();
  if (!data) return null;

  if (typeof data.data === 'function') {
    return Array.from(data.data()).slice(0, 3);
  }

  if (Array.isArray(data)) {
    return data.slice(0, 3);
  }

  return null;
}

function getMaterialXFloat(valueElement, fallback = 0) {
  const data = valueElement?.getValue?.()?.getData?.();
  return Number.isFinite(Number(data)) ? Number(data) : fallback;
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

function registerMaterialXLights(mx, lights, context) {
  mx.HwShaderGenerator.unbindLightShaders(context);

  const lightTypeIds = new Map();
  const lightData = [];
  let nextLightTypeId = 1;

  for (const light of lights) {
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

async function importMaterialXLightRig(mx, document, context, lightRigXml) {
  if (!lightRigXml) return [];

  const lightDocument = mx.createDocument();
  await mx.readFromXmlString(lightDocument, lightRigXml);
  document.importLibrary(lightDocument);

  const lights = findMaterialXLights(document);
  return registerMaterialXLights(mx, lights, context);
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

async function generateMaterialSample(mx, sampleId, lightRigXml, nagaTranslator) {
  if (!mx.WgslShaderGenerator) {
    throw new Error('MaterialX runtime does not expose WgslShaderGenerator.');
  }
  if (!mx.HwShaderGenerator) {
    throw new Error('MaterialX runtime does not expose HwShaderGenerator light registration.');
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
  const lightData = await importMaterialXLightRig(mx, document, context, lightRigXml);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error(`No renderable MaterialX element found for sample "${sampleId}".`);
  }

  const shader = generator.generate(element.getNamePath(), element, context);
  const vertexSource = shader.getSourceCode('vertex');
  const pixelSource = shader.getSourceCode('pixel');
  const translationStart = performance.now();
  const [translatedVertex, translatedPixel] = [
    nagaTranslator.translateMaterialXGlslToWgsl(vertexSource, { stage: 'vertex' }),
    nagaTranslator.translateMaterialXGlslToWgsl(pixelSource, { stage: 'fragment' }),
  ];
  const fragmentSource = encodeNagaFragmentOutput(translatedPixel.wgsl);
  const translationDuration = performance.now() - translationStart;
  const pixelStage = shader.getStage('pixel');
  const uniformBlocks = pixelStage.getUniformBlocks();
  const publicUniforms = uniformBlocks.PublicUniforms;
  const privateUniforms = uniformBlocks.PrivateUniforms;
  const ports = clonePorts(fallback.ports);
  const generatedPorts = getBlockPorts(publicUniforms);
  const textureBindings = extractTextureBindings(pixelSource, generatedPorts);
  const bridgeCompatible = textureBindings.length === 0;
  if (bridgeCompatible) {
    validateGeneratedPublicUniforms(generatedPorts, sampleId);
  }
  const privateUniformCount = validateGeneratedPrivateUniforms(getBlockPorts(privateUniforms), sampleId);
  const uniformLayout = createMaterialUniformLayoutFromPorts(generatedPorts);
  const uniformValues = createGeneratedUniformValues(generatedPorts);

  for (const port of generatedPorts) {
    const name = normalizeMaterialVariableName(port.variable);
    if (materialPortIndex[name] === undefined) continue;

    const parsedValue = parseMaterialValue(port.type, port.value);
    if (parsedValue !== null) ports[name] = parsedValue;
  }

  const pixelContract = bridgeCompatible
    ? validateGeneratedPixelSource(pixelSource, sampleId)
    : null;
  return {
    bridgeCompatible,
    label: fallback.label,
    lightData,
    lightDataBinding: extractLightDataBinding(pixelSource),
    ports,
    renderable: element.getNamePath(),
    source: 'shadergen',
    target: typeof generator.getTarget === 'function' ? generator.getTarget() : 'unknown',
    pixelContract,
    privateUniformCount,
    naga: {
      fragmentLineCount: fragmentSource.split('\n').length,
      fragmentSource,
      source: 'runtime',
      translationDuration,
      vertexLineCount: translatedVertex.wgsl.split('\n').length,
      vertexSource: translatedVertex.wgsl,
    },
    textureBindings,
    uniformCount: uniformLayout.ports.length,
    uniformLayout,
    uniformValues,
    usesTexcoord: /layout\s*\(\s*location\s*=\s*1\s*\)\s*in\s+vec2\s+i_texcoord_0/.test(vertexSource),
    vertexSource,
    vertexLines: vertexSource.split('\n').length,
    pixelLines: pixelSource.split('\n').length,
  };
}

async function initializeMaterialXShaderSupport(materialControl, pipelineControl = {}) {
  try {
    setStatus('Loading MaterialX shadergen and Naga');
    const materialXStart = performance.now();
    const [mx, lightRigXml, nagaTranslator] = await Promise.all([
      loadMaterialX(),
      fetchTextResource(defaultLightRig, 'Default light rig'),
      loadNagaTranslator(),
    ]);
    recordDuration('materialXLoad', materialXStart);

    setStatus('Generating MaterialX shader contract');
    const shaderStart = performance.now();
    const generatedEntries = [];
    for (const sampleId of Object.keys(materialSampleSources)) {
      generatedEntries.push([sampleId, await generateMaterialSample(mx, sampleId, lightRigXml, nagaTranslator)]);
    }

    materialSamples = Object.fromEntries(generatedEntries);
    resetMaterialSettingsDefaults(materialSamples);
    const activeSample = materialSamples[activeMaterialId] || generatedEntries[0]?.[1];
    if (activeSample?.lightData?.[0] && !activeLightRigPath) {
      activeDirectLight = activeSample.lightData[0];
      pipelineControl.updateLightData?.(activeDirectLight);
      setMetric('directLight', describeDirectLight(activeDirectLight));
    }
    recordDuration('shaderGeneration', shaderStart);
    setMetric('shaderTarget', activeSample?.target || '-');
    setMetric('shaderContract', activeSample ? `${activeSample.uniformCount} public ports / ${activeSample.uniformLayout?.byteLength || publicUniformByteLength} B` : '-');
    setMetric('contract', activeSample ? describeBindingContract(activeSample) : '-');
    setMetric('shaderSource', activeSample ? `${activeSample.vertexLines}v / ${activeSample.pixelLines}p lines` : '-');
    setMetric('fragmentAdapter', activeSample?.pixelContract ? `${activeSample.pixelContract.portedHelperCount}/${activeSample.pixelContract.functionCount} funcs / ${activeSample.pixelContract.standardSurfaceParameterCount} params` : 'Naga-only texture graph');
    setMetric('fragmentTranslator', activeSample?.pixelContract ? `${activeSample.pixelContract.translatedFragment.translatedCount} translated / ${activeSample.pixelContract.translatedFragment.requestedCount} requested` : 'Naga-only texture graph');
    setMetric('shaderNotes', materialXKnownWarnings.size ? 'bool uniform mapped' : 'none');
    materialControl.refreshOptions();
    const initialApplyResult = materialControl.applyMaterial(activeMaterialId, { updateUrl: false });
    if (initialApplyResult && typeof initialApplyResult.then === 'function') {
      await initialApplyResult;
    }
    const settingsApplyResult = pipelineControl.applyInitialMaterialSettings?.();
    if (settingsApplyResult && typeof settingsApplyResult.then === 'function') {
      await settingsApplyResult;
    }
    const latestActiveSample = materialSamples[activeMaterialId] || activeSample;
    if (latestActiveSample?.vertexSource && pipelineControl.applyGeneratedVertexSource) {
      try {
        setStatus('Adapting MaterialX vertex shader');
        await pipelineControl.applyGeneratedVertexSource(latestActiveSample.vertexSource);
      } catch (error) {
        console.warn('Generated vertex adaptation failed, keeping bridge vertex stage.', error);
        setMetric('vertexAdapter', 'bridge fallback');
      }
    }
    if (latestActiveSample?.pixelContract?.translatedFragment.wgsl && pipelineControl.validateGeneratedFragmentTranslation) {
      try {
        setStatus('Validating fragment translator');
        const validationDuration = await pipelineControl.validateGeneratedFragmentTranslation(latestActiveSample.pixelContract.translatedFragment.wgsl);
        const { requestedCount, translatedCount } = latestActiveSample.pixelContract.translatedFragment;
        setMetric('fragmentTranslator', `${translatedCount}/${requestedCount} translated / ${formatDuration(validationDuration)}`);
      } catch (error) {
        console.warn('Generated fragment translation validation failed.', error);
        setMetric('fragmentTranslator', 'compile failed');
      }
    }
    const refreshResult = pipelineControl.refreshActiveShaderMode?.();
    if (refreshResult && typeof refreshResult.then === 'function') {
      await refreshResult;
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

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
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
        u,
        v,
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

function getAttributeVector2(attribute, index, fallback = [0, 0]) {
  if (!attribute) return fallback;

  return [
    attribute.getX(index),
    attribute.getY(index),
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
    const uv = geometry.attributes.uv;
    const index = geometry.index;
    const vertexOffset = vertices.length / vertexStrideFloats;

    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      const rawPosition = getAttributeVector3(position, vertexIndex);
      const rawNormal = normalize(getAttributeVector3(normal, vertexIndex, [0, 1, 0]));
      const rawTangent = tangent
        ? normalize(getAttributeVector3(tangent, vertexIndex, getFallbackTangent(rawNormal)))
        : getFallbackTangent(rawNormal);
      const rawUv = getAttributeVector2(uv, vertexIndex);

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
        rawUv[0],
        rawUv[1],
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

function assetNameKey(path) {
  return prettyAssetName(String(path || '').trim()).toLocaleLowerCase();
}

function resolveAssetPath(paths, requested, fallback) {
  if (paths.includes(requested)) return requested;

  const requestedKey = assetNameKey(requested);
  const matchedPath = paths.find(path => assetNameKey(path) === requestedKey);
  if (matchedPath) return matchedPath;

  return paths.includes(fallback) ? fallback : paths[0] || '';
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

async function loadImageTexture(device, url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' })
    .catch(() => createImageBitmap(blob));
  const texture = device.createTexture({
    format: 'rgba8unorm',
    label,
    size: [bitmap.width, bitmap.height, 1],
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    { height: bitmap.height, width: bitmap.width },
  );
  bitmap.close?.();
  return texture;
}

function createMaterialTextureCache(device) {
  const textures = new Map();
  const fallbackTexture = createPlaceholderTexture(device, 'MaterialX fallback image texture', [1, 0, 1, 1]);

  return {
    async get(url, label) {
      if (!url) return fallbackTexture;
      if (!textures.has(url)) {
        textures.set(url, loadImageTexture(device, url, label).catch((error) => {
          console.warn(`Could not load material texture ${url}.`, error);
          return fallbackTexture;
        }));
      }
      return textures.get(url);
    },
  };
}

async function loadMaterialTextureBindings(textureCache, sample) {
  const bindings = sample?.textureBindings || [];
  return Promise.all(bindings.map(async binding => ({
    ...binding,
    texture: await textureCache.get(binding.path, `MaterialX ${binding.label} texture`),
  })));
}

function getEnvironmentIrradiancePath(environmentPath) {
  return environmentPath.replace('/Lights/', '/Lights/irradiance/');
}

function getEnvironmentLightRigPath(environmentPath) {
  return environmentPath.replace(/\.hdr$/i, '.mtlx');
}

function isSplitEnvironmentPath(environmentPath) {
  return /_split\.hdr$/i.test(environmentPath);
}

function getEnvironmentFamilyPath(environmentPath) {
  return environmentPath.replace(/_split(?=\.hdr$)/i, '');
}

function getEnvironmentFamilyKey(environmentPath) {
  return assetNameKey(getEnvironmentFamilyPath(environmentPath));
}

function preferSplitEnvironmentPaths(environmentPaths) {
  const preferredByFamily = new Map();
  for (const path of environmentPaths) {
    const familyKey = getEnvironmentFamilyKey(path);
    const existing = preferredByFamily.get(familyKey);
    if (!existing || isSplitEnvironmentPath(path)) {
      preferredByFamily.set(familyKey, path);
    }
  }

  return [...preferredByFamily.values()]
    .sort((a, b) => prettyAssetName(a).localeCompare(prettyAssetName(b)));
}

function getEnvironmentPaths() {
  const environmentPaths = materialXResourcePaths
    .filter(path => path.includes('/Lights/') && !path.includes('/Lights/irradiance/') && path.endsWith('.hdr'))
    .sort((a, b) => prettyAssetName(a).localeCompare(prettyAssetName(b)));
  return preferSplitEnvironmentPaths(environmentPaths);
}

function resolveEnvironmentPath(paths, requested, fallback) {
  if (paths.includes(requested)) return requested;

  const requestedKey = assetNameKey(requested);
  const directMatch = paths.find(path => assetNameKey(path) === requestedKey);
  if (directMatch) return directMatch;

  const requestedFamilyKey = getEnvironmentFamilyKey(requested);
  const familyMatch = paths.find(path => getEnvironmentFamilyKey(path) === requestedFamilyKey);
  if (familyMatch) return familyMatch;

  return resolveAssetPath(paths, fallback, fallback);
}

function getEnvironmentAssets(environmentPath) {
  const irradiancePath = getEnvironmentIrradiancePath(environmentPath);
  const lightRigPath = getEnvironmentLightRigPath(environmentPath);
  const fallbackIrradiancePath = getEnvironmentIrradiancePath(defaultEnvironment);

  return {
    irradiance: materialXResourcePaths.length && !materialXResourcePaths.includes(irradiancePath)
      ? fallbackIrradiancePath
      : irradiancePath,
    lightRig: materialXResourcePaths.length && !materialXResourcePaths.includes(lightRigPath)
      ? ''
      : lightRigPath,
    radiance: environmentPath,
  };
}

function formatToneValue(value) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

function createLuminanceStats(luminanceValues) {
  if (!luminanceValues.length) {
    return {
      average: 0,
      exposureReference: 0,
      max: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      sampleCount: 0,
    };
  }

  luminanceValues.sort((a, b) => a - b);
  const sum = luminanceValues.reduce((total, value) => total + value, 0);
  const percentile = value => luminanceValues[
    Math.min(luminanceValues.length - 1, Math.max(0, Math.floor((luminanceValues.length - 1) * value)))
  ];
  const trimStart = Math.min(
    luminanceValues.length - 1,
    Math.max(0, Math.floor((luminanceValues.length - 1) * environmentToneReferenceTrimLow)),
  );
  const trimEnd = Math.min(
    luminanceValues.length - 1,
    Math.max(trimStart, Math.ceil((luminanceValues.length - 1) * environmentToneReferenceTrimHigh)),
  );
  let stopSum = 0;
  let stopCount = 0;
  for (let index = trimStart; index <= trimEnd; index++) {
    stopSum += luminanceToStops(luminanceValues[index]);
    stopCount++;
  }

  return {
    average: sum / luminanceValues.length,
    exposureReference: stopCount ? stopsToLuminance(stopSum / stopCount) : percentile(0.5),
    max: luminanceValues[luminanceValues.length - 1],
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    sampleCount: luminanceValues.length,
  };
}

function getHdrPixelLuminance(hdr, x, y) {
  const offset = (y * hdr.width + x) * 4;
  const red = halfToFloat(hdr.data[offset]);
  const green = halfToFloat(hdr.data[offset + 1]);
  const blue = halfToFloat(hdr.data[offset + 2]);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return Number.isFinite(luminance) && luminance > 0 ? luminance : 0;
}

function luminanceToStops(luminance) {
  return Math.log2(Math.max(environmentToneLogLuminanceFloor, luminance));
}

function stopsToLuminance(stops) {
  return 2 ** stops;
}

function createDownsampledEnvironmentToneMap(hdr) {
  const width = Math.min(environmentToneMapWidth, hdr.width);
  const height = Math.min(environmentToneMapHeight, hdr.height);
  const stops = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const sourceYStart = Math.floor(y * hdr.height / height);
    const sourceYEnd = Math.max(sourceYStart + 1, Math.floor((y + 1) * hdr.height / height));
    for (let x = 0; x < width; x++) {
      const sourceXStart = Math.floor(x * hdr.width / width);
      const sourceXEnd = Math.max(sourceXStart + 1, Math.floor((x + 1) * hdr.width / width));
      let sum = 0;
      let count = 0;

      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY++) {
        const clampedY = Math.min(hdr.height - 1, sourceY);
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX++) {
          sum += luminanceToStops(getHdrPixelLuminance(hdr, Math.min(hdr.width - 1, sourceX), clampedY));
          count++;
        }
      }

      stops[y * width + x] = count ? sum / count : luminanceToStops(0);
    }
  }

  return {
    data: stops,
    height,
    width,
  };
}

function blurEnvironmentToneMap(source) {
  const { height, width } = source;
  const kernel = [1, 4, 6, 4, 1];
  const kernelWeight = 16;
  let current = source.data;
  let horizontal = new Float32Array(current.length);
  let vertical = new Float32Array(current.length);

  for (let pass = 0; pass < environmentToneBlurPasses; pass++) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex++) {
          const offset = kernelIndex - 2;
          const sampleX = (x + offset + width) % width;
          sum += current[rowOffset + sampleX] * kernel[kernelIndex];
        }
        horizontal[rowOffset + x] = sum / kernelWeight;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex++) {
          const offset = kernelIndex - 2;
          const sampleY = Math.min(height - 1, Math.max(0, y + offset));
          sum += horizontal[sampleY * width + x] * kernel[kernelIndex];
        }
        vertical[y * width + x] = sum / kernelWeight;
      }
    }

    current = vertical;
    vertical = new Float32Array(current.length);
  }

  return {
    data: current,
    height,
    width,
  };
}

function convertEnvironmentToneStopsToLuminance(source) {
  const luminance = new Float32Array(source.data.length);
  for (let index = 0; index < source.data.length; index++) {
    luminance[index] = stopsToLuminance(source.data[index]);
  }
  return {
    data: luminance,
    height: source.height,
    width: source.width,
  };
}

function createEnvironmentToneSource(hdr) {
  const downsampledStops = createDownsampledEnvironmentToneMap(hdr);
  const blurredStops = blurEnvironmentToneMap(downsampledStops);
  return convertEnvironmentToneStopsToLuminance(blurredStops);
}

function createEnvironmentToneDebugImageData(source) {
  if (!source?.data || !source.width || !source.height) return null;
  const luminanceValues = Array.from(source.data).filter(value => Number.isFinite(value) && value > 0);
  const stats = createLuminanceStats(luminanceValues);
  const reference = Math.max(stats.p99, stats.average, 0.0001);
  const image = new ImageData(source.width, source.height);

  for (let index = 0; index < source.data.length; index++) {
    const normalized = Math.min(1, Math.max(0, source.data[index] / reference));
    const value = Math.round(Math.sqrt(normalized) * 255);
    const offset = index * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }

  return image;
}

function sampleToneMapBilinear(source, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const wrappedX0 = (x0 + source.width) % source.width;
  const wrappedX1 = (x1 + source.width) % source.width;
  const clampedY0 = Math.min(source.height - 1, Math.max(0, y0));
  const clampedY1 = Math.min(source.height - 1, Math.max(0, y1));
  const top = source.data[clampedY0 * source.width + wrappedX0] * (1 - tx)
    + source.data[clampedY0 * source.width + wrappedX1] * tx;
  const bottom = source.data[clampedY1 * source.width + wrappedX0] * (1 - tx)
    + source.data[clampedY1 * source.width + wrappedX1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleEnvironmentTonePoint(source, direction) {
  if (!source?.data || !source.width || !source.height) return null;
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  const u = Math.atan2(x, -z) * 0.15915494309189535 + 0.5;
  const v = Math.acos(Math.min(1, Math.max(-1, y))) * 0.3183098861837907;
  const rotatedU = ((u + 0.5) % 1 + 1) % 1;
  const sampleX = rotatedU * source.width - 0.5;
  const sampleY = v * source.height - 0.5;
  return {
    luminance: sampleToneMapBilinear(source, sampleX, sampleY),
    x: sampleX,
    y: sampleY,
  };
}

function createPhyllotaxisNdcPoint(index, count) {
  const radius = Math.sqrt((index + 0.5) / count);
  const angle = index * environmentToneGoldenAngle;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function createVisibleEnvironmentToneStats(source, dimensions, cameraRig) {
  if (!source?.data) return null;
  const aspect = dimensions.width / dimensions.height;
  const tanHalfFov = Math.tan(cameraFov / 2);
  const elements = cameraRig.camera.matrixWorld.elements;
  const right = [elements[0], elements[1], elements[2]];
  const up = [elements[4], elements[5], elements[6]];
  const forward = [-elements[8], -elements[9], -elements[10]];
  const luminanceValues = [];
  const samplePoints = [];

  for (let index = 0; index < environmentToneSampleCount; index++) {
    const ndc = createPhyllotaxisNdcPoint(index, environmentToneSampleCount);
    const direction = [
      forward[0] + right[0] * ndc.x * aspect * tanHalfFov + up[0] * ndc.y * tanHalfFov,
      forward[1] + right[1] * ndc.x * aspect * tanHalfFov + up[1] * ndc.y * tanHalfFov,
      forward[2] + right[2] * ndc.x * aspect * tanHalfFov + up[2] * ndc.y * tanHalfFov,
    ];
    const point = sampleEnvironmentTonePoint(source, direction);
    if (point && Number.isFinite(point.luminance) && point.luminance > 0) {
      luminanceValues.push(point.luminance);
      samplePoints.push(point);
    }
  }

  return {
    ...createLuminanceStats(luminanceValues),
    samplePoints,
  };
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function getEnvironmentBackgroundTone() {
  if (!adaptiveEnvironmentToneEnabled || !drawEnvironment || !activeEnvironmentToneStats?.sampleCount) {
    return {
      exposure: 0,
      exposureStrength: 0,
      highlightStrength: 0,
      rawExposure: 0,
      strength: 0,
      stops: 0,
    };
  }

  const referenceLuminance = Math.max(activeEnvironmentToneStats.exposureReference, 0.0001);
  const intensityCompensation = Math.max(envLightIntensity, 0.001);
  const rawExposure = environmentToneTargetReference / (referenceLuminance * intensityCompensation);
  const boundedExposure = Math.max(0.001, rawExposure);
  const exposure = boundedExposure > 1
    ? Math.min(environmentToneMaxExposure, environmentToneMaxBrightenExposure, boundedExposure)
    : Math.min(environmentToneMaxExposure, boundedExposure);
  const stops = Math.log2(exposure);
  const plateauStops = stops > 0 ? environmentToneBrightenPlateauStops : environmentToneDimPlateauStops;
  const kneeStops = stops > 0 ? environmentToneBrightenKneeStops : environmentToneDimKneeStops;
  const exposureStrength = smoothstep(
    plateauStops,
    plateauStops + kneeStops,
    Math.abs(stops),
  );
  const highlightRatio = Math.max(activeEnvironmentToneStats.p99, 0.0001) / referenceLuminance;
  const highlightStops = Math.max(0, Math.log2(highlightRatio));
  const highlightStrength = smoothstep(
    environmentToneHighlightStartStops,
    environmentToneHighlightEndStops,
    highlightStops,
  );

  return {
    exposure,
    exposureStrength,
    highlightStrength,
    rawExposure,
    strength: Math.max(exposureStrength, highlightStrength),
    stops,
  };
}

function updateEnvironmentToneMetric() {
  if (!adaptiveEnvironmentToneEnabled) {
    setMetric('environmentTone', 'manual');
    return;
  }

  if (!drawEnvironment) {
    setMetric('environmentTone', 'adaptive armed / background hidden');
    return;
  }

  if (!activeEnvironmentToneStats?.sampleCount) {
    setMetric('environmentTone', 'adaptive / no HDR stats');
    return;
  }

  const tone = getEnvironmentBackgroundTone();
  setMetric(
    'environmentTone',
    `adaptive ${formatToneValue(tone.exposure)}x / blend ${Math.round(tone.exposureStrength * 100)}% / hot ${Math.round(tone.highlightStrength * 100)}% / log ref ${formatToneValue(activeEnvironmentToneStats.exposureReference)} / p95 ${formatToneValue(activeEnvironmentToneStats.p95)}`,
  );
}

function renderEnvironmentToneDebug() {
  const panel = document.querySelector('[data-env-tone-debug]');
  const canvas = document.querySelector('[data-env-tone-debug-canvas]');
  const meta = document.querySelector('[data-env-tone-debug-meta]');
  if (!panel || !canvas) return;

  panel.hidden = !environmentToneDebugEnabled;
  if (!environmentToneDebugEnabled) return;

  const source = activeEnvironmentToneSource;
  const context = canvas.getContext('2d');
  if (!source?.data || !context) {
    if (meta) meta.textContent = 'no tone map';
    return;
  }

  if (canvas.width !== source.width || canvas.height !== source.height) {
    canvas.width = source.width;
    canvas.height = source.height;
  }

  if (activeEnvironmentToneDebugImageData) {
    context.putImageData(activeEnvironmentToneDebugImageData, 0, 0);
  } else {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  const points = activeEnvironmentToneStats?.samplePoints || [];
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  context.fillStyle = 'rgba(255, 67, 67, 0.95)';
  for (const point of points) {
    const x = ((point.x + 0.5) % source.width + source.width) % source.width;
    const y = Math.min(source.height - 1, Math.max(0, point.y + 0.5));
    context.beginPath();
    context.arc(x, y, 1.6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();

  if (meta) {
    const tone = getEnvironmentBackgroundTone();
    meta.textContent = `${source.width}x${source.height} / ${points.length} pts / ${formatToneValue(tone.exposure)}x / ${Math.round(tone.exposureStrength * 100)}% / hot ${Math.round(tone.highlightStrength * 100)}%`;
  }
}

function updateEnvironmentToneForFrame(dimensions, cameraRig, now = performance.now()) {
  if (activeEnvironmentToneSource && (environmentToneDebugEnabled || (adaptiveEnvironmentToneEnabled && drawEnvironment))) {
    activeEnvironmentToneStats = createVisibleEnvironmentToneStats(activeEnvironmentToneSource, dimensions, cameraRig);
  } else {
    activeEnvironmentToneStats = null;
  }

  if (now - environmentToneLastMetricTime > 250) {
    environmentToneLastMetricTime = now;
    updateEnvironmentToneMetric();
    renderEnvironmentToneDebug();
  }
}

function sanitizeVector(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const vector = fallback.map((component, index) => {
    const number = Number(value[index]);
    return Number.isFinite(number) ? number : component;
  });
  return vector;
}

function parseLightRigXml(xml, lightRigPath = '') {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = document.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Could not parse ${lightRigPath || 'light rig'}.`);
  }

  const light = [...document.querySelectorAll('[type="lightshader"]')][0];
  if (!light) {
    throw new Error(`${lightRigPath || 'Light rig'} does not define a light shader.`);
  }

  const inputValue = name => light.querySelector(`input[name="${name}"]`)?.getAttribute('value');
  const intensity = Number(parseMaterialValue('float', inputValue('intensity')));
  return {
    color: sanitizeVector(parseMaterialValue('color3', inputValue('color')), [1, 1, 1]),
    direction: sanitizeVector(parseMaterialValue('vector3', inputValue('direction')), [0, -1, 0]),
    intensity: Number.isFinite(intensity) ? intensity : 1,
    type: 1,
  };
}

async function loadEnvironmentLightRig(environmentPath) {
  const { lightRig } = getEnvironmentAssets(environmentPath);
  if (!lightRig) return null;

  const response = await fetch(lightRig);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${lightRig}`);
  }

  return {
    light: parseLightRigXml(await response.text(), lightRig),
    path: lightRig,
  };
}

async function applyEnvironmentLightRig(environmentPath, controls = {}) {
  let lightRig = null;
  try {
    lightRig = await loadEnvironmentLightRig(environmentPath);
  } catch (error) {
    console.warn(`Could not load light rig for ${environmentPath}.`, error);
    setMetric('directLight', `${describeDirectLight()} / rig unavailable`);
    return null;
  }

  if (!lightRig?.light) {
    activeLightRigPath = '';
    setMetric('directLight', `${describeDirectLight()} / no rig`);
    return null;
  }

  activeDirectLight = lightRig.light;
  activeLightRigPath = lightRig.path;
  controls.writeLight?.(activeDirectLight);
  setMetric('directLight', describeDirectLight(activeDirectLight));
  return lightRig;
}

async function initializeAssetManifest() {
  try {
    const manifest = await loadAssetManifest();
    materialXResourcePaths = Array.isArray(manifest.materialXResourcePaths)
      ? manifest.materialXResourcePaths
      : [];
  } catch (error) {
    console.warn('Could not load MaterialX asset manifest; using direct viewer defaults.', error);
    materialXResourcePaths = [];
  }

  const environmentPaths = getEnvironmentPaths();
  environmentFilename = resolveEnvironmentPath(environmentPaths, environmentFilename, defaultEnvironment) || defaultEnvironment;
  return environmentPaths.length ? environmentPaths : [environmentFilename];
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
    environmentToneDebugImageData: null,
    environmentToneSource: null,
    envIrradianceTexture: createPlaceholderTexture(device, 'MaterialX env irradiance placeholder', [0.62, 0.66, 0.68, 1]),
    envRadianceMipCount: 1,
    envRadianceTexture: createPlaceholderTexture(device, 'MaterialX env radiance placeholder', [0.32, 0.36, 0.42, 1]),
  };
}

async function createEnvironmentTextures(device, environmentPath = environmentFilename) {
  const start = performance.now();
  const environmentLabel = prettyAssetName(environmentPath);
  const environmentAssets = getEnvironmentAssets(environmentPath);

  try {
    setStatus(`Loading environment: ${environmentLabel}`);
    const [radiance, irradiance] = await Promise.all([
      loadHdrTexture(environmentAssets.radiance),
      loadHdrTexture(environmentAssets.irradiance),
    ]);
    const environmentToneSource = createEnvironmentToneSource(radiance);
    const envIrradiance = createHdrTexture(device, 'MaterialX env irradiance HDR', irradiance);
    const envRadiance = createHdrTexture(device, 'MaterialX env radiance HDR', radiance, { generateMipmaps: true });

    setMetric('environment', environmentLabel);
    setMetric('environmentSize', `${radiance.width}x${radiance.height} mips ${envRadiance.mipLevelCount} / ${irradiance.width}x${irradiance.height}`);
    recordDuration('environmentLoad', start);

    return {
      environmentToneDebugImageData: createEnvironmentToneDebugImageData(environmentToneSource),
      environmentToneSource,
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
  updateFallbackStatus(activeRendererMode === 'auto'
    ? 'Direct WebGPU active / WebGL fallback armed'
    : 'Direct WebGPU forced / WebGL fallback disabled');
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
    vertexLayout = 'standard',
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
        buffers: [createVertexBufferLayout(vertexLayout)],
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

function createVertexBufferLayout(layout = 'standard') {
  const floatSize = Float32Array.BYTES_PER_ELEMENT;
  const attributes = layout === 'textured'
    ? [
        { format: 'float32x3', offset: 0, shaderLocation: 0 },
        { format: 'float32x2', offset: 9 * floatSize, shaderLocation: 1 },
        { format: 'float32x3', offset: 3 * floatSize, shaderLocation: 2 },
        { format: 'float32x3', offset: 6 * floatSize, shaderLocation: 3 },
      ]
    : [
        { format: 'float32x3', offset: 0, shaderLocation: 0 },
        { format: 'float32x3', offset: 3 * floatSize, shaderLocation: 1 },
        { format: 'float32x3', offset: 6 * floatSize, shaderLocation: 2 },
      ];

  return {
    arrayStride: vertexStrideFloats * floatSize,
    attributes,
  };
}

async function createEnvironmentBackgroundPipeline(device, format) {
  device.pushErrorScope('validation');
  try {
    const module = device.createShaderModule({
      code: environmentBackgroundSource,
      label: 'Direct WebGPU environment background shader',
    });
    const pipeline = await device.createRenderPipelineAsync({
      depthStencil: {
        depthCompare: 'always',
        depthWriteEnabled: false,
        format: depthFormat,
      },
      fragment: {
        entryPoint: 'fragmentMain',
        module,
        targets: [{ format }],
      },
      label: 'Direct WebGPU environment background pipeline',
      layout: 'auto',
      primitive: {
        topology: 'triangle-list',
      },
      vertex: {
        entryPoint: 'vertexMain',
        module,
      },
    });
    const error = await device.popErrorScope();
    if (error) {
      throw error;
    }
    return pipeline;
  } catch (error) {
    const scopedError = await device.popErrorScope().catch(() => null);
    const reportedError = scopedError || error;
    recordWebGpuError('environment background pipeline validation', reportedError);
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

function createCameraRig(canvas, dimensions) {
  const aspect = dimensions.width / dimensions.height;
  const camera = new PerspectiveCamera(cameraFovDegrees, aspect, cameraNear, cameraFar);
  const yaw = 0.22;
  const pitch = 0.12;
  const cosPitch = Math.cos(pitch);
  camera.position.set(
    Math.sin(yaw) * cosPitch * initialDistance,
    Math.sin(pitch) * initialDistance,
    Math.cos(yaw) * cosPitch * initialDistance,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.minDistance = sphereRadius * 1.25;
  controls.maxDistance = 8;
  controls.rotateSpeed = 1;
  controls.zoomSpeed = 1;
  controls.panSpeed = 1;
  controls.update();

  return {
    camera,
    controls,
    viewProjection: new Matrix4(),
  };
}

function updateCameraRig(cameraRig, dimensions) {
  const aspect = dimensions.width / dimensions.height;
  cameraRig.camera.aspect = aspect;
  cameraRig.camera.updateProjectionMatrix();
  cameraRig.controls.update();
  cameraRig.camera.updateMatrixWorld(true);
  cameraRig.viewProjection.multiplyMatrices(
    cameraRig.camera.projectionMatrix,
    cameraRig.camera.matrixWorldInverse,
  );
}

function getCameraPosition(cameraRig) {
  return cameraRig.camera.position.toArray();
}

function writeFrameUniforms(privateVertexData, privatePixelData, dimensions, cameraRig, envRadianceMipCount = 1) {
  const model = createIdentityMatrix();
  const normal = createIdentityMatrix();
  updateCameraRig(cameraRig, dimensions);
  const cameraPosition = getCameraPosition(cameraRig);

  privateVertexData.set(model, 0);
  privateVertexData.set(cameraRig.viewProjection.elements, 16);
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
  privatePixelData.ints[23] = directLightEnabled ? 1 : 0;
}

function writeEnvironmentBackgroundUniforms(backgroundData, dimensions, cameraRig) {
  const aspect = dimensions.width / dimensions.height;
  const elements = cameraRig.camera.matrixWorld.elements;
  const right = [elements[0], elements[1], elements[2]];
  const up = [elements[4], elements[5], elements[6]];
  const forward = [-elements[8], -elements[9], -elements[10]];
  const tone = getEnvironmentBackgroundTone();

  backgroundData.set([right[0], right[1], right[2], 0], 0);
  backgroundData.set([up[0], up[1], up[2], 0], 4);
  backgroundData.set([forward[0], forward[1], forward[2], 0], 8);
  backgroundData.set([aspect, Math.tan(cameraFov / 2), envLightIntensity, 0], 12);
  backgroundData.set([tone.exposure, tone.exposureStrength, tone.highlightStrength, tone.stops], 16);
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
  const buffer = new ArrayBuffer(maxPublicUniformByteLength);
  return {
    bytes: new Uint8Array(buffer),
    floats: new Float32Array(buffer),
    ints: new Int32Array(buffer),
  };
}

function createLightUniformData() {
  const buffer = new ArrayBuffer(lightDataByteLength);
  return {
    bytes: new Uint8Array(buffer),
    floats: new Float32Array(buffer),
    ints: new Int32Array(buffer),
  };
}

function writeLightUniforms(lightUniformData, light = activeDirectLight) {
  lightUniformData.bytes.fill(0);
  lightUniformData.floats.set(light.direction || [0, -1, 0], 0);
  lightUniformData.floats.set(light.color || [1, 1, 1], 4);
  lightUniformData.ints[7] = light.type || 0;
  lightUniformData.floats[8] = Number.isFinite(light.intensity) ? light.intensity : 1;
}

function describeDirectLight(light = activeDirectLight) {
  if (!directLightEnabled) return 'off';
  const intensity = Number.isFinite(light.intensity) ? light.intensity.toFixed(2) : '1.00';
  return `on / type ${light.type || 0} / ${intensity}x`;
}

function writeMaterialUniforms(publicUniformData, materialId, options = {}) {
  const shaderMode = options.shaderMode || activeShaderMode;
  const sample = materialSamples[materialId] || materialSamples.standard;
  publicUniformData.bytes.fill(0);

  if (shaderMode === 'naga' && sample.uniformLayout && sample.uniformValues) {
    if (sample.uniformLayout.byteLength > publicUniformData.bytes.byteLength) {
      throw new Error(`Material uniform block for "${materialId}" needs ${sample.uniformLayout.byteLength} bytes, but only ${publicUniformData.bytes.byteLength} are allocated.`);
    }

    for (const port of sample.uniformLayout.ports) {
      const value = sample.uniformValues[port.field];
      const offset = port.byteOffset / Float32Array.BYTES_PER_ELEMENT;
      if (Array.isArray(value)) {
        publicUniformData.floats.set(value, offset);
      } else if (port.type === 'integer') {
        publicUniformData.ints[offset] = value ? Number(value) : 0;
      } else {
        publicUniformData.floats[offset] = Number.isFinite(Number(value)) ? Number(value) : 0;
      }
    }

    return sample;
  }

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

function updateMaterialQueryParams(materialId = activeMaterialId, options = {}) {
  const nextUrl = new URL(document.location.href);
  nextUrl.searchParams.set('material', materialId);
  if (options.settings) {
    nextUrl.searchParams.set('settings', options.settings);
  } else if (options.clearSettings) {
    nextUrl.searchParams.delete('settings');
  }
  history.replaceState(null, '', nextUrl);
}

function cloneSettingsValue(value) {
  return Array.isArray(value) ? [...value] : value;
}

function cloneSettingsMap(values = {}) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, cloneSettingsValue(value)]),
  );
}

function sanitizeMaterialSettingsValue(value, fallback) {
  if (Array.isArray(fallback)) {
    const source = Array.isArray(value) ? value : [];
    return fallback.map((fallbackComponent, index) => {
      const component = Number(source[index]);
      return Number.isFinite(component) ? component : fallbackComponent;
    });
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createMaterialSettingsSnapshotFromSample(materialId, sample, shaderMode = activeShaderMode) {
  return {
    schema: 'mxv.material-settings',
    version: 1,
    materialId,
    materialLabel: sample.label,
    shaderMode,
    ports: cloneSettingsMap(sample.ports),
    publicUniforms: cloneSettingsMap(sample.uniformValues),
  };
}

function createMaterialSettingsSnapshot(materialId = activeMaterialId) {
  const sample = materialSamples[materialId] || materialSamples.standard;
  return createMaterialSettingsSnapshotFromSample(materialId, sample);
}

function createMaterialSettingsDefaults(samples) {
  return new Map(
    Object.entries(samples).map(([materialId, sample]) => [
      materialId,
      createMaterialSettingsSnapshotFromSample(materialId, sample),
    ]),
  );
}

function resetMaterialSettingsDefaults(samples = materialSamples) {
  materialSettingsDefaults = createMaterialSettingsDefaults(samples);
}

function encodeMaterialSettingsForUrl(settings) {
  const json = JSON.stringify(settings);
  const encoded = btoa(encodeURIComponent(json));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeMaterialSettingsFromUrl(value) {
  if (!value) return null;

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return parseMaterialSettings(decodeURIComponent(atob(base64)));
}

function getRequestedMaterialSettings() {
  if (!requestedMaterialSettings) return null;

  try {
    return decodeMaterialSettingsFromUrl(requestedMaterialSettings);
  } catch (error) {
    console.warn('Could not parse material settings from URL.', error);
    setMetric('shaderNotes', 'Could not parse URL material settings');
    return null;
  }
}

function persistMaterialSettingsToUrl() {
  updateMaterialQueryParams(activeMaterialId, {
    settings: encodeMaterialSettingsForUrl(createMaterialSettingsSnapshot()),
  });
}

function clearMaterialSettingsFromUrl() {
  updateMaterialQueryParams(activeMaterialId, { clearSettings: true });
}

function settingsValueEquals(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => settingsValueEquals(value, right[index]));
  }

  if (typeof left === 'number' || typeof right === 'number') {
    return Math.abs(Number(left) - Number(right)) < 0.00001;
  }

  return left === right;
}

function settingsMapEquals(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return false;
    if (!settingsValueEquals(left[key], right[key])) return false;
  }
  return true;
}

function isMaterialSettingsDirty(materialId = activeMaterialId) {
  const baseline = materialSettingsDefaults.get(materialId);
  if (!baseline) return false;

  const current = createMaterialSettingsSnapshot(materialId);
  return !settingsMapEquals(current.ports, baseline.ports)
    || !settingsMapEquals(current.publicUniforms, baseline.publicUniforms);
}

function getMaterialSettingsHandleError(error) {
  if (error?.name === 'AbortError') return null;
  return error;
}

function getMaterialSettingsFilename(settings) {
  const label = settings.materialLabel || settings.materialId || 'material';
  const slug = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'material';
  return `${slug}-settings.json`;
}

function getMaterialXExportFilename(materialId = activeMaterialId) {
  return getMaterialSettingsFilename(createMaterialSettingsSnapshot(materialId)).replace(/-settings\.json$/u, '.mtlx');
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function saveTextFile({ accept, description, suggestedName, text, type }) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            accept,
            description,
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      const handled = getMaterialSettingsHandleError(error);
      if (!handled) return false;
      throw handled;
    }
  }

  downloadTextFile(text, suggestedName, type);
  return true;
}

async function saveMaterialSettingsFile() {
  const settings = createMaterialSettingsSnapshot();
  const saved = await saveTextFile({
    accept: { 'application/json': ['.json'] },
    description: 'mxv material settings',
    suggestedName: getMaterialSettingsFilename(settings),
    text: `${JSON.stringify(settings, null, 2)}\n`,
    type: 'application/json',
  });
  setStatus(saved ? 'Saved material settings' : 'Save canceled');
}

function applyMaterialSettingsToSample(sample, settings) {
  let appliedCount = 0;
  const publicUniforms = settings.publicUniforms && typeof settings.publicUniforms === 'object'
    ? settings.publicUniforms
    : {};
  const ports = settings.ports && typeof settings.ports === 'object'
    ? settings.ports
    : {};

  if (sample.uniformLayout?.ports?.length) {
    for (const port of sample.uniformLayout.ports) {
      if (!Object.hasOwn(publicUniforms, port.field)) continue;
      if (sample.uniformValues && Object.hasOwn(sample.uniformValues, port.field)) {
        sample.uniformValues[port.field] = sanitizeMaterialSettingsValue(publicUniforms[port.field], sample.uniformValues[port.field]);
      }
      if (sample.ports && Object.hasOwn(sample.ports, port.name)) {
        sample.ports[port.name] = sanitizeMaterialSettingsValue(publicUniforms[port.field], sample.ports[port.name]);
      }
      appliedCount++;
    }
  } else {
    for (const [field, currentValue] of Object.entries(sample.uniformValues || {})) {
      if (!Object.hasOwn(publicUniforms, field)) continue;
      sample.uniformValues[field] = sanitizeMaterialSettingsValue(publicUniforms[field], currentValue);
      appliedCount++;
    }
  }

  for (const [name, currentValue] of Object.entries(sample.ports || {})) {
    if (!Object.hasOwn(ports, name)) continue;
    sample.ports[name] = sanitizeMaterialSettingsValue(ports[name], currentValue);
    const uniformPort = sample.uniformLayout?.byName?.[name];
    if (uniformPort && sample.uniformValues && Object.hasOwn(sample.uniformValues, uniformPort.field)) {
      sample.uniformValues[uniformPort.field] = sanitizeMaterialSettingsValue(ports[name], sample.uniformValues[uniformPort.field]);
    }
    appliedCount++;
  }

  return appliedCount;
}

function parseMaterialSettings(text) {
  const settings = JSON.parse(text);
  if (!settings || typeof settings !== 'object') {
    throw new Error('Material settings file did not contain a JSON object.');
  }

  if (settings.schema && settings.schema !== 'mxv.material-settings') {
    throw new Error(`Unsupported material settings schema: ${settings.schema}.`);
  }

  return settings;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeMaterialXIdentifier(value, fallback) {
  const identifier = String(value || '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!identifier) return fallback;
  return /^[A-Za-z_]/.test(identifier) ? identifier : `M_${identifier}`;
}

function formatMaterialXNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return Number(numeric.toFixed(6)).toString();
}

function formatMaterialXValue(type, value) {
  if (type === 'boolean') {
    return Number(value) ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.map(formatMaterialXNumber).join(', ');
  }

  return formatMaterialXNumber(value);
}

function getMaterialXExportPorts(sample) {
  if (sample.uniformLayout?.ports?.length) {
    return sample.uniformLayout.ports
      .filter(port => port.type !== 'filename' && port.type !== 'string')
      .map(port => ({
        field: port.field,
        name: port.name,
        type: port.sourceType === 'boolean' ? 'boolean' : port.sourceType || port.type,
        value: sample.uniformValues?.[port.field] ?? sample.ports?.[port.name],
      }));
  }

  return materialUniformLayout.ports.map(port => ({
    field: port.field,
    name: port.name,
    type: materialPortTypes[port.name] === 'integer' ? 'boolean' : materialPortTypes[port.name],
    value: sample.ports?.[port.name],
  }));
}

function createMaterialXExportSource(materialId = activeMaterialId) {
  const sample = materialSamples[materialId] || materialSamples.standard;
  const nodeSuffix = sanitizeMaterialXIdentifier(materialId, 'material');
  const shaderName = `SR_${nodeSuffix}`;
  const materialName = `MAT_${nodeSuffix}`;
  const inputs = getMaterialXExportPorts(sample)
    .filter(port => port.value !== undefined && port.value !== null)
    .map((port) => {
      const type = port.field === 'thin_walled' || port.name === 'thinWalled'
        ? 'boolean'
        : port.type;
      return `    <input name="${escapeXml(port.field)}" type="${escapeXml(type)}" value="${escapeXml(formatMaterialXValue(type, port.value))}" />`;
    })
    .join('\n');

  return `<?xml version="1.0"?>\n<materialx version="1.39" colorspace="lin_rec709">\n  <standard_surface name="${escapeXml(shaderName)}" type="surfaceshader">\n${inputs}\n  </standard_surface>\n  <surfacematerial name="${escapeXml(materialName)}" type="material">\n    <input name="surfaceshader" type="surfaceshader" nodename="${escapeXml(shaderName)}" />\n  </surfacematerial>\n</materialx>\n`;
}

async function exportMaterialXFile() {
  const saved = await saveTextFile({
    accept: { 'application/xml': ['.mtlx'] },
    description: 'MaterialX material',
    suggestedName: getMaterialXExportFilename(),
    text: createMaterialXExportSource(),
    type: 'application/xml',
  });
  setStatus(saved ? 'Exported MaterialX material' : 'Export canceled');
}

async function applyMaterialSettings(settings, controls, options = {}) {
  const {
    persistUrl = true,
    status = 'Loaded material settings',
    suffix = 'loaded',
    switchMaterial = true,
  } = options;
  const settingsMaterialId = typeof settings.materialId === 'string' && Object.hasOwn(materialSamples, settings.materialId)
    ? settings.materialId
    : activeMaterialId;

  if (switchMaterial && settingsMaterialId !== activeMaterialId) {
    await controls.materialControl.applyMaterial(settingsMaterialId, {
      preserveSettings: true,
      updateUrl: false,
    });
  }

  const sample = materialSamples[activeMaterialId] || materialSamples.standard;
  const appliedCount = applyMaterialSettingsToSample(sample, settings);
  if (!appliedCount) {
    throw new Error('No matching material settings were found.');
  }

  const uploadStart = performance.now();
  const writtenSample = writeMaterialUniforms(controls.publicUniformData, activeMaterialId, {
    shaderMode: activeShaderMode,
  });
  controls.device.queue.writeBuffer(controls.publicUniformBuffer, 0, controls.publicUniformData.bytes);
  controls.materialPropertiesControl.refresh();
  setMetric('materialUpload', formatDuration(performance.now() - uploadStart));
  setMetric('material', `${writtenSample.label} (${writtenSample.source}, ${suffix})`);
  if (persistUrl) {
    persistMaterialSettingsToUrl();
  }
  setStatus(status);
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
    activeShaderMode = Object.hasOwn(shaderModeLabels, select.value) ? select.value : 'naga';
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

function bindRendererModeSelect() {
  const select = document.getElementById('renderer-mode');
  if (!select) {
    updateFallbackStatus();
    return {
      refresh: () => {},
    };
  }

  const refresh = () => {
    select.value = activeRendererMode;
    updateFallbackStatus();
  };

  select.addEventListener('change', () => {
    activeRendererMode = Object.hasOwn(rendererModeLabels, select.value) ? select.value : 'auto';
    if (activeRendererMode === 'webgl') {
      routeToWebGlFallback('manual override');
      return;
    }

    updateQueryParam('renderer', activeRendererMode);
    updateFallbackStatus(activeRendererMode === 'direct'
      ? 'fallback disabled / Direct WebGPU forced'
      : undefined);
  });

  refresh();
  return {
    refresh,
  };
}

function bindEnvironmentControls() {
  const sampleSelect = document.getElementById('env-radiance-samples');
  const intensityInput = document.getElementById('env-light-intensity');
  const adaptiveToneInput = document.getElementById('adaptive-env-tone');
  const toneDebugInput = document.getElementById('env-tone-debug');
  const drawEnvironmentInput = document.getElementById('draw-environment');

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
      updateEnvironmentToneMetric();
    });
  }

  if (adaptiveToneInput) {
    adaptiveToneInput.checked = adaptiveEnvironmentToneEnabled;
    adaptiveToneInput.addEventListener('change', () => {
      adaptiveEnvironmentToneEnabled = adaptiveToneInput.checked;
      updateQueryParam('envTone', adaptiveEnvironmentToneEnabled ? 'adaptive' : 'linear');
      updateEnvironmentToneMetric();
      renderEnvironmentToneDebug();
    });
  }

  if (toneDebugInput) {
    toneDebugInput.checked = environmentToneDebugEnabled;
    toneDebugInput.addEventListener('change', () => {
      environmentToneDebugEnabled = toneDebugInput.checked;
      updateQueryParam('envToneDebug', environmentToneDebugEnabled ? '1' : '0');
      renderEnvironmentToneDebug();
    });
  }

  if (drawEnvironmentInput) {
    drawEnvironmentInput.checked = drawEnvironment;
    drawEnvironmentInput.addEventListener('change', () => {
      drawEnvironment = drawEnvironmentInput.checked;
      updateQueryParam('drawEnvironment', drawEnvironment ? '1' : '0');
      updateEnvironmentToneMetric();
      renderEnvironmentToneDebug();
    });
  }

  updateEnvironmentToneMetric();
  renderEnvironmentToneDebug();
}

function bindEnvironmentMapSelect(environmentPaths, onEnvironmentChanged) {
  const select = document.getElementById('environment-map');
  if (!select) {
    return {
      refresh: () => {},
      setDisabled: () => {},
    };
  }

  const paths = environmentPaths.length ? environmentPaths : [environmentFilename];
  const refresh = () => {
    select.replaceChildren();
    for (const path of paths) {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = prettyAssetName(path);
      select.append(option);
    }
    select.value = paths.includes(environmentFilename) ? environmentFilename : paths[0] || '';
  };

  const setDisabled = (disabled) => {
    select.disabled = disabled;
  };

  select.addEventListener('change', () => {
    const selectedEnvironment = select.value;
    setDisabled(true);
    Promise.resolve(onEnvironmentChanged?.(selectedEnvironment))
      .catch((error) => {
        console.warn('Environment update failed.', error);
        setMetric('environmentLoad', error?.message || String(error));
        setStatus('Environment update failed');
        select.value = paths.includes(environmentFilename) ? environmentFilename : paths[0] || '';
      })
      .finally(() => setDisabled(false));
  });

  refresh();
  return {
    refresh,
    setDisabled,
  };
}

function bindDirectLightControls() {
  const directLightInput = document.getElementById('direct-light');
  setMetric('directLight', describeDirectLight());

  if (!directLightInput) return;

  directLightInput.checked = directLightEnabled;
  directLightInput.addEventListener('change', () => {
    directLightEnabled = directLightInput.checked;
    setMetric('directLight', describeDirectLight());
    updateQueryParam('directLight', directLightEnabled ? '1' : '0');
  });
}

function bindMaterialPropertiesPanel(device, publicUniformBuffer, publicUniformData) {
  const root = document.querySelector('[data-material-properties]');
  const summary = document.querySelector('[data-material-properties-summary]');
  const resetButton = document.querySelector('[data-reset-material-settings]');
  if (!root) {
    return {
      refresh: () => {},
      refreshStatus: () => {},
    };
  }

  const refreshStatus = () => {
    const sample = materialSamples[activeMaterialId] || materialSamples.standard;
    const model = createMaterialPropertyModel({
      sample,
      shaderMode: activeShaderMode,
    });
    const dirty = isMaterialSettingsDirty(activeMaterialId);
    if (summary) {
      const shaderLabel = shaderModeLabels[activeShaderMode] || activeShaderMode;
      const editState = dirty ? 'edited' : 'default';
      summary.textContent = `${model.sampleLabel} / ${shaderLabel} / ${editState} / ${summarizeMaterialPropertySupport(model)}`;
    }
    if (resetButton) {
      resetButton.disabled = !dirty;
    }
  };

  const refresh = () => {
    const sample = materialSamples[activeMaterialId] || materialSamples.standard;
    const model = createMaterialPropertyModel({
      sample,
      shaderMode: activeShaderMode,
    });
    renderMaterialPropertiesPanel(root, model, {
      onChange: (property, value) => {
        if (property.status !== 'live') return;

        const activeSample = materialSamples[activeMaterialId] || materialSamples.standard;
        if (!setMaterialPropertyValue(activeSample, property, value, activeShaderMode)) return;

        const uploadStart = performance.now();
        const writtenSample = writeMaterialUniforms(publicUniformData, activeMaterialId, {
          shaderMode: activeShaderMode,
        });
        device.queue.writeBuffer(publicUniformBuffer, 0, publicUniformData.bytes);
        setMetric('materialUpload', formatDuration(performance.now() - uploadStart));
        setMetric('material', `${writtenSample.label} (${writtenSample.source}, edited)`);
        persistMaterialSettingsToUrl();
        refreshStatus();
      },
    });

    refreshStatus();
  };

  refresh();
  return {
    refresh,
    refreshStatus,
  };
}

async function applyMaterialSettingsFile(file, controls) {
  if (!file) return;

  const settings = parseMaterialSettings(await file.text());
  await applyMaterialSettings(settings, controls, {
    status: 'Loaded material settings',
    suffix: 'loaded',
  });
}

async function resetActiveMaterialSettings(controls) {
  const settings = materialSettingsDefaults.get(activeMaterialId);
  if (!settings) {
    throw new Error('No default settings are available for this material.');
  }

  await applyMaterialSettings(settings, controls, {
    persistUrl: false,
    status: 'Reset material settings',
    suffix: 'default',
    switchMaterial: false,
  });
  clearMaterialSettingsFromUrl();
}

function bindMaterialSettingsIo(controls) {
  const saveButton = document.querySelector('[data-save-material-settings]');
  const loadButton = document.querySelector('[data-load-material-settings]');
  const resetButton = document.querySelector('[data-reset-material-settings]');
  const exportButton = document.querySelector('[data-export-materialx]');
  const fileInput = document.querySelector('[data-load-material-settings-file]');

  const runButtonTask = async (button, task) => {
    if (button) button.disabled = true;
    try {
      await task();
    } catch (error) {
      console.warn('Material file operation failed.', error);
      setMetric('shaderNotes', error?.message || String(error));
      setStatus(error?.message || 'Material file operation failed');
    } finally {
      if (button) button.disabled = false;
      controls.materialPropertiesControl.refreshStatus();
    }
  };

  saveButton?.addEventListener('click', () => runButtonTask(saveButton, saveMaterialSettingsFile));
  exportButton?.addEventListener('click', () => runButtonTask(exportButton, exportMaterialXFile));
  loadButton?.addEventListener('click', () => runButtonTask(loadButton, async () => {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              accept: { 'application/json': ['.json'] },
              description: 'mxv material settings',
            },
          ],
        });
        if (!handle) return;
        await applyMaterialSettingsFile(await handle.getFile(), controls);
      } catch (error) {
        const handled = getMaterialSettingsHandleError(error);
        if (handled) throw handled;
        setStatus('Load canceled');
      }
      return;
    }

    fileInput?.click();
  }));
  resetButton?.addEventListener('click', () => runButtonTask(resetButton, () => resetActiveMaterialSettings(controls)));
  fileInput?.addEventListener('change', async () => {
    const [file] = fileInput.files || [];
    if (!file) return;

    loadButton.disabled = true;
    try {
      await applyMaterialSettingsFile(file, controls);
    } catch (error) {
      console.warn('Material settings load failed.', error);
      setMetric('shaderNotes', error?.message || String(error));
      setStatus('Material settings load failed');
    } finally {
      loadButton.disabled = false;
      fileInput.value = '';
    }
  });
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
  const material = materialSamples[sampleId] || materialSamples.standard;
  if (material?.naga?.vertexSource && material?.naga?.fragmentSource) {
    return {
      fragmentLineCount: material.naga.fragmentLineCount,
      fragmentSource: material.naga.fragmentSource,
      sampleId,
      source: 'runtime',
      translationDuration: material.naga.translationDuration,
      vertexLineCount: material.naga.vertexLineCount,
      vertexSource: material.naga.vertexSource,
    };
  }

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
    source: 'fixture',
    vertexLineCount: vertexSource.split('\n').length,
    vertexSource,
  };
}

async function createNagaPipeline(device, format, materialId) {
  const loadStart = performance.now();
  const loaded = await loadNagaShaderPair(materialId);
  const material = materialSamples[loaded.sampleId] || materialSamples.standard;
  const vertexLayout = material?.usesTexcoord || /@location\(1\)\s+\w*texcoord/i.test(loaded.vertexSource)
    ? 'textured'
    : 'standard';
  setMetric('shaderSource', `Naga ${loaded.vertexLineCount}v / ${loaded.fragmentLineCount}p lines`);

  const pipeline = await createPipeline(device, format, {
    fragmentEntryPoint: 'main',
    fragmentSource: loaded.fragmentSource,
    label: `Direct WebGPU Naga ${loaded.sampleId} shader`,
    vertexEntryPoint: 'main',
    vertexLayout,
    vertexSource: loaded.vertexSource,
  });

  setMetric('shaderTarget', 'Naga WGSL');
  setMetric('vertexAdapter', `Naga ${loaded.vertexLineCount} WGSL lines`);
  setMetric('fragmentAdapter', `Naga ${loaded.fragmentLineCount} WGSL lines`);
  const translationDetail = loaded.source === 'runtime'
    ? `runtime Naga ${nagaVersion} / ${formatDuration(loaded.translationDuration)}`
    : `Naga fixture / ${formatDuration(performance.now() - loadStart)}`;
  setMetric('fragmentTranslator', translationDetail);
  setMetric('shaderNotes', materialXKnownWarnings.size ? 'bool uniform mapped / Naga translated' : 'Naga translated');
  return pipeline;
}

function describeBindingContract(sample) {
  const textureCount = sample.textureBindings?.length || 0;
  const lightBinding = sample.lightDataBinding ?? 7;
  const textureUpperBinding = textureCount
    ? Math.max(...sample.textureBindings.flatMap(binding => [
        binding.textureBinding,
        binding.samplerBinding,
      ]))
    : 7;
  const upperBinding = Math.max(lightBinding, textureUpperBinding);
  const textureDetail = textureCount ? ` / ${textureCount} texture${textureCount === 1 ? '' : 's'}` : '';
  return `bindings 0-${upperBinding}${textureDetail} / ${sample.privateUniformCount} private ports / ${privatePixelByteLength} B`;
}

function updateBridgeShaderMetrics(sample) {
  if (!sample || sample.source !== 'shadergen' || !sample.bridgeCompatible || !sample.pixelContract) {
    setMetric('shaderTarget', 'Wgsl bridge');
    setMetric('shaderSource', sample?.source === 'shadergen' ? `${sample.vertexLines}v / ${sample.pixelLines}p lines` : 'bridge fallback');
    setMetric('fragmentAdapter', sample?.bridgeCompatible === false ? 'Naga-only texture graph' : 'bridge fallback');
    setMetric('fragmentTranslator', sample?.bridgeCompatible === false ? 'Naga-only texture graph' : 'bridge fallback');
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
      preserveSettings = false,
      updateUrl = true,
    } = options;
    const uploadStart = performance.now();
    activeMaterialId = materialId;
    select.value = activeMaterialId;
    const sample = writeMaterialUniforms(publicUniformData, activeMaterialId);
    device.queue.writeBuffer(publicUniformBuffer, 0, publicUniformData.bytes);
    setMetric('materialUpload', formatDuration(performance.now() - uploadStart));
    setMetric('material', `${sample.label} (${sample.source})`);
    setMetric('shaderContract', sample.uniformLayout && activeShaderMode === 'naga'
      ? `${sample.uniformCount} public ports / ${sample.uniformLayout.byteLength} B`
      : `${materialUniformLayout.ports.length} public ports / ${publicUniformByteLength} B`);
    setMetric('contract', sample.source === 'shadergen' && activeShaderMode === 'naga'
      ? describeBindingContract(sample)
      : `bindings 0-7 / ${privatePixelUniformPorts.length} private ports / ${privatePixelByteLength} B`);
    const callbackResult = onMaterialApplied?.(activeMaterialId, sample, options);
    let handledCallbackResult = callbackResult;
    if (callbackResult && typeof callbackResult.catch === 'function') {
      handledCallbackResult = callbackResult.catch((error) => {
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
      updateMaterialQueryParams(activeMaterialId, { clearSettings: !preserveSettings });
    }

    return handledCallbackResult || null;
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
  const shaderMode = resources.shaderMode || activeShaderMode;
  const sample = resources.sample || materialSamples.standard;
  const materialTextures = shaderMode === 'naga' ? resources.materialTextures || [] : [];
  const lightDataBinding = shaderMode === 'naga' ? sample.lightDataBinding ?? 7 : 7;
  const textureEntries = materialTextures.flatMap(binding => [
    {
      binding: binding.textureBinding,
      resource: binding.texture.createView(),
    },
    {
      binding: binding.samplerBinding,
      resource: resources.materialSampler,
    },
  ]);

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
      ...textureEntries,
      {
        binding: lightDataBinding,
        resource: { buffer: resources.lightDataBuffer },
      },
    ],
    layout: pipeline.getBindGroupLayout(0),
  });
}

function createEnvironmentBackgroundBindGroup(device, pipeline, resources) {
  return device.createBindGroup({
    entries: [
      {
        binding: 0,
        resource: { buffer: resources.environmentBackgroundBuffer },
      },
      {
        binding: 1,
        resource: resources.envRadianceTexture.createView(),
      },
      {
        binding: 2,
        resource: resources.envSampler,
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

  setStatus('Loading viewer assets');
  const environmentPaths = await initializeAssetManifest();
  setStatus('Requesting WebGPU device');
  const { device } = await createDevice();
  installWebGpuErrorReporting(device);
  const format = navigator.gpu.getPreferredCanvasFormat();
  let dimensions = configureCanvas(canvas, device, context, format);
  const cameraRig = createCameraRig(canvas, dimensions);
  let depthTexture = createDepthTexture(device, dimensions);
  let bridgeShaderSource = shaderSource;
  let pipeline = await createPipeline(device, format);
  const environmentBackgroundPipeline = await createEnvironmentBackgroundPipeline(device, format);

  const meshStart = performance.now();
  const geometry = await loadGeometry();
  const vertexBuffer = createBuffer(device, 'Shaderball vertices', geometry.vertices, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(device, 'Shaderball indices', geometry.indices, GPUBufferUsage.INDEX);
  setMetric('model', geometry.label);
  recordDuration('modelLoad', meshStart);
  setMetric('mesh', `${geometry.indices.length / 3} triangles`);
  let environmentTextures = await createEnvironmentTextures(device);
  activeEnvironmentToneSource = environmentTextures.environmentToneSource;
  activeEnvironmentToneDebugImageData = environmentTextures.environmentToneDebugImageData;
  activeEnvironmentToneStats = null;
  await applyEnvironmentLightRig(environmentFilename);

  const privateVertexData = new Float32Array(privateVertexFloatCount);
  const privatePixelData = createPrivatePixelUniformData();
  const environmentBackgroundData = new Float32Array(environmentBackgroundFloatCount);
  const publicUniformData = createMaterialUniformData();
  const lightData = createLightUniformData();
  writeLightUniforms(lightData);
  const privateVertexBuffer = createUniformBuffer(device, 'MaterialX PrivateUniforms vertex', privateVertexData);
  const privatePixelBuffer = createUniformBuffer(device, 'MaterialX PrivateUniforms pixel', privatePixelData.bytes);
  const environmentBackgroundBuffer = createUniformBuffer(device, 'MaterialX environment background uniforms', environmentBackgroundData);
  const publicUniformBuffer = createUniformBuffer(device, 'MaterialX PublicUniforms pixel port table', publicUniformData.bytes);
  const lightDataBuffer = createUniformBuffer(device, 'MaterialX LightData pixel', lightData.bytes);
  const envSampler = device.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  const materialSampler = device.createSampler({
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  const materialTextureCache = createMaterialTextureCache(device);
  device.queue.writeBuffer(lightDataBuffer, 0, lightData.bytes);
  setMetric('contract', `bindings 0-7 / private ${privatePixelByteLength} B`);
  const bindGroupResources = {
    ...environmentTextures,
    environmentBackgroundBuffer,
    envSampler,
    lightDataBuffer,
    materialSampler,
    privatePixelBuffer,
    privateVertexBuffer,
    publicUniformBuffer,
  };
  const createBindGroupForActiveMaterial = async (
    targetPipeline = pipeline,
    shaderMode = activeShaderMode,
    materialId = activeMaterialId,
  ) => {
    const sample = materialSamples[materialId] || materialSamples.standard;
    const materialTextures = shaderMode === 'naga'
      ? await loadMaterialTextureBindings(materialTextureCache, sample)
      : [];
    return createDirectBindGroup(device, targetPipeline, {
      ...bindGroupResources,
      materialTextures,
      sample,
      shaderMode,
    });
  };
  let bindGroup = await createBindGroupForActiveMaterial();
  let environmentBackgroundBindGroup = createEnvironmentBackgroundBindGroup(device, environmentBackgroundPipeline, bindGroupResources);
  let pipelineSwitchId = 0;
  let environmentSwitchId = 0;
  bindEnvironmentControls();
  bindDirectLightControls();
  bindEnvironmentMapSelect(environmentPaths, async (environmentPath) => {
    const switchId = ++environmentSwitchId;
    const nextTextures = await createEnvironmentTextures(device, environmentPath);
    if (switchId !== environmentSwitchId) return;

    environmentFilename = environmentPath;
    environmentTextures = nextTextures;
    activeEnvironmentToneSource = nextTextures.environmentToneSource;
    activeEnvironmentToneDebugImageData = nextTextures.environmentToneDebugImageData;
    activeEnvironmentToneStats = null;
    Object.assign(bindGroupResources, environmentTextures);
    bindGroup = await createBindGroupForActiveMaterial(pipeline, activeShaderMode, activeMaterialId);
    environmentBackgroundBindGroup = createEnvironmentBackgroundBindGroup(device, environmentBackgroundPipeline, bindGroupResources);
    await applyEnvironmentLightRig(environmentFilename, {
      writeLight: (light) => {
        writeLightUniforms(lightData, light);
        device.queue.writeBuffer(lightDataBuffer, 0, lightData.bytes);
      },
    });
    updateQueryParam('environment', prettyAssetName(environmentFilename));
    updateEnvironmentToneMetric();
    renderEnvironmentToneDebug();
    setStatus('Ready');
  });
  const applyPipelineForShaderMode = async (materialId, options = {}) => {
    const switchId = ++pipelineSwitchId;
    const material = materialSamples[materialId] || materialSamples.standard;
    if (options.requireShadergen && material?.source !== 'shadergen') return;

    setStatus(activeShaderMode === 'naga' ? 'Loading Naga WGSL shader' : 'Loading bridge shader');
    const sample = writeMaterialUniforms(publicUniformData, activeMaterialId, { shaderMode: activeShaderMode });
    device.queue.writeBuffer(publicUniformBuffer, 0, publicUniformData.bytes);
    setMetric('shaderContract', sample.uniformLayout && activeShaderMode === 'naga'
      ? `${sample.uniformCount} public ports / ${sample.uniformLayout.byteLength} B`
      : `${materialUniformLayout.ports.length} public ports / ${publicUniformByteLength} B`);
    setMetric('contract', sample.source === 'shadergen' && activeShaderMode === 'naga'
      ? describeBindingContract(sample)
      : `bindings 0-7 / ${privatePixelUniformPorts.length} private ports / ${privatePixelByteLength} B`);
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

    const nextBindGroup = await createBindGroupForActiveMaterial(nextPipeline, activeShaderMode, activeMaterialId);
    if (switchId !== pipelineSwitchId) return;

    pipeline = nextPipeline;
    bindGroup = nextBindGroup;
    setStatus('Ready');
  };
  const materialPropertiesControl = bindMaterialPropertiesPanel(device, publicUniformBuffer, publicUniformData);
  bindShaderModeSelect(() => {
    materialPropertiesControl.refresh();
    return applyPipelineForShaderMode(activeMaterialId, { requireShadergen: activeShaderMode === 'naga' });
  });
  const materialControl = bindMaterialSelect(device, publicUniformBuffer, publicUniformData, {
    onMaterialApplied: (materialId, sample, options = {}) => {
      materialPropertiesControl.refresh();
      if (activeShaderMode !== 'naga' || sample.source !== 'shadergen') return null;
      return applyPipelineForShaderMode(materialId, {
        requireShadergen: true,
        switchReason: options.measure ? 'material' : 'refresh',
      });
    },
  });
  const initialMaterialSettings = getRequestedMaterialSettings();
  bindMaterialSettingsIo({
    device,
    materialControl,
    materialPropertiesControl,
    publicUniformBuffer,
    publicUniformData,
  });
  const pipelineControl = {
    applyInitialMaterialSettings: () => {
      if (!initialMaterialSettings) return null;
      return applyMaterialSettings(initialMaterialSettings, {
        device,
        materialControl,
        materialPropertiesControl,
        publicUniformBuffer,
        publicUniformData,
      }, {
        persistUrl: false,
        status: 'Loaded URL material settings',
        suffix: 'URL',
      });
    },
    applyGeneratedVertexSource: async (generatedVertexSource) => {
      const adapterStart = performance.now();
      const adapted = adaptGeneratedVertexSource(generatedVertexSource);
      const adapterDuration = performance.now() - adapterStart;
      bridgeShaderSource = adapted.shaderSource;
      if (activeShaderMode === 'bridge') {
        const nextPipeline = await createPipeline(device, format, {
          label: 'Direct WebGPU generated vertex bridge shader',
          source: bridgeShaderSource,
        });
        const nextBindGroup = await createBindGroupForActiveMaterial(nextPipeline, activeShaderMode, activeMaterialId);
        pipeline = nextPipeline;
        bindGroup = nextBindGroup;
      }
      setMetric('vertexAdapter', `${adapted.lineCount} GLSL -> WGSL / ${formatDuration(adapterDuration)}`);
    },
    validateGeneratedFragmentTranslation: generatedFragmentWgsl => validateGeneratedFragmentTranslation(device, generatedFragmentWgsl),
    refreshActiveShaderMode: () => activeShaderMode === 'naga'
      ? applyPipelineForShaderMode(activeMaterialId, { requireShadergen: true })
      : null,
    updateLightData: (light) => {
      writeLightUniforms(lightData, light);
      device.queue.writeBuffer(lightDataBuffer, 0, lightData.bytes);
    },
  };

  initializeMaterialXShaderSupport(materialControl, pipelineControl).catch((error) => {
    console.error(error);
    setStatus('Shadergen fallback active');
  });

  window.addEventListener('resize', () => {
    dimensions = configureCanvas(canvas, device, context, format);
    depthTexture.destroy();
    depthTexture = createDepthTexture(device, dimensions);
  });

  const updateFps = createFpsMeter();
  let firstFrameRecorded = false;
  setStatus('Ready');

  function render(now) {
    writeFrameUniforms(privateVertexData, privatePixelData, dimensions, cameraRig, environmentTextures.envRadianceMipCount);
    updateEnvironmentToneForFrame(dimensions, cameraRig, now);
    writeEnvironmentBackgroundUniforms(environmentBackgroundData, dimensions, cameraRig);
    device.queue.writeBuffer(privateVertexBuffer, 0, privateVertexData);
    device.queue.writeBuffer(privatePixelBuffer, 0, privatePixelData.bytes);
    device.queue.writeBuffer(environmentBackgroundBuffer, 0, environmentBackgroundData);

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
    if (drawEnvironment) {
      pass.setPipeline(environmentBackgroundPipeline);
      pass.setBindGroup(0, environmentBackgroundBindGroup);
      pass.draw(3);
    }
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
  bindRendererModeSelect();
  if (activeRendererMode === 'webgl') {
    routeToWebGlFallback('manual override');
    return;
  }
  if (activeRendererMode === 'auto' && !isWebGpuProbeAvailable()) {
    routeToWebGlFallback('WebGPU unavailable');
    return;
  }

  main().catch(handleDirectStartupError);
});
