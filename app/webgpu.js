// This import+export makes sure webgpu.html is copied to dist and the import
// is not stripped out during bundling.
import index from './webgpu.html';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { loadAssetManifest } from '../src/index.js';

export function getFilePaths() {
  return { index };
}

const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);
const defaultGeometry = 'vendor/MaterialX/resources/Geometry/shaderball.glb';
const defaultEnvironment = 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.hdr';
const cameraFov = 60;
const cameraNear = 0.05;
const cameraFar = 100;
const queryParams = new URLSearchParams(document.location.search);
const forceWebGL = queryParams.get('renderer') === 'webgl' || queryParams.get('forceWebGL') === '1';
const appStartTime = performance.now();

const materialDefaults = {
  baseColor: '#b7c7d7',
  clearcoat: 0.45,
  coatAffectColor: 0,
  coatAffectRoughness: 0,
  coatAnisotropy: 0,
  coatColor: '#ffffff',
  coatIor: 1.5,
  coatRotation: 0,
  coatRoughness: null,
  emission: 0,
  emissionColor: '#ffffff',
  metalness: 0,
  roughness: 0.34,
  sheen: 0,
  sheenColor: '#ffffff',
  sheenRoughness: 0.3,
  specular: 1,
  specularAnisotropy: 0,
  specularColor: '#ffffff',
  specularIor: 1.5,
  subsurface: 0,
  subsurfaceAnisotropy: 0,
  subsurfaceColor: '#ffffff',
  subsurfaceRadius: '#ffffff',
  subsurfaceScale: 1,
  thinFilmIor: 1.5,
  thinFilmThickness: 0,
  transmission: 0,
  transmissionColor: '#ffffff',
};

const materialPresets = {
  coatedPlastic: {
    label: 'Coated Plastic',
    values: {
      baseColor: '#b7c7d7',
      clearcoat: 0.45,
      metalness: 0,
      roughness: 0.34,
      transmission: 0,
    },
  },
  brushedAluminum: {
    label: 'Brushed Aluminum',
    values: {
      baseColor: '#c6c2b8',
      clearcoat: 0.08,
      metalness: 1,
      roughness: 0.24,
      transmission: 0,
    },
  },
  glazedCeramic: {
    label: 'Glazed Ceramic',
    values: {
      baseColor: '#f0e7d4',
      clearcoat: 0.82,
      metalness: 0,
      roughness: 0.16,
      transmission: 0,
    },
  },
  pearl: {
    label: 'Pearl',
    values: {
      baseColor: '#f6f1e6',
      clearcoat: 0.92,
      coatAffectColor: 0.35,
      coatAffectRoughness: 0.18,
      coatColor: '#f8fbff',
      coatIor: 1.62,
      coatRoughness: 0.06,
      roughness: 0.18,
      sheen: 0.22,
      sheenColor: '#cfd8ff',
      sheenRoughness: 0.38,
      specularColor: '#f7f4ff',
      specularIor: 1.52,
      subsurface: 0.38,
      subsurfaceColor: '#fff0d8',
      subsurfaceRadius: '#ffd9bf',
      subsurfaceScale: 0.42,
      thinFilmIor: 1.42,
      thinFilmThickness: 520,
      transmission: 0.08,
      transmissionColor: '#fff8e7',
    },
  },
  softRubber: {
    label: 'Soft Rubber',
    values: {
      baseColor: '#202528',
      clearcoat: 0.02,
      metalness: 0,
      roughness: 0.82,
      transmission: 0,
    },
  },
  smokedGlass: {
    label: 'Smoked Glass',
    values: {
      baseColor: '#7c98a3',
      clearcoat: 0.7,
      metalness: 0,
      roughness: 0.04,
      transmission: 0.72,
    },
  },
};
const requestedMaterialPreset = queryParams.get('material');
const defaultMaterialPreset = Object.hasOwn(materialPresets, requestedMaterialPreset) ? requestedMaterialPreset : 'coatedPlastic';
const materialState = getMaterialPresetValues(defaultMaterialPreset);
const materialControlIds = [
  'roughness',
  'metalness',
  'clearcoat',
  'transmission',
];

