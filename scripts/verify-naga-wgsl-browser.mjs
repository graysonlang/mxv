import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const outputRoot = path.join(repoRoot, 'vendor/.cache/naga-materialx');
const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

if (args.has('help')) {
  console.log('Usage: npm run verify:naga-wgsl -- [--skip-spike] [--skip-pipeline] [--allow-known-failures] [--headed] [--timeout=20000]');
  process.exit(0);
}

const timeoutMs = Number(args.get('timeout') || process.env.MXV_VERIFY_TIMEOUT || 20_000);
const headed = args.has('headed') || process.env.MXV_VERIFY_HEADFUL === '1';
const allowKnownFailures = args.has('allow-known-failures');
const checkPipelines = !args.has('skip-pipeline');

async function collectShaderManifest() {
  const sampleDirs = (await readdir(outputRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const manifest = [];

  for (const sampleId of sampleDirs) {
    for (const stage of ['vertex', 'pixel']) {
      const filename = `${stage}.wgsl`;
      const filepath = path.join(outputRoot, sampleId, filename);
      if (!existsSync(filepath)) continue;

      manifest.push({
        id: `${sampleId}/${stage}`,
        path: `/shaders/${encodeURIComponent(sampleId)}/${filename}`,
        sampleId,
        stage,
      });
    }
  }

  return manifest;
}

async function main() {
  if (!args.has('skip-spike')) {
    await run(process.execPath, ['scripts/spike-naga-materialx.mjs'], { inherit: true });
  }

  const shaderManifest = await collectShaderManifest();
  if (!shaderManifest.length) {
    throw new Error(`No Naga WGSL fixtures found in ${path.relative(repoRoot, outputRoot)}.`);
  }
  const contract = await validateShaderContracts(shaderManifest);

  let server;
  let chromeSession;
  let client;

  try {
    server = await startFixtureServer();
    chromeSession = await launchChrome();
    const webSocketUrl = await waitForPageTarget(chromeSession.remotePort);
    client = await CdpClient.connect(webSocketUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: server.url });
    await waitForPageLoad(client, server.url);

    const result = await compileShadersInBrowser(client, shaderManifest, { checkPipelines });
    const failures = result.shaders.filter(shader => !shader.ok);
    const blockingFailures = allowKnownFailures
      ? failures.filter(shader => !isKnownFailure(shader))
      : failures;
    const pipelineFailures = result.pipelines.filter(pipeline => !pipeline.ok);

    console.log('Naga WGSL browser verification');
    console.log(`  adapter: ${result.adapter || 'available'}`);
    console.log(`  contract: ${contract.sampleCount} sample(s) match direct bindings and entry points`);
    console.log(`  shaders: ${result.shaders.length}`);
    for (const shader of result.shaders) {
      const knownFailure = isKnownFailure(shader);
      const status = shader.ok ? 'ok' : knownFailure ? 'known failure' : 'failed';
      const detail = shader.messages.length ? ` (${summarizeMessages(shader.messages)})` : '';
      console.log(`  ${shader.id}: ${status}${detail}`);
    }
    if (checkPipelines) {
      console.log(`  pipelines: ${result.pipelines.length}`);
      for (const pipeline of result.pipelines) {
        const detail = pipeline.messages.length ? ` (${summarizeMessages(pipeline.messages)})` : '';
        console.log(`  ${pipeline.id}: ${pipeline.ok ? 'ok' : 'failed'}${detail}`);
      }
    }

    if (failures.length && !blockingFailures.length) {
      console.log(`  known failures allowed: ${failures.length}`);
    }

    if (blockingFailures.length) {
      throw new Error(`${blockingFailures.length} Naga WGSL shader module(s) failed browser compilation.`);
    }
    if (pipelineFailures.length) {
      throw new Error(`${pipelineFailures.length} Naga WGSL render pipeline(s) failed browser compilation.`);
    }
  } finally {
    client?.close();
    if (chromeSession) {
      chromeSession.chrome.kill();
      await rm(chromeSession.userDataDir, { force: true, recursive: true });
    }
    await closeServer(server?.server);
  }
}

function compileShadersInBrowser(client, manifest, options) {
  const expression = `(${browserCompileShaders.toString()})(${JSON.stringify(manifest)}, ${JSON.stringify(options)})`;

  return evaluate(client, expression);
}

async function validateShaderContracts(manifest) {
  const expected = {
    pixel: {
      bindings: [
        { binding: 1, kind: 'uniform', type: 'PrivateUniforms_pixel' },
        { binding: 2, kind: 'texture', type: 'texture_2d<f32>' },
        { binding: 3, kind: 'sampler', type: 'sampler' },
        { binding: 4, kind: 'texture', type: 'texture_2d<f32>' },
        { binding: 5, kind: 'sampler', type: 'sampler' },
        { binding: 6, kind: 'uniform', type: 'PublicUniforms_pixel' },
      ],
      lightType: 'LightData_pixel',
      entryPattern: /@fragment\s+fn\s+main\s*\([^)]*@location\(0\)[^)]*@location\(1\)[^)]*@location\(2\)/s,
    },
    vertex: {
      bindings: [
        { binding: 0, kind: 'uniform', type: 'PrivateUniforms_vertex' },
      ],
      entryPattern: /@vertex\s+fn\s+main\s*\([^)]*@location\(0\)[^)]*@location\(1\)[^)]*@location\(2\)/s,
    },
  };
  const sampleIds = new Set();

  for (const shader of manifest) {
    const stageExpected = expected[shader.stage];
    if (!stageExpected) continue;

    const filepath = path.join(outputRoot, shader.sampleId, `${shader.stage}.wgsl`);
    const source = await readFile(filepath, 'utf8');
    const bindings = extractBindings(source);
    const bindingMap = new Map(bindings.map(binding => [binding.binding, binding]));
    const errors = [];

    if (!stageExpected.entryPattern.test(source)) {
      errors.push(`missing ${shader.stage} main entry point with locations 0-2`);
    }

    for (const bindingExpected of stageExpected.bindings) {
      const binding = bindingMap.get(bindingExpected.binding);
      if (!binding) {
        errors.push(`missing binding ${bindingExpected.binding}`);
        continue;
      }
      if (binding.group !== 0) {
        errors.push(`binding ${bindingExpected.binding} uses group ${binding.group}, expected group 0`);
      }
      if (binding.kind !== bindingExpected.kind || binding.type !== bindingExpected.type) {
        errors.push(
          `binding ${bindingExpected.binding} is ${binding.kind} ${binding.type}, expected ${bindingExpected.kind} ${bindingExpected.type}`,
        );
      }
    }

    if (stageExpected.lightType && !bindings.some(binding => binding.kind === 'uniform' && binding.type === stageExpected.lightType)) {
      errors.push(`missing ${stageExpected.lightType} uniform binding`);
    }

    if (errors.length) {
      throw new Error(`${shader.id} contract mismatch: ${errors.join('; ')}`);
    }

    sampleIds.add(shader.sampleId);
  }

  return {
    sampleCount: sampleIds.size,
  };
}

