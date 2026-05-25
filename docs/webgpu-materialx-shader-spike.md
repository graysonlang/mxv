# WebGPU MaterialX Shader Spike

This plan captures the exploratory path for testing whether browser WebGPU can render MaterialX-generated shader output directly enough to justify deeper investment.

The goal is intentionally narrow: learn quickly, measure honestly, and stop before this turns into a full custom renderer by accident.

## Current Baseline

The WebGPU lab currently uses Three.js `WebGPURenderer` for display, but it does not render MaterialX compiler output.

Current behavior:

- The visible mesh uses Three.js built-in WebGPU-compatible materials, primarily `MeshPhysicalMaterial`.
- MaterialX presets and controls are mapped into that Three.js material as a proxy preview.
- MaterialX `WgslShaderGenerator` output is generated for inspection, not for rendering.
- The production-style MaterialX path remains the WebGL viewer, which uses ESSL output through Three.js `RawShaderMaterial`.

This means the WebGPU lab is a useful renderer shell, but it is not yet a MaterialX WebGPU backend test.

## Question

Can we get a small, representative MaterialX-generated shader rendering through browser WebGPU with enough performance or workflow upside to justify expanding the path?

The answer does not need to be perfect fidelity. A useful spike can still succeed if it proves that a browser WebGPU path gives better preview latency, frame stability, or iteration performance for designer-visible material changes.

## Known Constraint

The current pinned MaterialX runtime exposes `WgslShaderGenerator`, but its emitted shader source is not browser WGSL. It currently looks like Vulkan-style GLSL with WebGPU-adjacent resource binding conventions.

That makes this a translation/adaptation spike, not a simple Three.js material swap.

## Non-Goals

Do not try to build the complete production renderer in the spike.

Avoid these until the first proof point is clear:

- Full MaterialX graph coverage.
- Full MaterialX desktop viewer parity.
- Shadow maps.
- Transmission and refraction parity.
- Environment prefiltering parity.
- Multi-pass baking.
- R3F product-canvas integration.
- A generalized shader translation framework.

## Preferred Shape

Start outside the main viewer and outside the main R3F product path.

Use a small WebGPU-only experiment that can reuse existing assets and diagnostics, but is allowed to be simpler than the viewer:

- One mesh.
- One camera.
- One material at a time.
- One generated vertex/pixel shader pair.
- One small set of textures and uniforms.
- Explicit measurement hooks.

If this grows beyond a small direct-WebGPU pipeline or a tiny adapter, treat that as signal that the path is more expensive than expected.

## Candidate Approaches

### 1. Direct WebGPU Micro-Renderer

Render one mesh with a hand-authored WebGPU pipeline and adapt one MaterialX-generated shader into browser WGSL.

This is the clearest way to learn what the browser WebGPU contract requires, but it bypasses Three.js scene/material conveniences.

Use this if the main unknown is the shader payload and binding model.

### 2. Three.js WebGPU Custom Path

Investigate whether Three.js TSL/node materials can host enough generated MaterialX logic to be useful.

This keeps more of the Three.js renderer stack, but may require translating MaterialX code into Three's node model rather than directly consuming generated source.

Use this if direct WebGPU works but the integration cost looks too high.

### 3. Future MaterialX Runtime Recheck

Repeat the generator diagnostic after a MaterialX runtime upgrade.

If upstream starts emitting browser WGSL, the implementation shape changes substantially.

Use this as a periodic check, not as a blocker for the exploratory spike.

## Spike Phases

| Phase | Goal | Stop Condition |
| --- | --- | --- |
| 1. Capture shader contract | Generate a simple material with ESSL and Wgsl outputs, list uniforms, textures, varyings, attributes, and resource bindings. | Stop if the generated Wgsl shape requires broad translation before a trivial material can run. |
| 2. Build minimal WebGPU draw | Render a static mesh with a hand-authored WGSL shader and the same camera framing as the lab. | Stop if browser WebGPU setup dominates the work more than expected. |
| 3. Adapt one MaterialX sample | Translate the smallest representative generated shader into browser WGSL and bind the required uniforms/textures. | Stop if translation becomes a generalized compiler project. |
| 4. Add one complex sample | Try a more realistic material such as pearl after the simple case works. | Stop if the second material needs many special cases. |
| 5. Measure against WebGL | Compare compile/setup time, steady FPS, frame stability, and interaction latency against the existing WebGL path. | Stop if performance is similar and implementation complexity is materially higher. |
| 6. Decide next step | Choose product path: continue WebGPU backend, keep as lab, or defer. | Decide based on measured designer-visible benefit. |

## First Materials

Use a deliberately small ladder:

1. Standard/simple: prove pipeline, uniforms, and a basic surface.
2. Textured material: prove image and sampler bindings.
3. Pearl: stress a more complex preset that is closer to the real motivation.

Pearl is useful as a complexity probe, but it should not be the first shader brought up.

## Measurements

Track measurements in the lab UI or console before drawing conclusions:

- MaterialX runtime load time.
- Shader generation time.
- Shader adaptation or translation time.
- WebGPU shader module creation time.
- Pipeline creation time.
- First visible frame time.
- Steady-state FPS.
- Frame-time variance during orbit interaction.
- Texture and buffer counts.
- Approximate GPU memory pressure where available.

The comparison target is the existing WebGL MaterialX viewer, not the current Three.js proxy WebGPU material.

## Success Criteria

Continue investing if the spike demonstrates at least one of these:

- Material iteration feels noticeably faster on target desktop machines.
- Complex material previews are smoother or more stable than WebGL.
- Shader setup cost is acceptable for agent-driven iteration.
- The binding/adaptation layer is small enough to maintain.
- The path opens a credible route to GPU-side baking or precomputation.

## Defer Criteria

Defer full WebGPU backend work if:

- The visual result is similar to WebGL at similar speed.
- The required shader translation layer looks broad or fragile.
- Three.js/R3F integration would require replacing too much renderer behavior.
- Most of the likely wins require future MaterialX upstream improvements anyway.

## Immediate Next Step

Start with Phase 1: capture the shader contract for the simple sample and pearl using the existing `npm run inspect:payload` and shader generation diagnostics.

The deliverable should be a compact inventory of:

- Vertex inputs.
- Varyings.
- Uniform blocks.
- Texture/sampler bindings.
- Generated helper functions.
- Shader features used by the simple sample versus pearl.
- The smallest subset needed for a browser WebGPU proof draw.