const state = {
  activeStage: 'vertex',
  activePreset: defaultMaterialPreset,
  mx: null,
  shaderGenerationTimer: null,
  shaderRequestId: 0,
  shaderSources: {},
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

function setShaderSource(stage) {
  state.activeStage = stage;
  setText('[data-source]', state.shaderSources[stage] || 'No source generated.');

  document.querySelectorAll('[data-stage]').forEach((button) => {
    const selected = button.dataset.stage === stage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function formatMaterialFloat(value) {
  return Number(value).toFixed(3);
}

function getMaterialPresetValues(presetId) {
  return {
    ...materialDefaults,
    ...(materialPresets[presetId]?.values || {}),
  };
}

function hexToRgbFloats(hex) {
  const normalized = hex.replace(/^#/, '');
  const value = Number.parseInt(normalized, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function formatMaterialColor(value) {
  return hexToRgbFloats(value).map(formatMaterialFloat).join(', ');
}

function getMaterialPresetName() {
  return state.activePreset === 'custom' ? 'custom' : state.activePreset;
}

function getMaterialPresetLabel() {
  return state.activePreset === 'custom' ? 'Custom' : materialPresets[state.activePreset]?.label || 'Custom';
}

function getMaterialNodeSuffix() {
  return getMaterialPresetName().replace(/[^A-Za-z0-9_]/g, '_');
}

function createMaterialXSource() {
  const baseColor = formatMaterialColor(materialState.baseColor);
  const coatColor = formatMaterialColor(materialState.coatColor);
  const emissionColor = formatMaterialColor(materialState.emissionColor);
  const roughness = formatMaterialFloat(materialState.roughness);
  const metalness = formatMaterialFloat(materialState.metalness);
  const clearcoat = formatMaterialFloat(materialState.clearcoat);
  const coatAffectColor = formatMaterialFloat(materialState.coatAffectColor);
  const coatAffectRoughness = formatMaterialFloat(materialState.coatAffectRoughness);
  const coatAnisotropy = formatMaterialFloat(materialState.coatAnisotropy);
  const coatIor = formatMaterialFloat(materialState.coatIor);
  const coatRotation = formatMaterialFloat(materialState.coatRotation);
  const transmission = formatMaterialFloat(materialState.transmission);
  const transmissionColor = formatMaterialColor(materialState.transmissionColor);
  const coatRoughness = formatMaterialFloat(materialState.coatRoughness ?? Math.max(0.04, materialState.roughness * 0.65));
  const emission = formatMaterialFloat(materialState.emission);
  const sheen = formatMaterialFloat(materialState.sheen);
  const sheenColor = formatMaterialColor(materialState.sheenColor);
  const sheenRoughness = formatMaterialFloat(materialState.sheenRoughness);
  const specular = formatMaterialFloat(materialState.specular);
  const specularAnisotropy = formatMaterialFloat(materialState.specularAnisotropy);
  const specularColor = formatMaterialColor(materialState.specularColor);
  const specularIor = formatMaterialFloat(materialState.specularIor);
  const subsurface = formatMaterialFloat(materialState.subsurface);
  const subsurfaceAnisotropy = formatMaterialFloat(materialState.subsurfaceAnisotropy);
  const subsurfaceColor = formatMaterialColor(materialState.subsurfaceColor);
  const subsurfaceRadius = formatMaterialColor(materialState.subsurfaceRadius);
  const subsurfaceScale = formatMaterialFloat(materialState.subsurfaceScale);
  const thinFilmIor = formatMaterialFloat(materialState.thinFilmIor);
  const thinFilmThickness = formatMaterialFloat(materialState.thinFilmThickness);
  const nodeSuffix = getMaterialNodeSuffix();

  return `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <!-- Preset: ${getMaterialPresetLabel()} -->
  <standard_surface name="SR_${nodeSuffix}" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="${baseColor}" />
    <input name="diffuse_roughness" type="float" value="${roughness}" />
    <input name="specular" type="float" value="${specular}" />
    <input name="specular_color" type="color3" value="${specularColor}" />
    <input name="specular_roughness" type="float" value="${roughness}" />
    <input name="specular_IOR" type="float" value="${specularIor}" />
    <input name="specular_anisotropy" type="float" value="${specularAnisotropy}" />
    <input name="metalness" type="float" value="${metalness}" />
    <input name="transmission" type="float" value="${transmission}" />
    <input name="transmission_color" type="color3" value="${transmissionColor}" />
    <input name="subsurface" type="float" value="${subsurface}" />
    <input name="subsurface_color" type="color3" value="${subsurfaceColor}" />
    <input name="subsurface_radius" type="color3" value="${subsurfaceRadius}" />
    <input name="subsurface_scale" type="float" value="${subsurfaceScale}" />
    <input name="subsurface_anisotropy" type="float" value="${subsurfaceAnisotropy}" />
    <input name="sheen" type="float" value="${sheen}" />
    <input name="sheen_color" type="color3" value="${sheenColor}" />
    <input name="sheen_roughness" type="float" value="${sheenRoughness}" />
    <input name="coat" type="float" value="${clearcoat}" />
    <input name="coat_color" type="color3" value="${coatColor}" />
    <input name="coat_roughness" type="float" value="${coatRoughness}" />
    <input name="coat_anisotropy" type="float" value="${coatAnisotropy}" />
    <input name="coat_rotation" type="float" value="${coatRotation}" />
    <input name="coat_IOR" type="float" value="${coatIor}" />
    <input name="coat_affect_color" type="float" value="${coatAffectColor}" />
    <input name="coat_affect_roughness" type="float" value="${coatAffectRoughness}" />
    <input name="thin_film_thickness" type="float" value="${thinFilmThickness}" />
    <input name="thin_film_IOR" type="float" value="${thinFilmIor}" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="emission" type="float" value="${emission}" />
    <input name="emission_color" type="color3" value="${emissionColor}" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="MAT_${nodeSuffix}" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_${nodeSuffix}" />
  </surfacematerial>
</materialx>`;
}

function applyMaterialState(material) {
  material.color.set(materialState.baseColor);
  material.roughness = materialState.roughness;
  material.metalness = materialState.metalness;
  material.clearcoat = materialState.clearcoat;
  material.clearcoatRoughness = materialState.coatRoughness ?? Math.max(0.04, materialState.roughness * 0.65);
  material.ior = materialState.specularIor;
  material.transmission = materialState.transmission;
  material.thickness = materialState.transmission > 0 ? 0.18 : 0.08;
  material.opacity = materialState.transmission > 0 ? Math.max(0.28, 1 - materialState.transmission * 0.48) : 1;
  material.transparent = materialState.transmission > 0;

  if ('iridescence' in material) {
    material.iridescence = materialState.thinFilmThickness > 0 ? Math.min(1, materialState.clearcoat + materialState.sheen) : 0;
    material.iridescenceIOR = materialState.thinFilmIor;
    material.iridescenceThicknessRange = materialState.thinFilmThickness > 0
      ? [Math.max(0, materialState.thinFilmThickness - 120), materialState.thinFilmThickness + 120]
      : [100, 400];
  }

  if ('sheen' in material) {
    material.sheen = materialState.sheen;
    material.sheenRoughness = materialState.sheenRoughness;
    material.sheenColor.set(materialState.sheenColor);
  }

  if ('attenuationColor' in material) {
    material.attenuationColor.set(materialState.transmissionColor);
  }

  material.needsUpdate = true;
}

function syncMaterialControls() {
  const presetSelect = document.getElementById('material-preset');
  if (presetSelect) presetSelect.value = state.activePreset;

  const colorInput = document.querySelector('#base-color');
  if (colorInput) colorInput.value = materialState.baseColor;

  for (const id of materialControlIds) {
    const input = document.getElementById(id);
    const output = document.querySelector(`[data-output="${id}"]`);
    if (input) input.value = String(materialState[id]);
    if (output) output.textContent = materialState[id].toFixed(2);
  }
}

function markCustomPreset() {
  state.activePreset = 'custom';
  const presetSelect = document.getElementById('material-preset');
  if (presetSelect) presetSelect.value = state.activePreset;
}

function applyPreset(presetId, material) {
  const preset = materialPresets[presetId];
  if (!preset) return;

  state.activePreset = presetId;
  Object.assign(materialState, getMaterialPresetValues(presetId));
  syncMaterialControls();
  applyMaterialState(material);
  scheduleShaderRegeneration();
}

function scheduleShaderRegeneration() {
  if (!state.mx) return;
  clearTimeout(state.shaderGenerationTimer);
  state.shaderGenerationTimer = setTimeout(() => {
    regenerateShaderSource();
  }, 160);
}

function bindShaderTabs() {
  document.querySelectorAll('[data-stage]').forEach((button) => {
    button.addEventListener('click', () => setShaderSource(button.dataset.stage));
  });
}

function bindMaterialPresetSelect(material) {
  const presetSelect = document.getElementById('material-preset');
  if (!presetSelect) return;

  const presetOptions = Object.entries(materialPresets)
    .map(([id, preset]) => `<option value="${id}">${preset.label}</option>`)
    .join('');
  presetSelect.innerHTML = `${presetOptions}<option value="custom">Custom</option>`;
  presetSelect.value = state.activePreset;

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value === 'custom') {
      state.activePreset = 'custom';
      scheduleShaderRegeneration();
      return;
    }

    applyPreset(presetSelect.value, material);
  });
}

function bindMaterialControls(material) {
  bindMaterialPresetSelect(material);
  const colorInput = document.querySelector('#base-color');

  colorInput?.addEventListener('input', (event) => {
    markCustomPreset();
    materialState.baseColor = event.target.value;
    applyMaterialState(material);
    scheduleShaderRegeneration();
  });

  for (const id of materialControlIds) {
    const input = document.getElementById(id);
    if (!input) continue;

    const update = () => {
      markCustomPreset();
      const value = Number(input.value);
      materialState[id] = value;
      applyMaterialState(material);
      const output = document.querySelector(`[data-output="${id}"]`);
      if (output) output.textContent = value.toFixed(2);
      scheduleShaderRegeneration();
    };

    input.addEventListener('input', update);
  }

  syncMaterialControls();
  applyMaterialState(material);
}

function createPreviewMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: materialState.baseColor,
    thickness: 0.16,
    ior: 1.5,
    envMapIntensity: 1.15,
    side: THREE.DoubleSide,
  });

  bindMaterialControls(material);
  return material;
}

async function loadMaterialX() {
  const loaderUrl = new URL('JsMaterialXGenShader.js', runtimeBaseUrl).href;
  const { default: createMaterialX } = await import(loaderUrl);
  return createMaterialX({
    locateFile: file => new URL(file, runtimeBaseUrl).href,
  });
}

async function generateWebGpuFlavorShader(mx) {
  if (!mx.WgslShaderGenerator) {
    throw new Error('MaterialX runtime does not expose WgslShaderGenerator.');
  }

  const materialx = createMaterialXSource();
  const document = mx.createDocument();
  await mx.readFromXmlString(document, materialx);

  const generator = mx.WgslShaderGenerator.create();
  const context = new mx.GenContext(generator);
  const standardLibraries = mx.loadStandardLibraries(context);
  document.importLibrary(standardLibraries);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error('No renderable MaterialX element found.');
  }

  context.getOptions().shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;
  const shader = generator.generate(element.getNamePath(), element, context);

  return {
    materialx,
    name: element.getNamePath(),
    pixel: shader.getSourceCode('pixel'),
    vertex: shader.getSourceCode('vertex'),
  };
}

