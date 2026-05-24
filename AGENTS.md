# Agent Notes

## Repository Focus

Work in this repository, not the upstream MaterialX checkout.

The upstream MaterialX sources are vendored under `vendor/MaterialX`. Generated Emscripten output goes under `vendor/materialx-runtime`; avoid `vendor/materialx` because macOS case-insensitive filesystems treat it as the same directory as `vendor/MaterialX`.

Do not modify `vendor/MaterialX` unless explicitly asked. Use it as reference/source input for the local build and viewer migration.

## Build Shape

- `npm run setup:materialx` prepares `vendor/MaterialX`.
- `npm run build:wasm` builds `JsMaterialXGenShader.js`, `.wasm`, and `.data` with `em++` through `scripts/materialx-gen-shader.Makefile`.
- `npm run clean:wasm` removes the generated wasm/object build without immediately rebuilding it.
- `npm run build` runs the wasm build first, then the ESP/esbuild production build.
- `npm run serve -- --host=127.0.0.1 --port=8080 --vscode` runs the wasm build first, then starts ESP/esbuild watch serving at `http://127.0.0.1:8080`.
- `scripts/build.mjs` defines `main` and `smoke` entry points and intentionally deletes ESP's live-reload banner. The viewer streams many copied assets, and live reload can otherwise fire repeatedly while images/assets are requested.

The wasm build wrapper finds Emscripten in this order:

1. `CXX=/path/to/em++`
2. `EMSDK/upstream/emscripten/em++`
3. `em++` on `PATH`

Typical fresh setup:

```sh
source /Users/grayson/Depots/github/emscripten-core/emsdk/emsdk_env.sh
npm run setup:materialx
npm run build
npm run serve -- --host=127.0.0.1 --port=8080 --vscode
```

## Viewer State

- `app/main.js` is the main MaterialX viewer.
- `app/smoke.js` is kept as a smaller shader-generation smoke/debug entry point.
- `app/materialx-viewer/viewer.js` is a copied MaterialX web viewer module with local patches for this project.
- `app/main.js` dynamically imports `vendor/materialx-runtime/JsMaterialXGenShader.js` and uses `locateFile` to resolve the adjacent `.wasm` and `.data` files.
- The viewer loads example materials, geometry, lights, and textures copied from `vendor/MaterialX/resources`.
- The default render configuration matches the published ASWF web viewer: `quality=performance` and `antialias=on`.
- Material and model URL params use friendly names, for example `?material=Standard+Surface+Default&model=Shaderball`.
- Legacy/full-path aliases are still accepted for compatibility: `file`, `materials`, and `geom`.

Useful query params:

- `material=<friendly material name>`
- `model=<friendly model name>`
- `quality=performance|balanced|high|native|adaptive`
- `antialias=on|off` or `aa=on|off`
- `specular=fis|prefilter|none`
- `albedo=analytic|table|monte-carlo`
- `interface=complete|reduced`
- `srgb=on|off`

Keyboard shortcuts:

- `[` and `]` navigate previous/next material.
- `{` and `}` navigate previous/next model.

Shader compiler/runtime notes:

- Specular `fis` maps to MaterialX filtered importance sampling.
- Specular `prefilter` maps to MaterialX prefiltered environment lookup and is much faster for large screen coverage.
- Specular `none` intentionally does not use MaterialX `SPECULAR_ENVIRONMENT_NONE`, because that path removes broader environment lighting and can make the object disappear. The UI maps `none` to the prefiltered shader path and binds a black 1x1 radiance texture at runtime, leaving diffuse irradiance intact.

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

## Maintenance Notes

- Keep generated/vendor folders ignored by tooling: `vendor/MaterialX`, `vendor/.build`, `vendor/.cache`, `vendor/materialx-runtime`, and `dist`.
- The Makefile source list is intentionally slim for `JsMaterialXGenShader`. If future MaterialX versions add required binding/source files, update `scripts/materialx-gen-shader.Makefile` and rerun `npm run clean:wasm && npm run build:wasm`.
- `scripts/setup-materialx.mjs` accepts an existing non-git `vendor/MaterialX` source copy if it has `source/JsMaterialX` and `libraries`; use `npm run setup:materialx -- --force` to replace it with a fresh clone.
