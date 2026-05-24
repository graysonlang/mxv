# Agent Notes

## Repository Focus

Work from this repository, not the upstream MaterialX checkout:

The upstream MaterialX sources are vendored under `vendor/MaterialX`. Generated Emscripten output should go under `vendor/materialx-runtime`; avoid `vendor/materialx` because macOS case-insensitive filesystems treat it as the same directory as `vendor/MaterialX`.

## Current Build Shape

- `npm run setup:materialx` prepares `vendor/MaterialX`.
- `npm run build:wasm` builds `JsMaterialXGenShader.js`, `.wasm`, and `.data` with `em++` through `scripts/materialx-gen-shader.Makefile`.
- `npm run build` runs the wasm build first, then the existing ESP/esbuild production build.
- `npm run serve` runs the wasm build first, then starts the ESP/esbuild watch server.
- `npm run clean:wasm` removes the generated wasm/object build without immediately rebuilding it.
- `scripts/build.mjs` removes ESP's live-reload banner for non-watch/non-serve builds, so production `dist/main.js` should not request `/esbuild`.

## Current Viewer State

- `app/main.js` dynamically imports `vendor/materialx-runtime/JsMaterialXGenShader.js` and uses `locateFile` to resolve the adjacent `.wasm` and `.data` files.
- The page is currently a shader-generation smoke viewer, not the full MaterialX web viewer.
- The app loads an inline Standard Surface MaterialX document, imports the standard libraries with `mx.loadStandardLibraries`, finds the renderable element, and generates ESSL with `mx.EsslShaderGenerator`.
- The UI shows runtime status, MaterialX version, renderable name, runtime file count, image asset count, and generated vertex/pixel shader source in tabs.
- The known-good renderable in the smoke view is `SR_default`.

The build wrapper finds Emscripten in this order:

1. `CXX=/path/to/em++`
2. `EMSDK/upstream/emscripten/em++`
3. `em++` on `PATH`

Typical setup:

```sh
source /Users/grayson/Depots/github/emscripten-core/emsdk/emsdk_env.sh
npm run setup:materialx
npm run build
npm run dev
```

## Verified So Far

- `npm run build` completes successfully.
- The generated runtime files are copied into `dist/vendor/materialx-runtime/`.
- Node-side smoke test successfully initialized MaterialX and returned version `1.39.5`.
- Static Chrome verification rendered status `Ready`, version `1.39.5`, renderable `SR_default`, and generated ESSL vertex source in the page.
- Static `dist` serving fetched only `main.js`, `JsMaterialXGenShader.js`, `.data`, and `.wasm`; there was no production `/esbuild` request after the banner fix.
- The ESP dev server responded with `HTTP/1.1 200 OK` at `http://127.0.0.1:8000` when run in the foreground/PTTY.

Useful smoke test:

```sh
node --input-type=module -e "import createMX from './vendor/materialx-runtime/JsMaterialXGenShader.js'; const base = new URL('./vendor/materialx-runtime/', import.meta.url); const mx = await createMX({ locateFile: f => new URL(f, base).pathname }); console.log(mx.getVersionString());"
```

## Things To Debug Next

- Do a real interactive browser/devtools pass of the generated shader UI, including the vertex/pixel tab behavior and console output.
- Detached dev-server attempts using `nohup` or zsh disown exited silently in this Codex shell environment. Foreground/PTY serve works. If background serving matters, debug the shell lifecycle around `npm run serve`; this is separate from the MaterialX wasm/runtime path.
- `vendor/MaterialX` may already exist as a non-git source copy. `scripts/setup-materialx.mjs` accepts this if it has `source/JsMaterialX` and `libraries`; use `npm run setup:materialx -- --force` to replace it with a fresh git clone.
- Move from the inline smoke material to real viewer workflows: file/library selection, dropped or selected `.mtlx` files, sample material discovery from `vendor/MaterialX/resources`, shader generation controls, generated source display, and renderer integration.
- Decide which MaterialX resource folders should be copied into `dist` for example materials, textures, lights, and geometry. The current smoke view avoids this by using an inline document.
- Add a browser automation test once the desired test runner is chosen. The current manual verification used headless Chrome against a static Python server over `dist`.
- The Makefile source list is intentionally slim for `JsMaterialXGenShader`. If future MaterialX versions add new required binding/source files, update `scripts/materialx-gen-shader.Makefile` and rerun `npm run clean:wasm && npm run build:wasm`.
- Keep generated folders ignored: `vendor/MaterialX`, `vendor/.build`, `vendor/.cache`, `vendor/materialx-runtime`, and `dist`.

## Notes For Future Agents

Prefer small, repo-local changes in `mxv`. Do not modify the downloaded `vendor/MaterialX` checkout for this migration unless explicitly asked. If CMake details are needed, use the vendored MaterialX source as reference only; this project is intentionally using a plain Emscripten Makefile and ESP/esbuild for the web app.