async function regenerateShaderSource() {
  if (!state.mx) return;
  const requestId = ++state.shaderRequestId;
  const start = performance.now();

  try {
    setStatus('Generating shader source');
    const shaderSources = await generateWebGpuFlavorShader(state.mx);
    if (requestId !== state.shaderRequestId) return;

    state.shaderSources = shaderSources;
    recordDuration('shaderGeneration', start);
    setShaderSource(state.activeStage);
    setStatus('Ready');
  } catch (error) {
    console.error(error);
    state.shaderSources = {
      materialx: createMaterialXSource(),
      pixel: error?.stack || String(error),
      vertex: error?.stack || String(error),
    };
    recordDuration('shaderGeneration', start);
    setShaderSource(state.activeStage);
    setStatus('Shader generation failed');
  }
}

async function initializeMaterialXPanel() {
  try {
    setStatus('Loading assets');
    const assetStart = performance.now();
    await loadAssetManifest();
    recordDuration('assetManifest', assetStart);

    setStatus('Loading MaterialX');
    const materialXStart = performance.now();
    const mx = await loadMaterialX();
    state.mx = mx;
    recordDuration('materialXLoad', materialXStart);

    await regenerateShaderSource();
  } catch (error) {
    console.error(error);
    state.shaderSources = {
      materialx: createMaterialXSource(),
      pixel: error?.stack || String(error),
      vertex: error?.stack || String(error),
    };
    setShaderSource(state.activeStage);
  }
}

