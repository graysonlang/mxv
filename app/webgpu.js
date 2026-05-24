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

const sampleMaterial = `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_webgpu_lab" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.72, 0.78, 0.84" />
    <input name="diffuse_roughness" type="float" value="0.34" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="0.34" />
    <input name="specular_IOR" type="float" value="1.5" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0" />
    <input name="subsurface" type="float" value="0" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="emission" type="float" value="0" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="WebGPULabMaterial" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_webgpu_lab" />
  </surfacematerial>
</materialx>`;

const state = {
  activeStage: 'vertex',
  shaderSources: {},
};

function setText(selector, text) {
  const node = document.querySelector(selector);
  if (node) node.textContent = text;
}

function setStatus(text) {
  setText('[data-status]', text);
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

function bindShaderTabs() {
  document.querySelectorAll('[data-stage]').forEach((button) => {
    button.addEventListener('click', () => setShaderSource(button.dataset.stage));
  });
}

function bindMaterialControls(material) {
  const controls = [
    ['roughness', (value) => { material.roughness = value; }],
    ['metalness', (value) => { material.metalness = value; }],
    ['clearcoat', (value) => { material.clearcoat = value; }],
    ['transmission', (value) => {
      material.transmission = value;
      material.opacity = value > 0 ? Math.max(0.28, 1 - value * 0.48) : 1;
      material.transparent = value > 0;
    }],
  ];

  document.querySelector('#base-color')?.addEventListener('input', (event) => {
    material.color.set(event.target.value);
    material.needsUpdate = true;
  });

  for (const [id, apply] of controls) {
    const input = document.getElementById(id);
    const output = document.querySelector(`[data-output="${id}"]`);
    if (!input) continue;

    const update = () => {
      const value = Number(input.value);
      apply(value);
      if (output) output.textContent = value.toFixed(2);
      material.needsUpdate = true;
    };

    input.addEventListener('input', update);
    update();
  }
}

function createPreviewMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xb7c7d7,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.22,
    transmission: 0,
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

  const document = mx.createDocument();
  await mx.readFromXmlString(document, sampleMaterial);

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
    name: element.getNamePath(),
    pixel: shader.getSourceCode('pixel'),
    vertex: shader.getSourceCode('vertex'),
  };
}

async function initializeMaterialXPanel() {
  try {
    setStatus('Loading assets');
    await loadAssetManifest();

    setStatus('Loading MaterialX');
    const mx = await loadMaterialX();

    setStatus('Generating shader source');
    state.shaderSources = await generateWebGpuFlavorShader(mx);
    setShaderSource(state.activeStage);
  } catch (error) {
    console.error(error);
    state.shaderSources = {
      pixel: error?.stack || String(error),
      vertex: error?.stack || String(error),
    };
    setShaderSource(state.activeStage);
  }
}

async function createRenderer(canvas) {
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
    return;
  } catch (error) {
    console.warn('Could not load WebGPU lab geometry.', error);
  }

  const model = createFallbackModel(material);
  scene.add(model);
  fitCameraToObject(camera, controls, model);
  setText('[data-model]', model.name);
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

  return function updateFps(now) {
    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed < 500) return;

    const fps = Math.round(frameCount * 1000 / elapsed);
    setText('[data-fps]', `${fps} fps`);
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
  setStatus('Ready');

  renderer.setAnimationLoop(() => {
    controls.update();
    updateFps(performance.now());
    renderer.render(scene, camera);
  });
}

window.addEventListener('load', () => {
  main().catch((error) => {
    console.error(error);
    setStatus('Failed');
    setText('[data-source]', error?.stack || String(error));
  });
});
