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
  console.log('Usage: npm run verify:naga-wgsl -- [--skip-spike] [--allow-known-failures] [--headed] [--timeout=20000]');
  console.log('');
  console.log('Set MXV_NAGA=/path/to/naga to use a non-default naga-cli binary.');
  process.exit(0);
}

const timeoutMs = Number(args.get('timeout') || process.env.MXV_VERIFY_TIMEOUT || 20_000);
const headed = args.has('headed') || process.env.MXV_VERIFY_HEADFUL === '1';
const allowKnownFailures = args.has('allow-known-failures');

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

    const result = await compileShadersInBrowser(client, shaderManifest);
    const failures = result.results.filter(shader => !shader.ok);
    const blockingFailures = allowKnownFailures
      ? failures.filter(shader => !isKnownFailure(shader))
      : failures;

    console.log('Naga WGSL browser compile check');
    console.log(`  adapter: ${result.adapter || 'available'}`);
    console.log(`  shaders: ${result.results.length}`);
    for (const shader of result.results) {
      const knownFailure = isKnownFailure(shader);
      const status = shader.ok ? 'ok' : knownFailure ? 'known failure' : 'failed';
      const detail = shader.messages.length ? ` (${summarizeMessages(shader.messages)})` : '';
      console.log(`  ${shader.id}: ${status}${detail}`);
    }

    if (failures.length && !blockingFailures.length) {
      console.log(`  known failures allowed: ${failures.length}`);
    }

    if (blockingFailures.length) {
      throw new Error(`${blockingFailures.length} Naga WGSL shader module(s) failed browser compilation.`);
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

function compileShadersInBrowser(client, manifest) {
  const expression = `(${browserCompileShaders.toString()})(${JSON.stringify(manifest)})`;

  return evaluate(client, expression);
}

async function browserCompileShaders(shaders) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('navigator.gpu did not return an adapter.');
  }

  const device = await adapter.requestDevice();
  const results = [];
  for (const shader of shaders) {
    const source = await fetch(shader.path).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${shader.path}`);
      return response.text();
    });
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

    results.push({
      id: shader.id,
      messages,
      ok: !messages.some(message => message.type === 'error'),
    });
  }

  return {
    adapter: adapter.info?.device || adapter.info?.description || adapter.info?.vendor || '',
    results,
  };
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