async function createRenderer(canvas) {
  const start = performance.now();
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    canvas,
    forceWebGL,
    powerPreference: 'high-performance',
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  await renderer.init();
  setText('[data-backend]', renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback');
  recordDuration('rendererInit', start);

  return renderer;
}

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101312);

  const camera = new THREE.PerspectiveCamera(cameraFov, window.innerWidth / window.innerHeight, cameraNear, cameraFar);
  camera.position.set(0.25, 0.35, 2.6);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(3, 4, 2);
  scene.add(keyLight);
  scene.add(new THREE.HemisphereLight(0xd8f1ff, 0x28221d, 0.45));

  return { camera, scene };
}

async function loadEnvironment(scene, renderer) {
  const start = performance.now();
  try {
    const texture = await new HDRLoader().loadAsync(defaultEnvironment);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromEquirectangular(texture);
    scene.environment = envTarget.texture;
    scene.background = texture;
  } catch (error) {
    console.warn('Could not load WebGPU lab environment.', error);
  }
  recordDuration('environmentSetup', start);
}

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  const radius = Math.max(sphere.radius, 0.5);
  camera.position.set(
    sphere.center.x,
    sphere.center.y,
    sphere.center.z + radius * 2.0,
  );
  camera.near = cameraNear;
  camera.far = cameraFar;
  camera.updateProjectionMatrix();

  controls.target.copy(sphere.center);
  controls.update();
}

