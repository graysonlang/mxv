// This import+export makes sure index.html is copied to dist and the import
// is not stripped out during bundling.
import index from './index.html';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Viewer } from './materialx-viewer/viewer.js';
import {
  dragOverHandler,
  dropHandler,
  setLoadingCallback,
  setSceneLoadingCallback,
} from './materialx-viewer/dropHandling.js';
import { loadAssetManifest } from '../src/index.js';

export function getFilePaths() {
  return { index };
}

const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);
const defaultMaterial = 'vendor/MaterialX/resources/Materials/Examples/StandardSurface/standard_surface_default.mtlx';
const defaultGeometry = 'vendor/MaterialX/resources/Geometry/shaderball.glb';
const queryParams = new URLSearchParams(document.location.search);
const qualityProfiles = {
  performance: {
    label: 'Performance: DPR 1, AA off',
    maxPixelRatio: 1,
    antialias: false,
  },
  balanced: {
    label: 'Balanced: DPR 1.25, AA off',
    maxPixelRatio: 1.25,
    antialias: false,
  },
  high: {
    label: 'High: DPR 1.5, AA on',
    maxPixelRatio: 1.5,
    antialias: true,
  },
  native: {
    label: 'Native: DPR 2, AA on',
    maxPixelRatio: 2,
    antialias: true,
  },
  adaptive: {
    label: 'Adaptive: DPR 1 moving, DPR 2 idle',
    maxPixelRatio: 2,
    interactiveMaxPixelRatio: 1,
    antialias: true,
  },
};

let renderer;
let orbitControls;
let viewer;
let fpsOverlay;
let showFPS = true;
let lastFrameTime = performance.now();
let frameCount = 0;
let turntableEnabled = false;
let turntableStep = 0;
let captureRequested = false;
let materialFilename = queryParams.get('file') || defaultMaterial;
let qualityMode = getRequestedQualityMode();
let interactiveQualityRestoreTimer;
let useInteractivePixelRatio = false;
let materialXResourcePaths = [];

function getRequestedQualityMode() {
  const requested = queryParams.get('quality') || 'native';
  return Object.hasOwn(qualityProfiles, requested) ? requested : 'native';
}

function getQualityProfile(mode = qualityMode) {
  return qualityProfiles[mode] || qualityProfiles.balanced;
}

function getRenderPixelRatio(profile = getQualityProfile()) {
  const maxPixelRatio = useInteractivePixelRatio && profile.interactiveMaxPixelRatio
    ? profile.interactiveMaxPixelRatio
    : profile.maxPixelRatio;
  return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function isAdaptiveQuality(profile = getQualityProfile()) {
  return profile.interactiveMaxPixelRatio && profile.interactiveMaxPixelRatio < profile.maxPixelRatio;
}

function prettyName(path) {
  const file = path.split('/').pop() || path;
  return file
    .replace(/\.(mtlx|glb)$/u, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/\b\w/gu, char => char.toUpperCase());
}

function getMaterialPaths() {
  return materialXResourcePaths
    .filter(path => path.includes('/Materials/Examples/') && path.endsWith('.mtlx'))
    .sort((a, b) => prettyName(a).localeCompare(prettyName(b)));
}

function getGeometryPaths() {
  return materialXResourcePaths
    .filter(path => path.includes('/Geometry/') && path.endsWith('.glb'))
    .sort((a, b) => prettyName(a).localeCompare(prettyName(b)));
}

function populateSelect(select, paths, fallback) {
  select.replaceChildren();
  for (const path of paths) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = prettyName(path);
    select.append(option);
  }

  select.value = paths.includes(fallback) ? fallback : paths[0] || '';
  return select.value;
}

function populateQualitySelect(select) {
  select.replaceChildren();
  for (const [mode, profile] of Object.entries(qualityProfiles)) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = profile.label;
    select.append(option);
  }

  select.value = qualityMode;
}

function getQualityUrl(mode) {
  const params = new URLSearchParams(document.location.search);
  params.set('quality', mode);
  return `${document.location.pathname}?${params.toString()}${document.location.hash}`;
}

