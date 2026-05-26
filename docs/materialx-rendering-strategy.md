# MaterialX Rendering Strategy

This note captures the current rationale for integrating MaterialX into a web product-design application, and for treating WebGPU as an experimental renderer path rather than a prerequisite for the first production MaterialX integration.

## Product Goal

The main product goal is to make MaterialX a first-class material language for product design and CMF workflows.

Today, product design iterations can rely heavily on image assets, palettes, and colorways, but those assets do not fully encode material intent. MaterialX gives designers and agents a structured way to describe surface properties such as base color, roughness, metallic response, specular behavior, transmission, textures, and material graph relationships. That material intent can then be previewed in the web app and potentially handed off to downstream tools such as Blender, Maya, USD pipelines, or game asset workflows.

The first-order unlock is MaterialX itself, not WebGPU. A WebGL MaterialX preview can still represent a large and useful slice of practical surface material expression.

## Current Viewer Path

The current viewer is a WebGL-oriented MaterialX preview path:

- MaterialX shader generation uses the ESSL generator.
- Generated GLSL ES is displayed through Three.js `RawShaderMaterial`.
- Three.js handles shader compilation, program linkage, attribute binding, uniforms, textures, render state, scene traversal, and draw submission.
- The app can use this path as a stable preview and fallback for broad browser support.

This path maps cleanly onto Three.js because `RawShaderMaterial` is supported by `WebGLRenderer`.

## WebGPU Motivation

WebGPU remains strategically interesting, especially for high-end desktop users, because it exposes a more modern GPU programming model:

- Render and compute pipelines.
- Storage buffers and storage textures.
- More explicit resource management.
- Lower potential JavaScript overhead for some workloads.
- Better alignment with modern native GPU APIs such as Metal, Vulkan, and Direct3D 12.

This could help future workflows such as:

- Procedural material baking.
- Environment map prefiltering.
- Directional albedo or lookup-table generation.
- Heavy graph evaluation prepasses.
- GPU-side preview pipelines for complex generated materials.
- Potentially richer pro-preview or inspection modes.

These are valuable possibilities, but most of them require renderer architecture work beyond switching shader generators.

## What WebGPU Does Not Automatically Unlock

WebGPU does not automatically make MaterialX more semantically expressive. MaterialX is the material language; WebGPU is a rendering and compute backend.

Specific caveats:

- WebGPU/WGSL exposes vertex, fragment, and compute shader stages. It does not expose traditional geometry or tessellation shader stages.
- Displacement maps are not automatically solved by WebGPU. Existing vertices can be displaced in a vertex shader, but high-quality displacement still needs dense geometry, subdivision, tessellation-like preprocessing, or compute-generated geometry.
- MaterialX WGSL output by itself is likely to produce a vertex/fragment rendering path similar in shape to the current ESSL path. Compute-driven optimization would need explicit extra passes.
- Three.js `WebGPURenderer` does not support custom `ShaderMaterial` or `RawShaderMaterial` paths directly. MaterialX-generated WGSL cannot simply replace GLSL inside the current Three material handoff.

## R3F Implications

The main product application uses React Three Fiber for its primary rendering context. That helps with WebGPU experimentation because R3F supports async renderer creation for Three's `WebGPURenderer`.

However, R3F still sits on top of Three.js. The limitation remains: Three's WebGPU renderer expects WebGPU-compatible Three materials and node/TSL workflows, not arbitrary MaterialX-generated WGSL shader pairs.

This means R3F can make a WebGPU renderer mode easier to mount, isolate, and compare, but it does not remove the need for a dedicated MaterialX WebGPU material/rendering backend if we want to render MaterialX WGSL directly.

## Recommended Product Path

Ship the MaterialX WebGL path first.

This gives designers the core benefit sooner: structured material intent, portable material descriptions, agent-editable material graphs, and downstream export potential. WebGL is also the right fallback path for mobile, older browsers, and contexts where WebGPU is unavailable or unstable.

Keep the implementation backend-aware so that future WebGPU work is not blocked:

- Keep MaterialX document handling separate from renderer-specific material creation.
- Keep shader target selection explicit, for example `essl` versus `wgsl`.
- Keep renderer target selection explicit, for example `webgl` versus `webgpu`.
- Preserve stable material graph inputs and output metadata that can feed multiple preview backends.
- Instrument compile time, preview latency, frame time, texture count, material graph complexity, and memory pressure.

## Pop-Out Renderer Strategy

If higher fidelity or specialized backend behavior is needed, use a focused pop-out renderer rather than forcing the main R3F product canvas to carry every rendering experiment.

Potential pop-out modes:

- MaterialX WebGL inspector: stable reference preview using the current ESSL path.
- Calibrated material preview: fixed shaderball, camera, HDRI, tone mapping, and lighting for reproducible thumbnails.
- WebGPU experimental preview: Three.js WebGPU display path with MaterialX WebGPU-flavored shader generation surfaced for controlled material experiments.
- Export validation preview: compare web preview against expected Blender, Maya, or USD handoff behavior.
- Performance preview: stress-test shader compile time, material graph complexity, texture use, and runtime frame cost.

This lets the main app stay responsive and product-focused while giving advanced workflows a place to become more specialized.

## Implementation Roadmap

Use the WebGPU lab as a measured staging area. Keep each phase small enough to validate independently.

