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
const navigationDebounceMs = 180;
const queryParams = new URLSearchParams(document.location.search);
const qualityProfiles = {
  performance: {
    label: 'Performance: DPR 1',
    maxPixelRatio: 1,
  },
  balanced: {
    label: 'Balanced: DPR 1.25',
    maxPixelRatio: 1.25,
  },
  high: {
    label: 'High: DPR 1.5',
    maxPixelRatio: 1.5,
  },
  native: {
    label: 'Native: DPR 2',
    maxPixelRatio: 2,
  },
  adaptive: {
    label: 'Adaptive: DPR 1 moving, DPR 2 idle',
    maxPixelRatio: 2,
    interactiveMaxPixelRatio: 1,
  },
};
const antialiasProfiles = {
  on: {
    label: 'On',
    enabled: true,
  },
  off: {
    label: 'Off',
    enabled: false,
  },
};
const shaderSpecularProfiles = {
  fis: {
    label: 'Filtered sampling',
    enumName: 'SPECULAR_ENVIRONMENT_FIS',
  },
  prefilter: {
    label: 'Prefiltered map',
    enumName: 'SPECULAR_ENVIRONMENT_PREFILTER',
  },
  none: {
    label: 'None',
    enumName: 'SPECULAR_ENVIRONMENT_PREFILTER',
    disableRadiance: true,
  },
};
const shaderAlbedoProfiles = {
  'analytic': {
    label: 'Analytic',
    enumName: 'DIRECTIONAL_ALBEDO_ANALYTIC',
  },
  'table': {
    label: 'Table lookup',
    enumName: 'DIRECTIONAL_ALBEDO_TABLE',
  },
  'monte-carlo': {
    label: 'Monte Carlo',
    enumName: 'DIRECTIONAL_ALBEDO_MONTE_CARLO',
  },
};
const shaderInterfaceProfiles = {
  complete: {
    label: 'Complete',
    enumName: 'SHADER_INTERFACE_COMPLETE',
  },
  reduced: {
    label: 'Reduced',
    enumName: 'SHADER_INTERFACE_REDUCED',
  },
};
const shaderSrgbProfiles = {
  on: {
    label: 'On',
    enabled: true,
  },
  off: {
    label: 'Off',
    enabled: false,
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
let materialFilename = getRequestedMaterialPath();
let geometryFilename = getRequestedGeometryPath();
let qualityMode = getRequestedQualityMode();
let antialiasMode = getRequestedAntialiasMode();
let shaderSpecularMode = getRequestedProfileMode('specular', shaderSpecularProfiles, 'fis');
let shaderAlbedoMode = getRequestedProfileMode('albedo', shaderAlbedoProfiles, 'analytic');
let shaderInterfaceMode = getRequestedProfileMode('interface', shaderInterfaceProfiles, 'complete');
let shaderSrgbMode = getRequestedProfileMode('srgb', shaderSrgbProfiles, 'on');
let interactiveQualityRestoreTimer;
let materialNavigationTimer;
let geometryNavigationTimer;
let useInteractivePixelRatio = false;
let materialXResourcePaths = [];

function getRequestedMaterialPath() {
  return queryParams.get('material') || queryParams.get('materials') || queryParams.get('file') || defaultMaterial;
}

function getRequestedGeometryPath() {
  return queryParams.get('model') || queryParams.get('geom') || defaultGeometry;
}

function getRequestedQualityMode() {
  const requested = queryParams.get('quality') || 'performance';
  return Object.hasOwn(qualityProfiles, requested) ? requested : 'performance';
}

function getRequestedAntialiasMode() {
  const requested = (queryParams.get('antialias') || queryParams.get('aa') || 'on').toLowerCase();
  if (['0', 'false', 'off', 'none'].includes(requested)) return 'off';
  if (['1', 'true', 'on', 'msaa'].includes(requested)) return 'on';
  return 'on';
}

function getRequestedProfileMode(paramName, profiles, fallback) {
  const requested = queryParams.get(paramName)?.toLowerCase();
  return requested && Object.hasOwn(profiles, requested) ? requested : fallback;
}

function getQualityProfile(mode = qualityMode) {
  return qualityProfiles[mode] || qualityProfiles.balanced;
}

function getAntialiasProfile(mode = antialiasMode) {
  return antialiasProfiles[mode] || antialiasProfiles.on;
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

function assetNameKey(path) {
  return prettyName(String(path || '').trim()).toLocaleLowerCase();
}

function resolveAssetPath(paths, requested, fallback) {
  if (paths.includes(requested)) return requested;

  const requestedKey = assetNameKey(requested);
  const matchedPath = paths.find(path => assetNameKey(path) === requestedKey);
  if (matchedPath) return matchedPath;

  return paths.includes(fallback) ? fallback : paths[0] || '';
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

function populateAntialiasSelect(select) {
  select.replaceChildren();
  for (const [mode, profile] of Object.entries(antialiasProfiles)) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = profile.label;
    select.append(option);
  }

  select.value = antialiasMode;
}

function populateProfileSelect(select, profiles, selectedMode) {
  select.replaceChildren();
  for (const [mode, profile] of Object.entries(profiles)) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = profile.label;
    select.append(option);
  }

  select.value = selectedMode;
}

function getUpdatedUrl(updates, removeKeys = []) {
  const params = new URLSearchParams(document.location.search);
  for (const key of removeKeys) {
    params.delete(key);
  }

  for (const [key, value] of Object.entries(updates)) {
    params.set(key, value);
  }

  const search = params.toString();
  return `${document.location.pathname}${search ? `?${search}` : ''}${document.location.hash}`;
}

function getQualityUrl(mode) {
  return getUpdatedUrl({ quality: mode });
}

function getAntialiasUrl(mode) {
  return getUpdatedUrl({ antialias: mode }, ['aa']);
}

function getMaterialUrl(file) {
  return getUpdatedUrl({ material: prettyName(file) }, ['file', 'materials']);
}

function getGeometryUrl(file) {
  return getUpdatedUrl({ model: prettyName(file) }, ['geom']);
}

function getShaderCompilerUrl() {
  return getUpdatedUrl({
    specular: shaderSpecularMode,
    albedo: shaderAlbedoMode,
    interface: shaderInterfaceMode,
    srgb: shaderSrgbMode,
  });
}

function updateSelectionUrl(updates) {
  history.replaceState(null, '', getUpdatedUrl(updates, ['file', 'materials', 'geom']));
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

  const nextProfile = getQualityProfile(nextMode);
  const nextUrl = getQualityUrl(nextMode);

  qualityMode = nextMode;
  resetInteractiveRenderQuality();
  history.replaceState(null, '', nextUrl);
  if (turntableEnabled) {
    setInteractiveRenderQuality(true);
  }
  applyRenderQuality();
  setStatus(`Quality: ${nextProfile.label}`);
}

function handleAntialiasChange(event) {
  const nextMode = event.target.value;
  if (nextMode === antialiasMode) return;
  window.location.assign(getAntialiasUrl(nextMode));
}

function getEnumValue(enumObject, enumName) {
  return enumObject ? enumObject[enumName] : undefined;
}

function getShaderCompilerOptions(mx) {
  const specularProfile = shaderSpecularProfiles[shaderSpecularMode];
  return {
    genOptions: {
      hwSpecularEnvironmentMethod: getEnumValue(
        mx.HwSpecularEnvironmentMethod,
        specularProfile.enumName,
      ),
      hwDirectionalAlbedoMethod: getEnumValue(
        mx.HwDirectionalAlbedoMethod,
        shaderAlbedoProfiles[shaderAlbedoMode].enumName,
      ),
      shaderInterfaceType: getEnumValue(
        mx.ShaderInterfaceType,
        shaderInterfaceProfiles[shaderInterfaceMode].enumName,
      ),
      hwSrgbEncodeOutput: shaderSrgbProfiles[shaderSrgbMode].enabled,
    },
    runtimeOptions: {
      disableSpecularRadiance: Boolean(specularProfile.disableRadiance),
    },
  };
}

function applyShaderCompilerOptions() {
  if (!viewer?.getMx()) return;
  const options = getShaderCompilerOptions(viewer.getMx());
  viewer.setShaderCompilerOptions(options.genOptions);
  viewer.setShaderRuntimeOptions(options.runtimeOptions);
  viewer.applyShaderCompilerOptions();
}

async function reloadMaterialForShaderCompilerOptions() {
  applyShaderCompilerOptions();
  await loadSelectedMaterial(materialFilename, { updateUrl: false });
}

function handleShaderCompilerOptionChange(event) {
  const nextMode = event.target.value;

  if (event.target.id === 'shader-specular') {
    if (nextMode === shaderSpecularMode) return;
    shaderSpecularMode = nextMode;
  } else if (event.target.id === 'shader-albedo') {
    if (nextMode === shaderAlbedoMode) return;
    shaderAlbedoMode = nextMode;
  } else if (event.target.id === 'shader-interface') {
    if (nextMode === shaderInterfaceMode) return;
    shaderInterfaceMode = nextMode;
  } else if (event.target.id === 'shader-srgb') {
    if (nextMode === shaderSrgbMode) return;
    shaderSrgbMode = nextMode;
  } else {
    return;
  }

  history.replaceState(null, '', getShaderCompilerUrl());
  reloadMaterialForShaderCompilerOptions().catch(reportError);
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

function isEditableEventTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

function getBracketHotkey(event) {
  if (event.key === '[' || (event.code === 'BracketLeft' && !event.shiftKey)) {
    return { kind: 'material', direction: -1 };
  }
  if (event.key === ']' || (event.code === 'BracketRight' && !event.shiftKey)) {
    return { kind: 'material', direction: 1 };
  }
  if (event.key === '{' || (event.code === 'BracketLeft' && event.shiftKey)) {
    return { kind: 'geometry', direction: -1 };
  }
  if (event.key === '}' || (event.code === 'BracketRight' && event.shiftKey)) {
    return { kind: 'geometry', direction: 1 };
  }
  return null;
}

function stepSelect(selectId, direction) {
  const select = document.getElementById(selectId);
  if (!select || select.options.length === 0) return '';

  const currentIndex = Math.max(select.selectedIndex, 0);
  const nextIndex = (currentIndex + direction + select.options.length) % select.options.length;
  select.selectedIndex = nextIndex;
  return select.value;
}

function scheduleMaterialNavigationLoad(file) {
  materialFilename = file;
  history.replaceState(null, '', getMaterialUrl(file));
  setStatus(`Material queued: ${prettyName(file)}`);
  window.clearTimeout(materialNavigationTimer);
  materialNavigationTimer = window.setTimeout(() => {
    loadSelectedMaterial(file, { updateUrl: false }).catch(reportError);
  }, navigationDebounceMs);
}

function scheduleGeometryNavigationLoad(file) {
  geometryFilename = file;
  history.replaceState(null, '', getGeometryUrl(file));
  setStatus(`Geometry queued: ${prettyName(file)}`);
  window.clearTimeout(geometryNavigationTimer);
  geometryNavigationTimer = window.setTimeout(() => {
    loadSelectedGeometry(file, { updateUrl: false }).catch(reportError);
  }, navigationDebounceMs);
}

function cycleMaterial(direction) {
  const file = stepSelect('materials', direction);
  if (file) scheduleMaterialNavigationLoad(file);
}

function cycleGeometry(direction) {
  const file = stepSelect('geometry', direction);
  if (file) scheduleGeometryNavigationLoad(file);
}

function handleKeyEvents(event) {
  if (isEditableEventTarget(event.target)) return;

  const bracketHotkey = getBracketHotkey(event);
  if (bracketHotkey) {
    event.preventDefault();
    if (bracketHotkey.kind === 'material') {
      cycleMaterial(bracketHotkey.direction);
    } else {
      cycleGeometry(bracketHotkey.direction);
    }
    return;
  }

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

async function loadSelectedMaterial(file, { updateUrl = true } = {}) {
  materialFilename = file;
  if (updateUrl) {
    history.replaceState(null, '', getMaterialUrl(file));
  }
  setStatus(`Loading material: ${prettyName(file)}`);
  viewer.getEditor().initialize();
  applyShaderCompilerOptions();
  await viewer.getMaterial().loadMaterials(viewer, materialFilename);
  viewer.getEditor().updateProperties(0.9);
  setStatus(`Material ready: ${prettyName(file)}`);
}

async function loadSelectedGeometry(file, { updateUrl = true } = {}) {
  geometryFilename = file;
  if (updateUrl) {
    history.replaceState(null, '', getGeometryUrl(file));
  }
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
  const antialiasSelect = document.getElementById('antialias');
  const shaderSpecularSelect = document.getElementById('shader-specular');
  const shaderAlbedoSelect = document.getElementById('shader-albedo');
  const shaderInterfaceSelect = document.getElementById('shader-interface');
  const shaderSrgbSelect = document.getElementById('shader-srgb');

  ({ materialXResourcePaths } = await loadAssetManifest());
  const materialPaths = getMaterialPaths();
  const geometryPaths = getGeometryPaths();
  materialFilename = resolveAssetPath(materialPaths, materialFilename, defaultMaterial);
  geometryFilename = resolveAssetPath(geometryPaths, geometryFilename, defaultGeometry);
  materialFilename = populateSelect(materialsSelect, materialPaths, materialFilename);
  geometryFilename = populateSelect(geometrySelect, geometryPaths, geometryFilename);
  updateSelectionUrl({ material: prettyName(materialFilename), model: prettyName(geometryFilename) });
  populateQualitySelect(qualitySelect);
  populateAntialiasSelect(antialiasSelect);
  populateProfileSelect(shaderSpecularSelect, shaderSpecularProfiles, shaderSpecularMode);
  populateProfileSelect(shaderAlbedoSelect, shaderAlbedoProfiles, shaderAlbedoMode);
  populateProfileSelect(shaderInterfaceSelect, shaderInterfaceProfiles, shaderInterfaceMode);
  populateProfileSelect(shaderSrgbSelect, shaderSrgbProfiles, shaderSrgbMode);

  viewer = Viewer.create();
  viewer.getScene().setGeometryURL(geometryFilename);
  viewer.getScene().initialize();

  const antialiasProfile = getAntialiasProfile();
  renderer = new THREE.WebGLRenderer({
    antialias: antialiasProfile.enabled,
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
  applyShaderCompilerOptions();
  await viewer.getScene().loadGeometry(viewer, orbitControls);
  await viewer.getMaterial().loadMaterials(viewer, materialFilename);
  await viewer.getMaterial().updateMaterialAssignments(viewer, '');
  viewer.getEditor().updateProperties(0.9);

  materialsSelect.addEventListener('change', event => loadSelectedMaterial(event.target.value).catch(reportError));
  geometrySelect.addEventListener('change', event => loadSelectedGeometry(event.target.value).catch(reportError));
  qualitySelect.addEventListener('change', handleQualityChange);
  antialiasSelect.addEventListener('change', handleAntialiasChange);
  shaderSpecularSelect.addEventListener('change', handleShaderCompilerOptionChange);
  shaderAlbedoSelect.addEventListener('change', handleShaderCompilerOptionChange);
  shaderInterfaceSelect.addEventListener('change', handleShaderCompilerOptionChange);
  shaderSrgbSelect.addEventListener('change', handleShaderCompilerOptionChange);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', handleKeyEvents);
  document.addEventListener('drop', dropHandler, false);
  document.addEventListener('dragover', dragOverHandler, false);

  setLoadingCallback((file) => {
    const droppedMaterial = file.fullPath || file.name;
    loadSelectedMaterial(droppedMaterial, { updateUrl: false }).catch(reportError);
  });

  setSceneLoadingCallback((file) => {
    const droppedGeometry = file.fullPath || file.name;
    loadSelectedGeometry(droppedGeometry, { updateUrl: false }).catch(reportError);
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
