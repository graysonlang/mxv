// This import+export makes sure index.html is copied to dist and the import
// is not stripped out during bundling.
import index from './smoke.html';
import { loadAssetManifest } from '../src/index.js';

export function getFilePaths() {
  return { index };
}

const runtimeBaseUrl = new URL('./vendor/materialx-runtime/', import.meta.url);

const sampleMaterial = `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
  <standard_surface name="SR_default" type="surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <input name="diffuse_roughness" type="float" value="0" />
    <input name="specular" type="float" value="1" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" value="0.2" />
    <input name="specular_IOR" type="float" value="1.5" />
    <input name="metalness" type="float" value="0" />
    <input name="transmission" type="float" value="0" />
    <input name="subsurface" type="float" value="0" />
    <input name="thin_walled" type="boolean" value="false" />
    <input name="emission" type="float" value="0" />
    <input name="opacity" type="color3" value="1, 1, 1" />
  </standard_surface>
  <surfacematerial name="Default" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_default" />
  </surfacematerial>
</materialx>`;

async function loadMaterialX() {
  const loaderUrl = new URL('JsMaterialXGenShader.js', runtimeBaseUrl).href;
  const { default: createMaterialX } = await import(loaderUrl);
  return createMaterialX({
    locateFile: file => new URL(file, runtimeBaseUrl).href,
  });
}

async function generateEsslShader(mx) {
  const document = mx.createDocument();
  await mx.readFromXmlString(document, sampleMaterial);

  const generator = mx.EsslShaderGenerator.create();
  const context = new mx.GenContext(generator);
  const standardLibraries = mx.loadStandardLibraries(context);
  document.importLibrary(standardLibraries);

  const element = mx.findRenderableElement(document);
  if (!element) {
    throw new Error('No renderable element found in sample material.');
  }

  context.getOptions().shaderInterfaceType = mx.ShaderInterfaceType.SHADER_INTERFACE_COMPLETE;
  const shader = generator.generate(element.getNamePath(), element, context);

  return {
    name: element.getNamePath(),
    pixel: shader.getSourceCode('pixel'),
    vertex: shader.getSourceCode('vertex'),
  };
}

function renderShell({ imagePaths = [], materialXPathPaths = [] } = {}) {
  document.body.innerHTML = `
    <main class="workspace">
      <section class="summary">
        <p class="eyebrow">MaterialX Web Viewer</p>
        <h1>Shader core</h1>
        <dl class="stats">
          <div><dt>Status</dt><dd data-status>Loading runtime</dd></div>
          <div><dt>Version</dt><dd data-version>-</dd></div>
          <div><dt>Renderable</dt><dd data-renderable>-</dd></div>
          <div><dt>Runtime files</dt><dd>${materialXPathPaths.length}</dd></div>
          <div><dt>Image assets</dt><dd>${imagePaths.length}</dd></div>
        </dl>
      </section>
      <section class="shader">
        <div class="toolbar" role="tablist" aria-label="Shader stage">
          <button type="button" class="tab is-active" data-stage="vertex" role="tab" aria-selected="true">Vertex</button>
          <button type="button" class="tab" data-stage="pixel" role="tab" aria-selected="false">Pixel</button>
        </div>
        <pre data-source>Waiting for shader generation...</pre>
      </section>
    </main>
  `;
}

function setText(selector, text) {
  const node = document.querySelector(selector);
  if (node) node.textContent = text;
}

function showStage(shaderSources, stage) {
  const source = shaderSources[stage] || '';
  setText('[data-source]', source);

  document.querySelectorAll('[data-stage]').forEach((button) => {
    const selected = button.dataset.stage === stage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function bindStageTabs(shaderSources) {
  document.querySelectorAll('[data-stage]').forEach((button) => {
    button.addEventListener('click', () => showStage(shaderSources, button.dataset.stage));
  });
}

window.addEventListener('load', async () => {
  renderShell();

  try {
    const assetManifest = await loadAssetManifest();
    renderShell(assetManifest);

    const mx = await loadMaterialX();
    setText('[data-version]', mx.getVersionString());
    setText('[data-status]', 'Generating ESSL');

    const shaderSources = await generateEsslShader(mx);
    setText('[data-status]', 'Ready');
    setText('[data-renderable]', shaderSources.name);
    bindStageTabs(shaderSources);
    showStage(shaderSources, 'vertex');
  } catch (error) {
    console.error(error);
    setText('[data-status]', 'Failed');
    setText('[data-source]', error?.stack || String(error));
  }
});
