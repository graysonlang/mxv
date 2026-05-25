# Debugging

This document collects local debugging commands that are useful while working on the MaterialX viewer.

## Dev Server

Start the local server:

```sh
npm run serve -- --vscode
```

Check that it is responding:

```sh
curl -I http://127.0.0.1:8000/
```

The renderer shell is served at:

```text
http://127.0.0.1:8000/
```

Explicit renderer modes are available through URI fragments:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/#webgl
http://127.0.0.1:8000/#webgpu
http://127.0.0.1:8000/#direct
http://127.0.0.1:8000/#smoke
```

With no fragment, the shell currently defaults to the direct WebGPU proof draw.

The WebGL viewer is also served directly at:

```text
http://127.0.0.1:8000/webgl.html
```

The smaller shader-generation smoke test is served at:

```text
http://127.0.0.1:8000/smoke.html
```

The experimental WebGPU material lab is served at:

```text
http://127.0.0.1:8000/webgpu.html
```

## Headless Chrome WebGL Screenshots

Plain headless Chrome on macOS may fail with `Error creating WebGL context.` Use SwiftShader/ANGLE flags when capturing viewer screenshots:

```sh
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new \
  --enable-webgl \
  --enable-webgl2 \
  --ignore-gpu-blocklist \
  --enable-unsafe-swiftshader \
  --use-angle=swiftshader \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --disable-default-apps \
  --no-first-run \
  --user-data-dir=/private/tmp/mxv-chrome-profile-webgl \
  --window-size=1280,720 \
  --virtual-time-budget=15000 \
  --screenshot=/private/tmp/mxv-webgl-check.png \
  'http://127.0.0.1:8000/webgl.html?specular=none&quality=performance&antialias=on'
```

The useful signal is the screenshot itself, not Chrome's stderr. Chrome may print updater, GPU stall, or allocator warnings during a successful capture.

If a headless Chrome process remains attached after writing the screenshot, stop that process before continuing.

## Good URLs To Check

Renderer shell:

```text
http://127.0.0.1:8000/
```

Default WebGL viewer:

```text
http://127.0.0.1:8000/webgl.html
```

No specular radiance path:

```text
http://127.0.0.1:8000/webgl.html?specular=none&quality=performance&antialias=on
```

Prefiltered environment path:

```text
http://127.0.0.1:8000/webgl.html?specular=prefilter&quality=performance&antialias=on
```

Alternate environment map:

```text
http://127.0.0.1:8000/webgl.html?environment=Table+Mountain+Split&specular=prefilter
```

Smoke test:

```text
http://127.0.0.1:8000/smoke.html
```

WebGPU material lab:

```text
http://127.0.0.1:8000/webgpu.html
```

Direct WebGPU proof draw:

```text
http://127.0.0.1:8000/webgpu-direct.html
```

WebGPU material lab with Three's WebGL2 fallback backend forced:

```text
http://127.0.0.1:8000/webgpu.html?renderer=webgl
```