function extractBindings(source) {
  return [...source.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+\w+\s*:\s*([^;]+);/gm)]
    .map(match => ({
      binding: Number(match[2]),
      group: Number(match[1]),
      kind: match[3] === 'uniform'
        ? 'uniform'
        : match[4].trim().startsWith('texture_')
          ? 'texture'
          : match[4].trim() === 'sampler'
            ? 'sampler'
            : 'unknown',
      type: match[4].trim(),
    }));
}

async function browserCompileShaders(shaders, options) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('navigator.gpu did not return an adapter.');
  }

  const device = await adapter.requestDevice();
  const shaderSources = new Map();
  const shaderResults = [];
  for (const shader of shaders) {
    const source = await fetch(shader.path).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${shader.path}`);
      return response.text();
    });
    shaderSources.set(shader.id, source);
    device.pushErrorScope('validation');
    const module = device.createShaderModule({
      code: source,
      label: shader.id,
    });
    const info = typeof module.compilationInfo === 'function'
      ? await module.compilationInfo()
      : { messages: [] };
    const scopedError = await device.popErrorScope();
    const messages = info.messages.map(message => ({
      lineNum: message.lineNum,
      linePos: message.linePos,
      message: message.message,
      type: message.type,
    }));
    if (scopedError) {
      messages.push({
        lineNum: 0,
        linePos: 0,
        message: scopedError.message,
        type: 'error',
      });
    }

    shaderResults.push({
      id: shader.id,
      messages,
      ok: !messages.some(message => message.type === 'error'),
    });
  }

  const pipelineResults = options?.checkPipelines
    ? await compileMaterialXPipelines(device, shaders, shaderSources)
    : [];

  return {
    adapter: adapter.info?.device || adapter.info?.description || adapter.info?.vendor || '',
    pipelines: pipelineResults,
    shaders: shaderResults,
  };

  async function compileMaterialXPipelines(device, shaders, shaderSources) {
    const sampleIds = [...new Set(shaders.map(shader => shader.sampleId))].sort((a, b) => a.localeCompare(b));
    const results = [];

    for (const sampleId of sampleIds) {
      const vertexSource = shaderSources.get(`${sampleId}/vertex`);
      const fragmentSource = shaderSources.get(`${sampleId}/pixel`);
      if (!vertexSource || !fragmentSource) continue;

      device.pushErrorScope('validation');
      try {
        const bindings = mergeBindings([
          ...extractBindings(vertexSource, GPUShaderStage.VERTEX),
          ...extractBindings(fragmentSource, GPUShaderStage.FRAGMENT),
        ]);
        const bindGroupLayout = createMaterialXBindGroupLayout(device, bindings);
        const bindGroup = createMaterialXBindGroup(device, bindGroupLayout, bindings);
        void bindGroup;

        const pipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
          label: `${sampleId} MaterialX Naga pipeline layout`,
        });
        const vertexModule = device.createShaderModule({
          code: vertexSource,
          label: `${sampleId}/vertex pipeline module`,
        });
        const fragmentModule = device.createShaderModule({
          code: fragmentSource,
          label: `${sampleId}/pixel pipeline module`,
        });

        await device.createRenderPipelineAsync({
          depthStencil: {
            depthCompare: 'less',
            depthWriteEnabled: true,
            format: 'depth24plus',
          },
          fragment: {
            entryPoint: 'main',
            module: fragmentModule,
            targets: [{ format: 'bgra8unorm' }],
          },
          label: `${sampleId} MaterialX Naga render pipeline`,
          layout: pipelineLayout,
          primitive: {
            cullMode: 'back',
            frontFace: 'ccw',
            topology: 'triangle-list',
          },
          vertex: {
            buffers: [
              createVertexBufferLayout(vertexSource),
            ],
            entryPoint: 'main',
            module: vertexModule,
          },
        });

        const scopedError = await device.popErrorScope();
        const messages = scopedError
          ? [{
              lineNum: 0,
              linePos: 0,
              message: scopedError.message,
              type: 'error',
            }]
          : [];
        results.push({
          id: `${sampleId}/pipeline`,
          messages,
          ok: !scopedError,
        });
      } catch (error) {
        const scopedError = await device.popErrorScope().catch(() => null);
        results.push({
          id: `${sampleId}/pipeline`,
          messages: [{
            lineNum: 0,
            linePos: 0,
            message: scopedError?.message || error?.message || String(error),
            type: 'error',
          }],
          ok: false,
        });
      }
    }

    return results;
  }

  function extractBindings(source, visibility) {
    return [...source.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+\w+\s*:\s*([^;]+);/gm)]
      .map(match => ({
        binding: Number(match[2]),
        group: Number(match[1]),
        kind: match[3] === 'uniform'
          ? 'uniform'
          : match[4].trim().startsWith('texture_')
            ? 'texture'
            : match[4].trim() === 'sampler'
              ? 'sampler'
              : 'unknown',
        type: match[4].trim(),
        visibility,
      }));
  }

  function mergeBindings(bindings) {
    const merged = new Map();
    for (const binding of bindings) {
      const existing = merged.get(binding.binding);
      if (existing) {
        existing.visibility |= binding.visibility;
        continue;
      }
      merged.set(binding.binding, { ...binding });
    }
    return [...merged.values()].sort((a, b) => a.binding - b.binding);
  }

  function createMaterialXBindGroupLayout(device, bindings) {
    return device.createBindGroupLayout({
      entries: bindings.map(binding => createBindGroupLayoutEntry(binding)),
      label: 'MaterialX direct WebGPU bind group layout',
    });
  }

  function createBindGroupLayoutEntry(binding) {
    const entry = {
      binding: binding.binding,
      visibility: binding.visibility,
    };
    if (binding.kind === 'uniform') {
      entry.buffer = { type: 'uniform' };
    } else if (binding.kind === 'texture') {
      entry.texture = { sampleType: 'float', viewDimension: '2d' };
    } else if (binding.kind === 'sampler') {
      entry.sampler = { type: 'filtering' };
    }
    return entry;
  }

  function createMaterialXBindGroup(device, layout, bindings) {
    const uniformBuffers = new Map([
      ['PrivateUniforms_vertex', createUniformBuffer(device, 'MaterialX verifier private vertex buffer', 192)],
      ['PrivateUniforms_pixel', createUniformBuffer(device, 'MaterialX verifier private pixel buffer', 96)],
      ['PublicUniforms_pixel', createUniformBuffer(device, 'MaterialX verifier public pixel buffer', 4096)],
      ['LightData_pixel', createUniformBuffer(device, 'MaterialX verifier light data buffer', 48)],
    ]);
    const fallbackUniformBuffer = createUniformBuffer(device, 'MaterialX verifier generic uniform buffer', 4096);
    const verifierTexture = createVerifierTexture(device, 'MaterialX verifier texture');
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    return device.createBindGroup({
      entries: bindings.map(binding => createBindGroupEntry(binding, uniformBuffers, fallbackUniformBuffer, verifierTexture, sampler)),
      label: 'MaterialX direct WebGPU verifier bind group',
      layout,
    });
  }

  function createBindGroupEntry(binding, uniformBuffers, fallbackUniformBuffer, texture, sampler) {
    if (binding.kind === 'uniform') {
      const buffer = uniformBuffers.get(binding.type) || fallbackUniformBuffer;
      return {
        binding: binding.binding,
        resource: { buffer },
      };
    }
    if (binding.kind === 'texture') {
      return {
        binding: binding.binding,
        resource: texture.createView(),
      };
    }
    return {
      binding: binding.binding,
      resource: sampler,
    };
  }

  function createVertexBufferLayout(vertexSource) {
    const floatSize = 4;
    const textured = /@location\(1\)\s+\w*texcoord/i.test(vertexSource);
    return textured
      ? {
          arrayStride: 11 * floatSize,
          attributes: [
            { format: 'float32x3', offset: 0, shaderLocation: 0 },
            { format: 'float32x2', offset: 9 * floatSize, shaderLocation: 1 },
            { format: 'float32x3', offset: 3 * floatSize, shaderLocation: 2 },
            { format: 'float32x3', offset: 6 * floatSize, shaderLocation: 3 },
          ],
        }
      : {
          arrayStride: 11 * floatSize,
          attributes: [
            { format: 'float32x3', offset: 0, shaderLocation: 0 },
            { format: 'float32x3', offset: 3 * floatSize, shaderLocation: 1 },
            { format: 'float32x3', offset: 6 * floatSize, shaderLocation: 2 },
          ],
        };
  }

  function createUniformBuffer(device, label, size) {
    return device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
  }

  function createVerifierTexture(device, label) {
    return device.createTexture({
      format: 'rgba16float',
      label,
      size: [1, 1, 1],
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}

function findChromePath() {
  const explicit = args.get('chrome') || process.env.MXV_CHROME;
  const candidates = [
    explicit,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const chromePath = candidates.find(candidate => existsSync(candidate));
  if (!chromePath) {
    throw new Error('Could not find Chrome. Set MXV_CHROME or pass --chrome=/path/to/chrome.');
  }
  return chromePath;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address?.port;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

async function startFixtureServer() {
  const port = await getFreePort();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host}`);
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>mxv naga wgsl verifier</title>');
        return;
      }

      if (!url.pathname.startsWith('/shaders/')) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      const relative = decodeURIComponent(url.pathname.slice('/shaders/'.length));
      if (relative.includes('..') || path.isAbsolute(relative)) {
        response.writeHead(400);
        response.end('Invalid path');
        return;
      }

      const filepath = path.join(outputRoot, relative);
      const content = await readFile(filepath);
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(content);
    } catch (error) {
      response.writeHead(500);
      response.end(error?.message || String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  return {
    server,
    url: `http://127.0.0.1:${port}/`,
  };
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function launchChrome() {
  const chromePath = findChromePath();
  const remotePort = await getFreePort();
  const userDataDir = path.join(os.tmpdir(), `mxv-naga-wgsl-verify-${process.pid}-${Date.now()}`);
  const chromeArgs = [
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--enable-unsafe-webgpu',
    '--no-default-browser-check',
    '--no-first-run',
    '--window-size=1280,720',
  ];

  if (!headed) chromeArgs.push('--headless=new');
  chromeArgs.push('about:blank');

  const chrome = spawn(chromePath, chromeArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  return {
    chrome,
    remotePort,
    userDataDir,
  };
}

async function waitForPageTarget(remotePort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${remotePort}/json/list`);
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for Chrome DevTools page target.');
}

async function waitForPageLoad(client, expectedUrl) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(client, '({ href: location.href, readyState: document.readyState })');
    if (state.href === expectedUrl && state.readyState === 'complete') return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for verifier page ${expectedUrl}.`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(webSocket) {
    this.callbacks = new Map();
    this.id = 0;
    this.webSocket = webSocket;

    webSocket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      const message = JSON.parse(payload);
      if (!message.id) return;

      const callback = this.callbacks.get(message.id);
      if (!callback) return;
      this.callbacks.delete(message.id);
      if (message.error) {
        callback.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        callback.resolve(message.result || {});
      }
    });
  }

  static connect(webSocketUrl) {
    if (!globalThis.WebSocket) {
      throw new Error('This verifier needs a Node.js runtime with global WebSocket support.');
    }

    return new Promise((resolve, reject) => {
      const webSocket = new WebSocket(webSocketUrl);
      webSocket.addEventListener('open', () => resolve(new CdpClient(webSocket)));
      webSocket.addEventListener('error', reject);
    });
  }

  close() {
    this.webSocket.close();
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { reject, resolve });
    });
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `${command} exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

function isKnownFailure(shader) {
  return shader.id.endsWith('/pixel')
    && shader.messages.some(message => (
      message.type === 'error'
      && message.message.includes('fwidth')
      && message.message.includes('uniform control flow')
    ));
}

function summarizeMessages(messages) {
  return messages
    .map((message) => {
      const firstLine = message.message.split('\n').find(Boolean) || message.message;
      const location = message.lineNum ? `${message.lineNum}:${message.linePos || 0} ` : '';
      return `${message.type}: ${location}${firstLine}`;
    })
    .join('; ');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
