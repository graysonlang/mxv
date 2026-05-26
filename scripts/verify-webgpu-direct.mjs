import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const defaultUrl = 'http://127.0.0.1:8080/webgpu-direct.html?material=pearl';
const defaultScreenshot = 'test-results/webgpu-direct.png';
const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (match) args.set(match[1], match[2] ?? true);
}

if (args.has('help')) {
  console.log(`Usage: npm run verify:webgpu -- [--url=${defaultUrl}] [--headed] [--timeout=20000]`);
  console.log('');
  console.log('Start the dev server separately, for example: npm run serve -- --port=8080');
  process.exit(0);
}

const targetUrl = String(args.get('url') || process.env.MXV_VERIFY_URL || defaultUrl);
const timeoutMs = Number(args.get('timeout') || process.env.MXV_VERIFY_TIMEOUT || 20_000);
const headed = args.has('headed') || process.env.MXV_VERIFY_HEADFUL === '1';
const screenshotPath = path.resolve(String(args.get('screenshot') || process.env.MXV_VERIFY_SCREENSHOT || defaultScreenshot));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address?.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function ensureServerReachable(url) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Could not reach ${url}. Start the server with: npm run serve -- --port=8080\n${lastError?.message || 'request failed'}`);
}

async function launchChrome() {
  const chromePath = findChromePath();
  const remotePort = await getFreePort();
  const userDataDir = path.join(os.tmpdir(), `mxv-webgpu-verify-${process.pid}-${Date.now()}`);
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
  const stderr = [];
  chrome.stderr.on('data', chunk => stderr.push(String(chunk)));

  return {
    chrome,
    remotePort,
    stderr,
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

class CdpClient {
  constructor(webSocket) {
    this.callbacks = new Map();
    this.handlers = new Map();
    this.id = 0;
    this.webSocket = webSocket;

    webSocket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      const message = JSON.parse(payload);
      if (message.id) {
        const callback = this.callbacks.get(message.id);
        if (!callback) return;
        this.callbacks.delete(message.id);
        if (message.error) {
          callback.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          callback.resolve(message.result || {});
        }
        return;
      }

      for (const handler of this.handlers.get(message.method) || []) {
        handler(message.params || {});
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

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { reject, resolve });
    });
  }
}

function describeRemoteValue(value) {
  if ('value' in value) return String(value.value);
  if (value.description) return value.description;
  if (value.unserializableValue) return value.unserializableValue;
  return value.type || '<unknown>';
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime evaluation failed.');
  }
  return result.result?.value;
}

async function pollPageState(client) {
  const expression = `(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
    const metric = name => text('[data-metric="' + name + '"]');
    const canvas = document.getElementById('direct-webgpu-canvas');
    return {
      canvas: {
        height: canvas?.height || 0,
        width: canvas?.width || 0,
      },
      errors: window.__mxvWebGpuErrors || [],
      fps: text('[data-fps]'),
      metrics: {
        firstFrame: metric('firstFrame'),
        material: metric('material'),
        renderer: metric('renderer'),
        shaderContract: metric('shaderContract'),
        shaderModule: metric('shaderModule'),
        vertexAdapter: metric('vertexAdapter'),
      },
      status: text('[data-status]'),
      webgpu: Boolean(navigator.gpu),
    };
  })()`;
  return evaluate(client, expression);
}

function validateReadyState(state) {
  const failures = [];
  const metrics = state.metrics || {};
  const canvas = state.canvas || {};
  if (!state.webgpu) failures.push('navigator.gpu is not available');
  if (state.status !== 'Ready') failures.push(`status is ${state.status || '<blank>'}`);
  if (metrics.renderer !== 'Direct WebGPU') failures.push(`renderer is ${metrics.renderer || '<blank>'}`);
  if (metrics.material !== 'Pearl (shadergen)') failures.push(`material is ${metrics.material || '<blank>'}`);
  if (metrics.shaderContract !== '39 public ports / 288 B') {
    failures.push(`shader contract is ${metrics.shaderContract || '<blank>'}`);
  }
  if (!/GLSL -> WGSL/.test(metrics.vertexAdapter)) {
    failures.push(`vertex adapter is ${metrics.vertexAdapter || '<blank>'}`);
  }
  if (!metrics.firstFrame || metrics.firstFrame === '-') failures.push('first frame metric did not populate');
  if (!state.fps || state.fps === '-') failures.push('fps metric did not populate');
  if (canvas.width < 64 || canvas.height < 64) {
    failures.push(`canvas size is ${canvas.width || 0}x${canvas.height || 0}`);
  }
  if (state.errors?.length) {
    failures.push(`WebGPU errors: ${state.errors.map(error => `${error.scope}: ${error.message}`).join('; ')}`);
  }
  return failures;
}

async function waitForReadyState(client) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await pollPageState(client);
    if (!validateReadyState(lastState).length) return lastState;
    await sleep(250);
  }

  const failures = validateReadyState(lastState || {});
  throw new Error(`Timed out waiting for direct WebGPU readiness:\n- ${failures.join('\n- ')}`);
}

async function main() {
  await ensureServerReachable(targetUrl);

  const pageErrors = [];
  const consoleErrors = [];
  const logErrors = [];
  let chromeSession;
  let client;

  try {
    chromeSession = await launchChrome();
    const webSocketUrl = await waitForPageTarget(chromeSession.remotePort);
    client = await CdpClient.connect(webSocketUrl);

    client.on('Runtime.consoleAPICalled', (params) => {
      if (!['assert', 'error'].includes(params.type)) return;
      consoleErrors.push(params.args.map(describeRemoteValue).join(' '));
    });
    client.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Runtime exception');
    });
    client.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') logErrors.push(params.entry.text);
    });

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.navigate', { url: targetUrl });

    const state = await waitForReadyState(client);
    if (pageErrors.length || consoleErrors.length || logErrors.length) {
      throw new Error([
        ...pageErrors.map(error => `page error: ${error}`),
        ...consoleErrors.map(error => `console error: ${error}`),
        ...logErrors.map(error => `log error: ${error}`),
      ].join('\n'));
    }

    const screenshot = await client.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
    });
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    console.log('Direct WebGPU verification passed');
    console.log(`  url: ${targetUrl}`);
    console.log(`  material: ${state.metrics.material}`);
    console.log(`  shader contract: ${state.metrics.shaderContract}`);
    console.log(`  vertex adapter: ${state.metrics.vertexAdapter}`);
    console.log(`  screenshot: ${path.relative(process.cwd(), screenshotPath)}`);
  } finally {
    client?.close();
    if (chromeSession) {
      chromeSession.chrome.kill();
      await rm(chromeSession.userDataDir, { force: true, recursive: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
