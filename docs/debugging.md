# Debugging

This document collects local debugging commands that are useful while working on the MaterialX viewer.

## Dev Server

Start the local server:

```sh
npm run serve -- --host=127.0.0.1 --port=8080 --vscode
```

Check that it is responding:

```sh
curl -I http://127.0.0.1:8080/
```

The main viewer is served at:

```text
http://127.0.0.1:8080/
```

The smaller shader-generation smoke test is served at:

```text
http://127.0.0.1:8080/smoke.html
```

The experimental WebGPU material lab is served at:

```text
http://127.0.0.1:8080/webgpu.html
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
  'http://127.0.0.1:8080/?specular=none&quality=performance&antialias=on'
```

The useful signal is the screenshot itself, not Chrome's stderr. Chrome may print updater, GPU stall, or allocator warnings during a successful capture.

If a headless Chrome process remains attached after writing the screenshot, stop that process before continuing.

## Good URLs To Check

Default viewer:

```text
http://127.0.0.1:8080/
```

No specular radiance path:

```text
http://127.0.0.1:8080/?specular=none&quality=performance&antialias=on
```

Prefiltered environment path:

```text
http://127.0.0.1:8080/?specular=prefilter&quality=performance&antialias=on
```

Alternate environment map:

```text
http://127.0.0.1:8080/?environment=Table+Mountain+Split&specular=prefilter
```

Smoke test:

```text
http://127.0.0.1:8080/smoke.html
```

WebGPU material lab:

```text
http://127.0.0.1:8080/webgpu.html
```

WebGPU material lab with Three's WebGL2 fallback backend forced:

```text
http://127.0.0.1:8080/webgpu.html?renderer=webgl
```
