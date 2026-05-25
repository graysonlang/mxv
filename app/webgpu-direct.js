// This import+export makes sure webgpu-direct.html is copied to dist and the
// import is not stripped out during bundling.
import index from './webgpu-direct.html';

export function getFilePaths() {
  return { index };
}

const appStartTime = performance.now();
const cameraFov = 60 * Math.PI / 180;
const cameraNear = 0.05;
const cameraFar = 100;
const sphereRadius = 0.8;
const initialDistance = sphereRadius * 2;
const maxPixelRatio = 2;
const uniformFloatCount = 64;

const shaderSource = `
struct Uniforms {
  modelViewProjectionMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  baseColor: vec4<f32>,
  material: vec4<f32>,
  lightDirection: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPosition = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
  output.clipPosition = uniforms.modelViewProjectionMatrix * vec4<f32>(input.position, 1.0);
  output.worldPosition = worldPosition.xyz;
  output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
  output.tangent = normalize((uniforms.normalMatrix * vec4<f32>(input.tangent, 0.0)).xyz);
  return output;
}

fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let tangent = normalize(input.tangent);
  let viewDirection = normalize(uniforms.cameraPosition.xyz - input.worldPosition);
  let lightDirection = normalize(-uniforms.lightDirection.xyz);
  let halfVector = normalize(lightDirection + viewDirection);
  let roughness = clamp(uniforms.material.x, 0.04, 1.0);
  let metalness = saturate(uniforms.material.y);
  let clearcoat = saturate(uniforms.material.z);
  let baseColor = uniforms.baseColor.rgb;
  let nDotL = saturate(dot(normal, lightDirection));
  let nDotH = saturate(dot(normal, halfVector));
  let vDotH = saturate(dot(viewDirection, halfVector));
  let tDotH = abs(dot(tangent, halfVector));
  let diffuse = baseColor * (0.08 + nDotL * (1.0 - metalness));
  let fresnel = pow(1.0 - vDotH, 5.0);
  let specularPower = mix(160.0, 10.0, roughness);
  let specular = pow(nDotH, specularPower) * mix(0.18, 0.72, 1.0 - roughness);
  let tangentGlint = pow(tDotH, 32.0) * clearcoat * 0.08;
  let specularColor = mix(vec3<f32>(0.9, 0.96, 1.0), baseColor, metalness);
  let color = diffuse + specularColor * (specular + fresnel * 0.16 + tangentGlint);
  let gammaCorrected = pow(color, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gammaCorrected, 1.0);
}
`;

const viewState = {
  distance: initialDistance,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  pitch: 0.12,
  yaw: 0.22,
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

function createIdentityMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = far * near / (near - far);
  return out;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function lookAt(out, eye, target, up) {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

function multiplyMatrices(out, a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      const value = a[0 * 4 + row] * b[column * 4 + 0]
        + a[1 * 4 + row] * b[column * 4 + 1]
        + a[2 * 4 + row] * b[column * 4 + 2]
        + a[3 * 4 + row] * b[column * 4 + 3];
      result[column * 4 + row] = value;
    }
  }
  out.set(result);
  return out;
}

function createSphereGeometry(radius = sphereRadius, widthSegments = 96, heightSegments = 48) {
  const vertices = [];
  const indices = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const normal = [
        sinTheta * cosPhi,
        cosTheta,
        sinTheta * sinPhi,
      ];
      const tangent = normalize([-sinPhi, 0, cosPhi]);

      vertices.push(
        normal[0] * radius,
        normal[1] * radius,
        normal[2] * radius,
        normal[0],
        normal[1],
        normal[2],
        tangent[0],
        tangent[1],
        tangent[2],
      );
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    indices: new Uint32Array(indices),
    vertices: new Float32Array(vertices),
  };
}

function createBuffer(device, label, data, usage) {
  const buffer = device.createBuffer({
    label,
    mappedAtCreation: true,
    size: Math.ceil(data.byteLength / 4) * 4,
    usage,
  });
  const target = data instanceof Float32Array
    ? new Float32Array(buffer.getMappedRange())
    : new Uint32Array(buffer.getMappedRange());
  target.set(data);
  buffer.unmap();
  return buffer;
}

async function createDevice() {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const start = performance.now();
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter was returned.');
  }

  const device = await adapter.requestDevice();
  setMetric('renderer', 'Direct WebGPU');
  setMetric('adapter', adapter.info?.device || adapter.info?.description || adapter.info?.vendor || 'available');
  recordDuration('deviceInit', start);
  return { adapter, device };
}

function configureCanvas(canvas, device, context, format) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

  canvas.width = width;
  canvas.height = height;
  context.configure({
    alphaMode: 'opaque',
    device,
    format,
  });

  return { height, pixelRatio, width };
}