function setStatus(message) {
  const status = document.querySelector('[data-status]');
  if (status) status.textContent = message;
}

function applyRenderQuality() {
  const profile = getQualityProfile();
  renderer.setPixelRatio(getRenderPixelRatio(profile));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setInteractiveRenderQuality(enabled) {
  if (!isAdaptiveQuality()) return;
  if (useInteractivePixelRatio === enabled) return;
  useInteractivePixelRatio = enabled;
  applyRenderQuality();
}

function beginInteractiveRenderQuality() {
  window.clearTimeout(interactiveQualityRestoreTimer);
  setInteractiveRenderQuality(true);
}

function endInteractiveRenderQuality() {
  window.clearTimeout(interactiveQualityRestoreTimer);
  interactiveQualityRestoreTimer = window.setTimeout(() => setInteractiveRenderQuality(false), 250);
}

function resetInteractiveRenderQuality() {
  window.clearTimeout(interactiveQualityRestoreTimer);
  useInteractivePixelRatio = false;
}

function handleQualityChange(event) {
  const nextMode = event.target.value;
  if (nextMode === qualityMode) return;

  const currentProfile = getQualityProfile();
  const nextProfile = getQualityProfile(nextMode);
  const nextUrl = getQualityUrl(nextMode);

  if (currentProfile.antialias !== nextProfile.antialias) {
    window.location.assign(nextUrl);
    return;
  }

  qualityMode = nextMode;
  resetInteractiveRenderQuality();
  history.replaceState(null, '', nextUrl);
  if (turntableEnabled) {
    setInteractiveRenderQuality(true);
  }
  applyRenderQuality();
  setStatus(`Quality: ${nextProfile.label}`);
}

async function loadMaterialX() {
  const loaderUrl = new URL('JsMaterialXGenShader.js', runtimeBaseUrl).href;
  const { default: createMaterialX } = await import(loaderUrl);
  return createMaterialX({
    locateFile: file => new URL(file, runtimeBaseUrl).href,
  });
}

function loadWith(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function createFPSOverlay() {
  fpsOverlay = document.createElement('div');
  fpsOverlay.className = 'fps-overlay';
  fpsOverlay.textContent = 'FPS: 0';
  document.body.append(fpsOverlay);
}

function setFPSOverlayVisible(visible) {
  if (fpsOverlay) fpsOverlay.style.display = visible ? 'block' : 'none';
}

function captureFrame() {
  const canvas = document.getElementById('webglcanvas');
  const link = document.createElement('a');
  link.href = canvas.toDataURL();
  link.target = '_blank';
  link.download = 'mxv-screenshot.png';
  link.click();
}

function onWindowResize() {
  viewer.getScene().updateCamera();
  applyRenderQuality();
}

function handleKeyEvents(event) {
  if (event.key === 'v' || event.key === 'V') {
    viewer.getScene().toggleBackgroundTexture();
  } else if (event.key === 'p' || event.key === 'P') {
    turntableEnabled = !turntableEnabled;
    if (turntableEnabled) {
      beginInteractiveRenderQuality();
    } else {
      endInteractiveRenderQuality();
    }
  } else if ((event.key === 'f' || event.key === 'F') && event.shiftKey) {
    captureRequested = true;
  } else if (event.key === 't' || event.key === 'T') {
    showFPS = !showFPS;
    setFPSOverlayVisible(showFPS);
  }
}

function animate() {
  requestAnimationFrame(animate);

  const scene = viewer.getScene();
  const now = performance.now();
  frameCount++;
  if (now - lastFrameTime >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - lastFrameTime));
    if (fpsOverlay && showFPS) fpsOverlay.textContent = `FPS: ${fps}`;
    lastFrameTime = now;
    frameCount = 0;
  }

  if (turntableEnabled) {
    turntableStep = (turntableStep + 1) % 360;
    scene.getScene().rotation.y = turntableStep * Math.PI / 180;
  }

  scene.updateTimeUniforms();
  renderer.render(scene.getScene(), scene.getCamera());

  if (captureRequested) {
    captureFrame();
    captureRequested = false;
  }
}

