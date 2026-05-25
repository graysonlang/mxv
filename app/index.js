// This import+export makes sure index.html is copied to dist and the import
// is not stripped out during bundling.
import index from './index.html';

export function getFilePaths() {
  return { index };
}

const modePages = {
  direct: './webgpu-direct.html',
  webgl: './webgl.html',
  webgpu: './webgpu.html',
};

function getModeFromHash() {
  const mode = window.location.hash.replace(/^#/, '').toLowerCase();
  if (mode === 'webgpu-direct') return 'direct';
  if (Object.hasOwn(modePages, mode)) return mode;
  return 'webgl';
}

function setActiveMode(mode) {
  const frame = document.querySelector('[data-mode-frame]');
  const openLink = document.querySelector('[data-open-current]');
  const page = modePages[mode] || modePages.webgl;

  if (frame && frame.getAttribute('src') !== page) {
    frame.setAttribute('src', page);
  }
  if (openLink) {
    openLink.setAttribute('href', page);
  }

  document.querySelectorAll('[data-mode-link]').forEach((link) => {
    const active = link.dataset.modeLink === mode;
    link.classList.toggle('is-active', active);
    link.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function syncMode() {
  setActiveMode(getModeFromHash());
}

window.addEventListener('hashchange', syncMode);
window.addEventListener('load', syncMode);
