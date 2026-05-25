# mxv

`mxv` is a web-based MaterialX viewer experiment. It vendors selected upstream MaterialX resources for viewer assets, consumes a prebuilt `JsMaterialXGenShader` WebAssembly runtime from `@graysonlang/mx`, and uses ESP/esbuild plus Three.js for the browser UI.

The current app can load MaterialX example materials and geometry from the vendored MaterialX resources, compile shaders in the browser through the MaterialX JavaScript bindings, and render the result with configurable render and shader-generation options.

## Project Shape

- `app/main.js` is the main model/material viewer.
- `app/smoke.js` is a smaller shader-generation smoke test kept for debugging the MaterialX runtime.
- `app/webgpu.js` is an experimental WebGPU material lab entry point.
- `app/materialx-viewer/` contains the adapted MaterialX web viewer code.
- `@graysonlang/mx` provides the prebuilt MaterialX JavaScript/WASM shader-generation runtime.
- `scripts/setup-materialx.mjs` clones or updates `vendor/MaterialX` from the pinned source in `materialx-source.json` for viewer resources.
- `scripts/prepare-static-assets.mjs` copies runtime files and selected MaterialX resources into `dist`.
- `docs/materialx-rendering-strategy.md` captures the WebGL/WebGPU rendering strategy rationale.

Generated output is intentionally kept out of source control:

- `vendor/MaterialX`
- `dist`

## Requirements

- Node.js and npm
- Git

Emscripten is only needed when rebuilding the separate `@graysonlang/mx` runtime package, not when building or running this viewer.

## Setup

Bootstrap a fresh checkout:

```sh
npm run bootstrap
```

Or install JavaScript dependencies and fetch viewer resources separately:

```sh
npm install
npm run setup:materialx
```

Refresh viewer resources after setup:

```sh
npm run setup:materialx
```

By default, setup uses the known-good MaterialX source pinned in `materialx-source.json`. The clone is a blobless partial clone, and sparse checkout may omit top-level folders that are not needed by the viewer. You can override the source with environment variables or flags when testing an upgrade, branch, fork, tag, or commit:

```sh
MATERIALX_REF=main npm run setup:materialx
npm run setup:materialx -- --repo=https://github.com/AcademySoftwareFoundation/MaterialX.git --ref=v1.39.5
npm run setup:materialx -- --force
```

If `vendor/MaterialX` already exists as a non-git source copy and has the expected MaterialX layout, setup will use it. Pass `--force` to replace it with a fresh clone.

## Runtime Dependency

The MaterialX JavaScript/WASM runtime is supplied by the `@graysonlang/mx` package repo. For now this repo installs it directly from GitHub instead of relying on a published npm semver package:

```json
"@graysonlang/mx": "github:graysonlang/mx"
```

This keeps the expensive Emscripten compile out of the viewer build loop while the runtime package API and packaging shape are still settling. The viewer build copies the installed package runtime files into `dist/vendor/materialx-runtime` so the app can keep using stable browser URLs.

For local runtime development, you can still point npm at a sibling checkout:

```sh
cd ../mx
npm run build
npm run verify
cd ../mxv
npm install --no-save ../mx
npm run build
```

When the GitHub dependency should be refreshed, commit the regenerated `dist/runtime` files in the `mx` repo, then reinstall in `mxv`. The package version still records the upstream MaterialX version, for example `@graysonlang/mx@1.39.5`, but `mxv` does not depend on the package being published to the npm registry.

## Build

Build the full web app:

```sh
npm run build
```

The full build prepares static assets, copies the prebuilt runtime from `@graysonlang/mx`, then bundles the app into `dist`.

Inspect what the bundled MaterialX shader generators emit:

```sh
npm run inspect:shadergen
```

This is useful when checking WebGPU readiness. Against the current `@graysonlang/mx@1.39.5` runtime, the `WgslShaderGenerator` is available but emits Vulkan-style GLSL rather than browser WGSL.

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
