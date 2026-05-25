# Agent Notes

## Scope

Work in this repository, not the upstream MaterialX checkout. General project setup, build, run, and viewer usage docs live in `README.md`.

Filtered upstream MaterialX viewer assets are vendored under `vendor/MaterialX`. Treat that directory as input/reference unless the user explicitly asks to modify vendored source.

Generated Emscripten output lives in the sibling `../mx` runtime package. The viewer copies those package files into `dist/vendor/materialx-runtime` during builds; avoid `vendor/materialx` because macOS case-insensitive filesystems treat it as the same directory as `vendor/MaterialX`.

## Local Workflow

- Prefer small, repo-local changes in `mxv`.
- Run `npm run build` after code changes that affect the app, build scripts, or wasm integration.
- Use `npm run setup:assets` when a clean checkout needs the filtered MaterialX viewer resources.
- Use `npm run serve -- --host=127.0.0.1 --port=8080 --vscode` for local browser checks.
- The ESP live-reload banner is intentionally removed in `scripts/build.mjs`; asset streaming from the viewer can otherwise cause reload loops.
- Keep generated/vendor folders ignored by tooling: `vendor/MaterialX`, `vendor/.build`, `vendor/.cache`, `vendor/materialx-runtime`, and `dist`.

## Implementation Cautions

- `app/index.js` is the hash-fragment renderer shell.
- `app/webgl.js` is the main WebGL viewer.
- `app/smoke.js` is a smaller shader-generation smoke/debug entry point.
- `app/materialx-viewer/viewer.js` is copied upstream viewer code with local patches.
- The runtime build now lives in the sibling `../mx` package. If future MaterialX versions add required binding/source files, update the Makefile there and publish or link a refreshed `@graysonlang/mx` package.
- Specular `none` intentionally does not use MaterialX `SPECULAR_ENVIRONMENT_NONE`. The UI maps it to the prefiltered shader path and binds a black 1x1 radiance texture at runtime so diffuse irradiance remains visible.

## Browser Debugging

Use `docs/debugging.md` for browser checks. In particular, plain headless Chrome may fail to create WebGL contexts on macOS; the dedicated doc has the SwiftShader/ANGLE command that worked for this repo.