function createPipeline(device, format) {
  const start = performance.now();
  const shaderModule = device.createShaderModule({
    code: shaderSource,
    label: 'Direct WebGPU proof shader',
  });
  const pipeline = device.createRenderPipeline({
    fragment: {
      entryPoint: 'fragmentMain',
      module: shaderModule,
      targets: [{ format }],
    },
    label: 'Direct WebGPU proof pipeline',
    layout: 'auto',
    primitive: {
      cullMode: 'back',
      topology: 'triangle-list',
    },
    vertex: {
      buffers: [
        {
          arrayStride: 9 * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { format: 'float32x3', offset: 0, shaderLocation: 0 },
            { format: 'float32x3', offset: 3 * Float32Array.BYTES_PER_ELEMENT, shaderLocation: 1 },
            { format: 'float32x3', offset: 6 * Float32Array.BYTES_PER_ELEMENT, shaderLocation: 2 },
          ],
        },
      ],
      entryPoint: 'vertexMain',
      module: shaderModule,
    },
  });
  recordDuration('pipeline', start);
  return pipeline;
}

function bindCanvasControls(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    viewState.isDragging = true;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!viewState.isDragging) return;
    const dx = event.clientX - viewState.lastX;
    const dy = event.clientY - viewState.lastY;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    viewState.yaw -= dx * 0.008;
    viewState.pitch = Math.max(-1.2, Math.min(1.2, viewState.pitch - dy * 0.008));
  });

  canvas.addEventListener('pointerup', (event) => {
    viewState.isDragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const scale = Math.exp(event.deltaY * 0.0012);
    viewState.distance = Math.max(0.95, Math.min(8, viewState.distance * scale));
  }, { passive: false });
}

function getCameraPosition() {
  const cosPitch = Math.cos(viewState.pitch);
  return [
    Math.sin(viewState.yaw) * cosPitch * viewState.distance,
    Math.sin(viewState.pitch) * viewState.distance,
    Math.cos(viewState.yaw) * cosPitch * viewState.distance,
  ];
}

function writeUniforms(uniformData, dimensions) {
  const aspect = dimensions.width / dimensions.height;
  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  const model = createIdentityMatrix();
  const normal = createIdentityMatrix();
  const modelViewProjection = new Float32Array(16);
  const cameraPosition = getCameraPosition();

  perspective(projection, cameraFov, aspect, cameraNear, cameraFar);
  lookAt(view, cameraPosition, [0, 0, 0], [0, 1, 0]);
  multiplyMatrices(modelViewProjection, projection, view);

  uniformData.set(modelViewProjection, 0);
  uniformData.set(model, 16);
  uniformData.set(normal, 32);
  uniformData.set([...cameraPosition, 1], 48);
  uniformData.set([0.72, 0.78, 0.84, 1], 52);
  uniformData.set([0.34, 0.0, 0.45, 0], 56);
  uniformData.set([0.45, -0.8, -0.35, 0], 60);
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
  const canvas = document.getElementById('direct-webgpu-canvas');
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not create a WebGPU canvas context.');
  }

  setStatus('Requesting WebGPU device');
  const { device } = await createDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  let dimensions = configureCanvas(canvas, device, context, format);
  const pipeline = createPipeline(device, format);

  const meshStart = performance.now();
  const geometry = createSphereGeometry();
  const vertexBuffer = createBuffer(device, 'Shaderball vertices', geometry.vertices, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(device, 'Shaderball indices', geometry.indices, GPUBufferUsage.INDEX);
  setMetric('mesh', `${geometry.indices.length / 3} triangles`);
  recordDuration('mesh', meshStart);

  const uniformData = new Float32Array(uniformFloatCount);
  const uniformBuffer = device.createBuffer({
    label: 'Direct WebGPU proof uniforms',
    size: uniformData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
  });
  const bindGroup = device.createBindGroup({
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
    ],
    layout: pipeline.getBindGroupLayout(0),
  });

  bindCanvasControls(canvas);
  window.addEventListener('resize', () => {
    dimensions = configureCanvas(canvas, device, context, format);
  });

  const updateFps = createFpsMeter();
  let firstFrameRecorded = false;
  setStatus('Ready');

  function render(now) {
    writeUniforms(uniformData, dimensions);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 1, b: 0.08, g: 0.07, r: 0.06 },
          loadOp: 'clear',
          storeOp: 'store',
          view: context.getCurrentTexture().createView(),
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint32');
    pass.drawIndexed(geometry.indices.length);
    pass.end();
    device.queue.submit([encoder.finish()]);

    if (!firstFrameRecorded) {
      firstFrameRecorded = true;
      setMetric('firstFrame', formatDuration(now - appStartTime));
    }
    updateFps(now);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

window.addEventListener('load', () => {
  main().catch((error) => {
    console.error(error);
    setStatus('Failed');
    setMetric('renderer', error?.message || String(error));
  });
});
