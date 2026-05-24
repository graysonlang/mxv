# Agent Notes

## Scope

Work in this repository, not the upstream MaterialX checkout. General project setup, build, run, and viewer usage docs live in `README.md`.

The upstream MaterialX sources are vendored under `vendor/MaterialX`. Treat that directory as input/reference unless the user explicitly asks to modify vendored source.

Generated Emscripten output goes under `vendor/materialx-runtime`; avoid `vendor/materialx` because macOS case-insensitive filesystems treat it as the same directory as `vendor/MaterialX`.

## Local Workflow

- Prefer small, repo-local changes in `mxv`.
- Run `npm run build` after code changes that affect the app, build scripts, or wasm integration.
- Use `npm run serve -- --host=127.0.0.1 --port=8080 --vscode` for local browser checks.
- The ESP live-reload banner is intentionally removed in `scripts/build.mjs`; asset streaming from the viewer can otherwise cause reload loops.
- Keep generated/vendor folders ignored by tooling: `vendor/MaterialX`, `vendor/.build`, `vendor/.cache`, `vendor/materialx-runtime`, and `dist`.

## Implementation Cautions

- `app/main.js` is the main viewer.
- `app/smoke.js` is a smaller shader-generation smoke/debug entry point.
- `app/materialx-viewer/viewer.js` is copied upstream viewer code with local patches.
- The Makefile source list is intentionally slim for `JsMaterialXGenShader`. If future MaterialX versions add required binding/source files, update `scripts/materialx-gen-shader.Makefile` and rerun `npm run clean:wasm && npm run build:wasm`.
- Specular `none` intentionally does not use MaterialX `SPECULAR_ENVIRONMENT_NONE`. The UI maps it to the prefiltered shader path and binds a black 1x1 radiance texture at runtime so diffuse irradiance remains visible.

## Browser Debugging

Start the local server first:

```sh
npm run serve -- --host=127.0.0.1 --port=8080 --vscode
curl -I http://127.0.0.1:8080/
```

For headless Chrome WebGL screenshots on macOS, plain headless Chrome may fail with `Error creating WebGL context.` Use SwiftShader/ANGLE flags:

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

The useful signal is the screenshot itself, not Chrome's stderr. Chrome may print updater, GPU stall, or allocator warnings during a successful capture. If a headless Chrome process remains attached after writing the screenshot, stop that process before continuing.
