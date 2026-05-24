# mxv

`mxv` is a web-based MaterialX viewer experiment. It vendors the upstream MaterialX source tree, builds a focused `JsMaterialXGenShader` WebAssembly bundle with Emscripten, and uses ESP/esbuild plus Three.js for the browser UI.

The current app can load MaterialX example materials and geometry from the vendored MaterialX resources, compile shaders in the browser through the MaterialX JavaScript bindings, and render the result with configurable render and shader-generation options.

## Project Shape

- `app/main.js` is the main model/material viewer.
- `app/smoke.js` is a smaller shader-generation smoke test kept for debugging the MaterialX runtime.
- `app/materialx-viewer/` contains the adapted MaterialX web viewer code.
- `scripts/materialx-gen-shader.Makefile` builds the slim Emscripten target without CMake.
- `scripts/setup-materialx.mjs` clones or updates `vendor/MaterialX` from the pinned source in `materialx-source.json`.
- `scripts/prepare-static-assets.mjs` copies runtime files and selected MaterialX resources into `dist`.
- `docs/materialx-rendering-strategy.md` captures the WebGL/WebGPU rendering strategy rationale.

Generated output is intentionally kept out of source control:

- `vendor/MaterialX`
- `vendor/.build`
- `vendor/.cache`
- `vendor/materialx-runtime`
- `dist`

## Requirements

- Node.js and npm
- Git
- Emscripten SDK with `em++`

The wasm build looks for Emscripten in this order:

1. `CXX=/path/to/em++`
2. `EMSDK/upstream/emscripten/em++`
3. `em++` on `PATH`

On this machine, the usual Emscripten setup is:

```sh
source /Users/grayson/Depots/github/emscripten-core/emsdk/emsdk_env.sh
```

## Setup

Bootstrap a fresh checkout:

```sh
npm run bootstrap
```

Or install JavaScript dependencies and fetch MaterialX separately:

```sh
npm install
npm run setup:materialx
```

Refresh MaterialX after setup:

```sh
npm run setup:materialx
```

By default, setup uses the known-good MaterialX source pinned in `materialx-source.json`. The clone is a blobless partial clone, and the top-level MaterialX `documents` folder is omitted with sparse checkout. You can override the source with environment variables or flags when testing an upgrade, branch, fork, tag, or commit:

```sh
MATERIALX_REF=main npm run setup:materialx
npm run setup:materialx -- --repo=https://github.com/AcademySoftwareFoundation/MaterialX.git --ref=v1.39.5
npm run setup:materialx -- --force
```

If `vendor/MaterialX` already exists as a non-git source copy and has the expected MaterialX layout, setup will use it. Pass `--force` to replace it with a fresh clone.

## Build

Build only the MaterialX WebAssembly runtime:

```sh
npm run build:wasm
```

Clean the wasm/object build:

```sh
npm run clean:wasm
```

Build the full web app:

```sh
npm run build
```

The full build runs `build:wasm`, prepares static assets, then bundles the app into `dist`.

## Run

Start the development server:

```sh
npm run serve -- --host=127.0.0.1 --port=8080 --vscode
```

Then open:

```text
http://127.0.0.1:8080/
```

The smoke test entry is also built and can be opened at:

```text
http://127.0.0.1:8080/smoke.html
```

## Viewer Options

The viewer persists common settings in the URL. Friendly names are used for material and model selection:

```text
http://127.0.0.1:8080/?material=Standard+Surface+Default&model=Shaderball
```

Supported query params:

- `material=<friendly material name>`
- `model=<friendly model name>`
- `environment=<friendly environment name>`
- `quality=performance|balanced|high|native|adaptive`
- `antialias=on|off`
- `aa=on|off`
- `specular=fis|prefilter|none`
- `albedo=analytic|table|monte-carlo`
- `interface=complete|reduced`
- `srgb=on|off`

Legacy/full-path aliases are still accepted for compatibility:

- `file`
- `materials`
- `geom`

Keyboard shortcuts:

- `[` and `]` navigate previous/next material.
- `{` and `}` navigate previous/next model.

## Render And Shader Notes

The default render configuration is intended to match the published ASWF MaterialX Web Viewer:

- `quality=performance`
- `antialias=on`

Specular modes:

- `fis` uses MaterialX filtered importance sampling.
- `prefilter` uses a prefiltered environment map and is much faster for large screen coverage.
- `none` keeps the prefiltered shader path but binds a black specular radiance texture at runtime. This avoids MaterialX `SPECULAR_ENVIRONMENT_NONE`, which removes broader environment lighting and can make the object disappear.

## Useful Debugging

See [docs/debugging.md](docs/debugging.md) for dev-server checks and the headless Chrome WebGL screenshot recipe.
