# mxv

`mxv` is a web-based MaterialX viewer experiment. It vendors selected upstream MaterialX resources for viewer assets, consumes a prebuilt `JsMaterialXGenShader` WebAssembly runtime from `@graysonlang/mx`, and uses ESP/esbuild plus Three.js for the browser UI.

The current app can load MaterialX example materials and geometry from the vendored MaterialX resources, compile shaders in the browser through the MaterialX JavaScript bindings, and render the result with configurable render and shader-generation options.

## Project Shape

- `app/index.js` is the hash-fragment renderer shell for `/`.
- `app/webgl.js` is the main WebGL MaterialX model/material viewer.
- `app/smoke.js` is a smaller shader-generation smoke test kept for debugging the MaterialX runtime.
- `app/webgpu.js` is an experimental WebGPU material lab entry point.
- `app/webgpu-direct.js` is a minimal direct-WebGPU proof draw for the MaterialX shader spike.
- `app/materialx-viewer/` contains the adapted MaterialX web viewer code.
- `@graysonlang/mx` provides the prebuilt MaterialX JavaScript/WASM shader-generation runtime.
- `scripts/setup-materialx.mjs` clones or updates the filtered `vendor/MaterialX` viewer asset checkout from the pinned source in `materialx-source.json`.
- `scripts/prepare-static-assets.mjs` copies runtime files and selected MaterialX resources into `dist`.
- `docs/materialx-rendering-strategy.md` captures the WebGL/WebGPU rendering strategy rationale.
- `docs/webgpu-materialx-shader-spike.md` captures the direct MaterialX-to-WebGPU exploration plan.

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
npm run setup:assets
```

Refresh viewer resources after setup:

```sh
npm run setup:assets
```

By default, setup uses the known-good MaterialX source pinned in `materialx-source.json`. The runtime package comes from npm/GitHub during `npm install`; the setup script only clones viewer assets into `vendor/MaterialX`. The clone is a blobless partial clone, uses sparse checkout for the required asset roots, and skips MaterialX submodules. You can override the source with environment variables or flags when testing an upgrade, branch, fork, tag, or commit:

```sh
MATERIALX_REF=main npm run setup:assets
npm run setup:assets -- --repo=https://github.com/AcademySoftwareFoundation/MaterialX.git --ref=v1.39.5
npm run setup:assets -- --force
```

If `vendor/MaterialX` already exists as a non-git asset copy and has the expected viewer asset folders, setup will use it. Pass `--force` to replace it with a fresh clone. `npm run setup:materialx` remains available as a compatibility alias for `npm run setup:assets`.

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
npm run inspect:payload
npm run build
```

This is preferred over global `npm link` for this repo pair because it keeps the local package override explicit in `mxv` and avoids hidden global npm link state. If `node_modules/@graysonlang/mx` is installed as a symlink, rebuilding `../mx` is enough for the next `mxv` build or diagnostic command to see the refreshed runtime files.

When the GitHub dependency should be refreshed, commit the regenerated `dist/runtime` files in the `mx` repo, then reinstall in `mxv`. The package version still records the upstream MaterialX version, for example `@graysonlang/mx@1.39.5`, but `mxv` does not depend on the package being published to the npm registry.

## Build

Build the full web app:

```sh
npm run build
```

The full build prepares static assets, copies the prebuilt runtime from `@graysonlang/mx`, validates that the filtered MaterialX viewer assets are present, then bundles the app into `dist`.

Inspect what the bundled MaterialX shader generators emit:

```sh
npm run inspect:shadergen
```

This is useful when checking WebGPU readiness. Against the current `@graysonlang/mx@1.39.5` runtime, the `WgslShaderGenerator` is available but emits Vulkan-style GLSL rather than browser WGSL.

Inspect the broader runtime payload, exposed generator classes, `GenOptions`, enum values, emitted shader syntax, declarations, and uniform blocks:

```sh
npm run inspect:payload
npm run inspect:payload -- --interface=both --json
```

Dump generated shader sources for local inspection:

```sh
npm run dump:shadergen
npm run dump:shadergen -- --sample=standard --generator=wgsl,essl
```

The default dump writes the configured Wgsl-generator sample outputs plus a manifest to `vendor/.cache/materialx-shaders`, which is intentionally ignored by git.

To test whether Naga can translate the MaterialX Vulkan-style GLSL output to browser WGSL, install `naga-cli` locally and run the spike:

```sh
cargo install naga-cli --root vendor/.cache/naga-cli
npm run spike:naga
```

The spike writes translated WGSL to `vendor/.cache/naga-materialx`, also ignored by git. Builds copy those cached WGSL fixtures into `dist/vendor/naga-materialx` when they are present. Set `MXV_NAGA=/path/to/naga` to use another Naga binary.

Browser-verify the generated Naga WGSL with Chrome/WebGPU:

```sh
npm run verify:naga-wgsl
```

The Naga spike includes two narrow MaterialX pre-passes: boolean uniform alias lowering and a derivative-free fallback for the generated subsurface radius path that otherwise trips Chrome's `fwidth` uniformity analysis. With those shims, the verifier checks the translated binding contract, browser-compiles every generated vertex and pixel module, and compiles each sample as a render pipeline using the direct WebGPU bind group layout.

## Run

Start the development server:

```sh
npm run dev
```

This starts ESP on the default port and launches Chrome. The viewer is available at:

```text
http://127.0.0.1:8000/
```

The renderer shell uses fragments for mode selection:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/#webgl
http://127.0.0.1:8000/#webgpu
http://127.0.0.1:8000/#direct
http://127.0.0.1:8000/#smoke
```

With no fragment, the shell currently defaults to the direct WebGPU proof draw.

The smoke test entry is also built and can be opened at:

```text
http://127.0.0.1:8000/smoke.html
```

The renderer pages are also available directly:

```text
http://127.0.0.1:8000/webgl.html
http://127.0.0.1:8000/webgpu.html
http://127.0.0.1:8000/webgpu-direct.html
```

The direct WebGPU page loads the MaterialX shaderball and the `San Giuseppe Bridge Split` HDR environment by default. It defaults to the Naga-translated generated MaterialX shader path, with `shader=bridge` still available for contract diagnostics. The radiance texture is uploaded with a generated mip chain so MaterialX `u_envRadianceMips` lookups can exercise rough and anisotropic environment sampling. It also accepts `material`, `shader`, `envSamples`, `envIntensity`, and `environment` query params for focused shader checks:

```text
http://127.0.0.1:8000/webgpu-direct.html?material=pearl
http://127.0.0.1:8000/webgpu-direct.html?material=standard&shader=bridge
http://127.0.0.1:8000/webgpu-direct.html?material=brushedMetal&envSamples=4&envIntensity=1
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&envSamples=16&envIntensity=1
http://127.0.0.1:8000/webgpu-direct.html?material=brassTiled&envSamples=16&envIntensity=1
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&drawEnvironment=1
http://127.0.0.1:8000/webgpu-direct.html?material=brushedMetal&environment=vendor/MaterialX/resources/Lights/table_mountain_split.hdr
```

## WebGL Viewer Options

The WebGL viewer persists common settings in the URL. Friendly names are used for material and model selection:

```text
http://127.0.0.1:8000/webgl.html?material=Standard+Surface+Default&model=Shaderball
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