function createFallbackModel(material) {
  const geometry = new THREE.SphereGeometry(0.8, 96, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Fallback sphere';
  return mesh;
}

async function loadModel(scene, camera, controls, material) {
  const start = performance.now();
  const geometryUrl = queryParams.get('geom') || defaultGeometry;

  try {
    const gltf = await new GLTFLoader().loadAsync(geometryUrl);
    const model = gltf.scene;
    let meshCount = 0;

    model.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      child.material = material;
      meshCount++;
    });

    scene.add(model);
    fitCameraToObject(camera, controls, model);
    setText('[data-model]', `${geometryUrl.split('/').pop()} (${meshCount})`);
    recordDuration('modelLoad', start);
    return;
  } catch (error) {
    console.warn('Could not load WebGPU lab geometry.', error);
  }

  const model = createFallbackModel(material);
  scene.add(model);
  fitCameraToObject(camera, controls, model);
  setText('[data-model]', model.name);
  recordDuration('modelLoad', start);
}

function bindResize(renderer, camera) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
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

async function main() {
  bindShaderTabs();

  const canvas = document.getElementById('webgpu-canvas');
  const renderer = await createRenderer(canvas);
  const { camera, scene } = createScene();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  const material = createPreviewMaterial();

  await Promise.all([
    initializeMaterialXPanel(),
    loadEnvironment(scene, renderer),
    loadModel(scene, camera, controls, material),
  ]);

  bindResize(renderer, camera);
  const updateFps = createFpsMeter();
  let firstFrameRecorded = false;
  setStatus('Ready');

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    const now = performance.now();
    if (!firstFrameRecorded) {
      firstFrameRecorded = true;
      setMetric('firstFrame', formatDuration(now - appStartTime));
    }
    updateFps(now);
  });
}

window.addEventListener('load', () => {
  main().catch((error) => {
    console.error(error);
    setStatus('Failed');
    setText('[data-source]', error?.stack || String(error));
  });
});