| Phase | Status | Goal | Notes |
| --- | --- | --- | --- |
| 1. WebGPU lab baseline | Done | Keep a separate `/webgpu.html` entry point that can exercise Three.js `WebGPURenderer`, WebGL2 fallback, model loading, environment loading, orbit controls, FPS display, and MaterialX shader generation inspection. | This is a renderer lab, not a direct MaterialX WGSL renderer yet. |
| 2. Instrumentation | Done: initial | Measure backend, first-frame time, model load time, HDR/environment setup time, MaterialX runtime load time, shader generation time, average FPS, and frame-time stability. | Metrics are visible in the lab UI and can be compared across WebGPU and fallback modes. |
| 3. Material state sync | Done: initial | Drive both the visible Three.js proxy material and generated MaterialX sample from the same material state. | The preview controls, MaterialX source tab, and shadergen panel now share state. |
| 4. Generator reality check | Done: pinned runtime | Verify what the pinned MaterialX `WgslShaderGenerator` currently emits, whether a newer MaterialX ref improves WebGPU/WGSL output, and what it would take to consume it directly. | `npm run inspect:shadergen` confirms MaterialX 1.39.5 exposes `WgslShaderGenerator`, but it currently emits Vulkan-style GLSL rather than browser WGSL. Re-run after any MaterialX ref upgrade. |
| 5. Direct WebGPU shader spike | In progress | Render one mesh and one generated material through a minimal direct WebGPU pipeline. | Phase 1 contract capture and Phase 2 direct proof draw are recorded in [webgpu-materialx-shader-spike.md](webgpu-materialx-shader-spike.md); Phase 3 now has a MaterialX-shaped WebGPU binding bridge and a narrow generated-vertex adapter, while full generated-fragment translation remains open. |
| 6. Product integration decision | Future | Decide whether WebGPU graduates into a supported pro-renderer path, remains a lab feature, or is deferred. | Use measured designer-visible wins as the gate. |

## Generator Reality Check

The repo includes a local diagnostic command for checking what the bundled MaterialX shader generators emit:

```sh
npm run inspect:shadergen
```

The command loads the `@graysonlang/mx` runtime package, generates shader source for a representative MaterialX material, classifies the emitted vertex and pixel stages, and prints a short conclusion. It also supports a simpler sample and machine-readable output:

```sh
npm run inspect:shadergen -- --sample=standard --json
```

For a broader payload inventory, including exposed generator classes, `GenOptions`, enums, emitted declarations, and shader uniform blocks, use:

```sh
npm run inspect:payload
npm run inspect:payload -- --interface=both --json
```

Against the current pinned MaterialX runtime, `v1.39.5`, the result is:

- `EsslShaderGenerator` emits GLSL ES 3.00 source with `#version 300 es`.
- `WgslShaderGenerator` is available, but its reported target is `genglsl`.
- The generated vertex and pixel stages begin with `#version 450`, use `#pragma shader_stage(...)`, and include GLSL `layout (...)` qualifiers.
- The generated source does not contain browser WGSL markers such as `@vertex`, `@fragment`, `@group`, `@binding`, or `fn main`.

Conclusion: the current pinned runtime does not provide browser-consumable WGSL. A direct WebGPU renderer would need either a future MaterialX generator that emits true WGSL, a translation step from this Vulkan-style GLSL shape, or a custom WebGPU/TSL rendering path that does not directly consume the generated source.

## WebGPU Spike Plan

Before committing to a full WebGPU MaterialX renderer, run a narrow benchmark spike:

1. Re-run `npm run inspect:shadergen` after any MaterialX source upgrade and inspect whether the generated vertex and fragment stages are true WGSL.
2. Build a tiny direct-WebGPU preview for one mesh, one HDR environment, and a small set of representative MaterialX materials.
3. Compare against the current WebGL path on representative user machines.
4. Measure first preview time, shader generation time, shader compile time, steady-state FPS, GPU frame time where available, memory pressure, and interaction latency.
5. Identify which wins are visible to designers, not just theoretically cleaner from a renderer architecture perspective.

The working plan for this exploration lives in [webgpu-materialx-shader-spike.md](webgpu-materialx-shader-spike.md).

## Decision Gate

Invest in a full WebGPU MaterialX renderer if the spike proves at least one strong product win:

- Noticeably faster material iteration for agent-generated changes.
- Better interaction performance on complex material graphs.
- Better support for GPU-side baking or precomputation.
- A fidelity feature that users can see and that WebGL cannot deliver acceptably.
- Clear alignment with a premium desktop/pro workflow.

Defer the full WebGPU backend if the outcome is mostly the same image at similar speed with substantially more renderer code.

## Current Recommendation

Use WebGL as the production MaterialX integration path now. Treat WebGPU as a future pro-renderer and benchmarking lane, preferably in a pop-out material lab or inspector first.

This balances product value and engineering cost: MaterialX gets into designers' hands quickly, while WebGPU remains available for targeted fidelity and performance work once there is measured evidence that it pays for its complexity.

## References

- Three.js `RawShaderMaterial` documentation: https://threejs.org/docs/pages/RawShaderMaterial.html
- Three.js `WebGPURenderer` manual: https://threejs.org/manual/en/webgpurenderer
- React Three Fiber v9 migration guide, WebGPU renderer setup: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- MDN WebGPU API overview: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- W3C WGSL specification: https://www.w3.org/TR/WGSL/
- Chrome WebGPU launch note: https://developer.chrome.com/blog/webgpu-release
