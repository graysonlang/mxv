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
import { materialXResourcePaths } from '../src/index.js';

export function getFilePaths() {
  return { index };
}

const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);
const defaultMaterial = 'vendor/MaterialX/resources/Materials/Examples/StandardSurface/standard_surface_default.mtlx';
const defaultGeometry = 'vendor/MaterialX/resources/Geometry/shaderball.glb';

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
let materialFilename = new URLSearchParams(document.location.search).get('file') || defaultMaterial;

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

function setStatus(message) {
  const status = document.querySelector('[data-status]');
  if (status) status.textContent = message;
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
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleKeyEvents(event) {
  if (event.key === 'v' || event.key === 'V') {
    viewer.getScene().toggleBackgroundTexture();
  } else if (event.key === 'p' || event.key === 'P') {
    turntableEnabled = !turntableEnabled;
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

  const materialPaths = getMaterialPaths();
  const geometryPaths = getGeometryPaths();
  materialFilename = populateSelect(materialsSelect, materialPaths, materialFilename);
  const geometryFilename = populateSelect(geometrySelect, geometryPaths, defaultGeometry);

  viewer = Viewer.create();
  viewer.getScene().setGeometryURL(geometryFilename);
  viewer.getScene().initialize();

  renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.debug.checkShaderErrors = false;

  orbitControls = new OrbitControls(viewer.getScene().getCamera(), renderer.domElement);
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