async function loadSelectedMaterial(file) {
  materialFilename = file;
  setStatus(`Loading material: ${prettyName(file)}`);
  viewer.getEditor().initialize();
  await viewer.getMaterial().loadMaterials(viewer, materialFilename);
  viewer.getEditor().updateProperties(0.9);
  setStatus(`Material ready: ${prettyName(file)}`);
}

async function loadSelectedGeometry(file) {
  setStatus(`Loading geometry: ${prettyName(file)}`);
  viewer.getScene().setGeometryURL(file);
  await viewer.getScene().loadGeometry(viewer, orbitControls);
  setStatus(`Geometry ready: ${prettyName(file)}`);
}

async function initializeViewer() {
  const canvas = document.getElementById('webglcanvas');
  const materialsSelect = document.getElementById('materials');
  const geometrySelect = document.getElementById('geometry');
  const qualitySelect = document.getElementById('quality');

  ({ materialXResourcePaths } = await loadAssetManifest());
  const materialPaths = getMaterialPaths();
  const geometryPaths = getGeometryPaths();
  materialFilename = populateSelect(materialsSelect, materialPaths, materialFilename);
  const geometryFilename = populateSelect(geometrySelect, geometryPaths, defaultGeometry);
  populateQualitySelect(qualitySelect);

  viewer = Viewer.create();
  viewer.getScene().setGeometryURL(geometryFilename);
  viewer.getScene().initialize();

  const qualityProfile = getQualityProfile();
  renderer = new THREE.WebGLRenderer({
    antialias: qualityProfile.antialias,
    canvas,
    powerPreference: 'high-performance',
  });
  applyRenderQuality();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.debug.checkShaderErrors = false;

  orbitControls = new OrbitControls(viewer.getScene().getCamera(), renderer.domElement);
  orbitControls.addEventListener('start', beginInteractiveRenderQuality);
  orbitControls.addEventListener('end', endInteractiveRenderQuality);
  viewer.getEditor().initialize();

  createFPSOverlay();
  setFPSOverlayVisible(showFPS);
  setStatus('Loading MaterialX runtime and scene assets');

  const hdrLoader = viewer.getHdrLoader();
  const fileLoader = viewer.getFileLoader();
  const [radianceTexture, irradianceTexture, lightRigXml, mx] = await Promise.all([
    loadWith(hdrLoader, 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.hdr'),
    loadWith(hdrLoader, 'vendor/MaterialX/resources/Lights/irradiance/san_giuseppe_bridge_split.hdr'),
    loadWith(fileLoader, 'vendor/MaterialX/resources/Lights/san_giuseppe_bridge_split.mtlx'),
    loadMaterialX(),
  ]);

  await viewer.initialize(mx, renderer, radianceTexture, irradianceTexture, lightRigXml);
  await viewer.getScene().loadGeometry(viewer, orbitControls);
  await viewer.getMaterial().loadMaterials(viewer, materialFilename);
  await viewer.getMaterial().updateMaterialAssignments(viewer, '');
  viewer.getEditor().updateProperties(0.9);

  materialsSelect.addEventListener('change', event => loadSelectedMaterial(event.target.value).catch(reportError));
  geometrySelect.addEventListener('change', event => loadSelectedGeometry(event.target.value).catch(reportError));
  qualitySelect.addEventListener('change', handleQualityChange);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', handleKeyEvents);
  canvas.addEventListener('keydown', handleKeyEvents);
  document.addEventListener('drop', dropHandler, false);
  document.addEventListener('dragover', dragOverHandler, false);

  setLoadingCallback((file) => {
    const droppedMaterial = file.fullPath || file.name;
    loadSelectedMaterial(droppedMaterial).catch(reportError);
  });

  setSceneLoadingCallback((file) => {
    const droppedGeometry = file.fullPath || file.name;
    loadSelectedGeometry(droppedGeometry).catch(reportError);
  });

  THREE.Cache.enabled = true;
  setStatus(`Ready: ${prettyName(materialFilename)} on ${prettyName(geometryFilename)}`);
  animate();
}

function reportError(error) {
  console.error(error);
  setStatus(error?.message || String(error));
}

window.addEventListener('load', () => {
  initializeViewer().catch(reportError);
});
