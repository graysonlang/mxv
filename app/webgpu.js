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
const queryParams = new URLSearchParams(document.location.search);
const forceWebGL = queryParams.get('renderer') === 'webgl' || queryParams.get('forceWebGL') === '1';
const appStartTime = performance.now();

const materialState = {
  baseColor: '#b7c7d7',
  clearcoat: 0.45,
  metalness: 0,
  roughness: 0.34,
  transmission: 0,
};

const state = {
  activeStage: 'vertex',
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

function hexToRgbFloats(hex) {
  const normalized = hex.replace(/^#/, '');
  const value = Number.parseInt(normalized, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function createMaterialXSource() {
  const [r, g, b] = hexToRgbFloats(materialState.baseColor).map(formatMaterialFloat);
  const roughness = formatMaterialFloat(materialState.roughness);
  const metalness = formatMaterialFloat(materialState.metalness);
  const clearcoat = formatMaterialFloat(materialState.clearcoat);
  const transmission = formatMaterialFloat(materialState.transmission);
  const coatRoughness = formatMaterialFloat(Math.max(0.04, materialState.roughness * 0.65));

  return `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_webgpu_lab" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="${r}, ${g}, ${b}" />
    <input name="diffuse_roughness" type="float" value="${roughness}" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="${roughness}" />
    <input name="specular_IOR" type="float" value="1.5" />
    <input name="metalness" type="float" value="${metalness}" />
    <input name="transmission" type="float" value="${transmission}" />
    <input name="coat" type="float" value="${clearcoat}" />
    <input name="coat_roughness" type="float" value="${coatRoughness}" />
    <input name="subsurface" type="float" value="0" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="emission" type="float" value="0" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="WebGPULabMaterial" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_webgpu_lab" />
  </surfacematerial>
</materialx>`;
}

function applyMaterialState(material) {
  material.color.set(materialState.baseColor);
  material.roughness = materialState.roughness;
  material.metalness = materialState.metalness;
  material.clearcoat = materialState.clearcoat;
  material.clearcoatRoughness = Math.max(0.04, materialState.roughness * 0.65);
  material.transmission = materialState.transmission;
  material.opacity = materialState.transmission > 0 ? Math.max(0.28, 1 - materialState.transmission * 0.48) : 1;
  material.transparent = materialState.transmission > 0;
  material.needsUpdate = true;
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

function bindMaterialControls(material) {
  const controls = [
    'roughness',
    'metalness',
    'clearcoat',
    'transmission',
  ];

  const colorInput = document.querySelector('#base-color');
  if (colorInput) {
    colorInput.value = materialState.baseColor;
  }

  colorInput?.addEventListener('input', (event) => {
    materialState.baseColor = event.target.value;
    applyMaterialState(material);
    scheduleShaderRegeneration();
  });

  for (const id of controls) {
    const input = document.getElementById(id);
    const output = document.querySelector(`[data-output="${id}"]`);
    if (!input) continue;

    const update = () => {
      const value = Number(input.value);
      materialState[id] = value;
      applyMaterialState(material);
      if (output) output.textContent = value.toFixed(2);
      scheduleShaderRegeneration();
    };

    input.value = String(materialState[id]);
    if (output) output.textContent = materialState[id].toFixed(2);
    input.addEventListener('input', update);
  }

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

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 100);
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
    sphere.center.x + radius * 0.12,
    sphere.center.y + radius * 0.22,
    sphere.center.z + radius * 2.4,
  );
  camera.near = Math.max(radius / 200, 0.01);
  camera.far = Math.max(radius * 12, 20);
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
  controls.enableDamping = true;

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
