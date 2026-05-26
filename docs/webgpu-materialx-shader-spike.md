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
| 1. Capture shader contract | Generate a simple material with ESSL and Wgsl outputs, list uniforms, textures, varyings, attributes, and resource bindings. | Done: initial contract captured for `standard` and `pearl`. |
| 2. Build minimal WebGPU draw | Render a static mesh with a hand-authored WGSL shader and the same camera framing as the lab. | Done: `/webgpu-direct.html` proof draw added, now loading the MaterialX shaderball GLB with a generated sphere fallback. |
| 3. Adapt one MaterialX sample | Translate representative generated shaders into browser WGSL and bind the required uniforms/textures. | Direction set: Naga-translated WGSL is the default direct WebGPU path; the hand-authored bridge remains diagnostic only. Texture-backed wood and brass samples now render through Naga. |
| 4. Add coverage samples | Exercise representative standard-surface feature families after the simple case works. | Done: direct page now covers standard, pearl, brushed metal, car paint, smoked glass, emissive plastic, coated fabric, tiled wood, and tiled brass sample values. |
| 5. Measure against WebGL | Compare compile/setup time, steady FPS, frame stability, and interaction latency against the existing WebGL fallback. | Continue hardening Naga unless parity or reliability regresses materially. |
| 6. Decide next step | Choose how to productize the path. | Current recommendation: WebGPU + Naga first, WebGL fallback for unsupported systems. |

## First Materials

Use a deliberately small ladder:

1. Standard/simple: prove pipeline, uniforms, and a basic surface.
2. Pearl: stress coat, sheen, subsurface, and thin-film-style values that are closer to the real motivation.
3. Brushed metal: exercise metalness, anisotropy, anisotropy rotation, and coat.
4. Car paint: mirror the upstream Standard Surface car-paint example to stress colored base, anisotropic specular, and a strong clear coat without emission clipping.
5. Smoked glass: exercise transmission, opacity, thin-walled behavior, and coat.
6. Emissive plastic: exercise emission values alongside a conventional surface, but avoid using it as the main visual parity sample because the emission term can clamp presentation.
7. Coated fabric: exercise diffuse roughness, sheen, and coat together.
8. Tiled wood: exercise UV attributes, image texture/sampler bindings, texture color-space conversion, and texture-driven roughness.
9. Tiled brass: exercise the same texture binding family on a metallic, coated surface with texture-driven coat color and roughness.

Pearl is useful as a complexity probe, but it should not be the first shader brought up.
Texture bindings are now represented by tiled wood and tiled brass because they add a new resource-binding family rather than only broadening public uniform coverage.

## Phase 1 Findings

The initial shader contract pass used:

```sh
npm run inspect:payload -- --sample=standard --limit=80
npm run inspect:payload -- --sample=pearl --limit=120
npm run inspect:payload -- --sample=standard --interface=both --limit=40
npm run inspect:payload -- --sample=pearl --interface=both --limit=40
```

Runtime:

- `@graysonlang/mx@1.39.5`.
- Upstream MaterialX `v1.39.5`, commit `7b64921ef1d42f2d57871e9d2c43dc11f041f26b`.
- `WgslShaderGenerator` is available, but reports target `genglsl`.
- Emitted Wgsl stages are Vulkan-style GLSL: `#version 450`, `#pragma shader_stage(...)`, `layout(...)`.
- Emitted stages do not contain browser WGSL entry markers such as `@vertex`, `@fragment`, `@group`, `@binding`, or `fn main`.
- MaterialX emits warnings that WGSL does not allow booleans in uniform or storage address spaces; the Wgsl generator maps those booleans to integer ports in the inspected uniform blocks.

Important result: `standard` and `pearl` have the same shader contract for this standard-surface sample shape. Pearl changes values in `PublicUniforms_pixel`, but it does not add new vertex attributes, textures, uniform blocks, or bindings.

Reduced interface did not reduce the relevant contract for these samples. Complete and reduced interfaces produced the same Wgsl line counts, byte counts, bindings, and uniform blocks.

### Vertex Contract

The generated Wgsl-style vertex stage is small and stable:

- Source size: 83 lines, 2087 bytes.
- Entry: `#pragma shader_stage(vertex)` plus `void main()`.
- Vertex inputs:
  - `layout (location = 0) in vec3 i_position`
  - `layout (location = 1) in vec3 i_normal`
  - `layout (location = 2) in vec3 i_tangent`
- Vertex output:
  - `layout (location = 0) out VertexData`
- Bindings:
  - `layout (std140, binding=0) uniform PrivateUniforms_vertex`
- `PrivateUniforms_vertex` ports:
  - `u_worldMatrix: matrix44`
  - `u_viewProjectionMatrix: matrix44`
  - `u_worldInverseTransposeMatrix: matrix44`

There are no public material uniforms in the vertex stage for these samples.

### Pixel Contract

The generated Wgsl-style pixel stage is large but also stable between `standard` and `pearl`:

- Source size: roughly 2004 lines and 79.9 KB.
- Entry: `#pragma shader_stage(fragment)` plus `void main()`.
- Fragment input:
  - `layout (location = 0) in VertexData`
- Fragment output:
  - `layout (location = 0) out vec4 out1`

Bindings:

- `binding=1`: `PrivateUniforms_pixel`, `std140`.
- `binding=2`: `texture2D u_envRadiance_texture`.
- `binding=3`: `sampler u_envRadiance_sampler`.
- `binding=4`: `texture2D u_envIrradiance_texture`.
- `binding=5`: `sampler u_envIrradiance_sampler`.
- `binding=6`: `PublicUniforms_pixel`, `std140`.
- `binding=7`: `LightData_pixel`, `std140`.

`PrivateUniforms_pixel` ports:

- `u_envMatrix: matrix44`
- `u_envRadiance: filename`
- `u_envLightIntensity: float`
- `u_envRadianceMips: integer`
- `u_envRadianceSamples: integer`
- `u_envIrradiance: filename`
- `u_refractionTwoSided: integer`
- `u_viewPosition: vector3`
- `u_numActiveLightSources: integer`

`PublicUniforms_pixel` has 39 standard-surface ports:

- Base and diffuse: `base`, `base_color`, `diffuse_roughness`.
- Specular and metal: `metalness`, `specular`, `specular_color`, `specular_roughness`, `specular_IOR`, `specular_anisotropy`, `specular_rotation`.
- Transmission: `transmission`, `transmission_color`, `transmission_depth`, `transmission_scatter`, `transmission_scatter_anisotropy`, `transmission_dispersion`, `transmission_extra_roughness`.
- Subsurface: `subsurface`, `subsurface_color`, `subsurface_radius`, `subsurface_scale`, `subsurface_anisotropy`.
- Sheen: `sheen`, `sheen_color`, `sheen_roughness`.
- Coat: `coat`, `coat_color`, `coat_roughness`, `coat_anisotropy`, `coat_rotation`, `coat_IOR`, `coat_affect_color`, `coat_affect_roughness`.
- Thin film and emission: `thin_film_thickness`, `thin_film_IOR`, `emission`, `emission_color`.
- Visibility: `opacity`, `thin_walled`.

Without a registered light rig, `LightData_pixel` collapses to a stub shape and generated `sampleLightSource` returns zero intensity. The direct spike now registers the same default light rig used by the WebGL viewer, `resources/Lights/san_giuseppe_bridge_split.mtlx`, so the generated pixel shader emits a real directional-light path with `direction`, `color`, `light_type`, `intensity`, and padding in binding 7.

### Translation Implications

The first proof draw should not start with pearl-specific logic. It should bring up the common standard-surface contract once, using the simple material values first.

The minimum browser WebGPU proof still needs:

- A WGSL vertex shader with position, normal, and tangent attributes.
- A WGSL fragment shader that can accept the `VertexData` equivalent.
- Uniform buffer layouts matching the generated std140 intent closely enough for the first sample.
- Environment radiance and irradiance texture/sampler bindings, even if they start as simple placeholder textures.
- A MaterialX light block for the default directional light rig while the generated private uniforms stay aligned with MaterialX's emitted block.

The main risk is not sample complexity yet. The main risk is translating or adapting the roughly 80 KB Vulkan-style fragment shader into browser WGSL without accidentally starting a general-purpose shader compiler.

## Desktop Viewer Reference

Use the upstream desktop viewer as the reference point for environment-lighting assumptions while evaluating visual parity:

- `../mx/vendor/MaterialX/source/MaterialXView/Main.cpp` defaults to `resources/Lights/san_giuseppe_bridge_split.hdr`, `SPECULAR_ENVIRONMENT_FIS`, `mx::DEFAULT_ENV_SAMPLE_COUNT`, and environment light intensity `1.0`.
- The desktop command-line help reports `--envMethod 0` as filtered importance sampling, `--envMethod 1` as prefiltered environment maps, and `--envSampleCount` defaulting to `16`.
- `../mx/vendor/MaterialX/source/MaterialXView/RenderPipelineGL.cpp` only updates the prefiltered environment map when `LightHandler::getUsePrefilteredMap()` is true; otherwise the default path is the generated shader's filtered-importance-sampling environment path.
- The same desktop prefilter path binds the source radiance map with periodic U addressing, clamped V addressing, and linear filtering. The direct WebGPU path mirrors this for lat-long environment sampling with `addressModeU: "repeat"`, `addressModeV: "clamp-to-edge"`, and linear mip filtering.

For this spike, `envSamples=16&envIntensity=1` on the default Naga path is the closest direct-viewer setting to the desktop default. The current browser path still uses a simple CPU-generated radiance mip chain, not the desktop viewer's full prefiltering pipeline.

For apples-to-apples visual checks against the desktop viewer, keep these settings aligned first:

- Material document: use the exact same `.mtlx` values, starting with car paint, brushed metal, pearl, and coated fabric.
- Mesh: `resources/Geometry/shaderball.glb`.
- Environment: `resources/Lights/san_giuseppe_bridge_split.hdr`.
- Light rig: `resources/Lights/san_giuseppe_bridge_split.mtlx`.
- Environment method: filtered importance sampling, sample count `16`, intensity `1`.
- Direct lighting: enabled for the default comparison; use `directLight=0` only when intentionally measuring IBL-only behavior.
- Environment background: either disabled on both sides or enabled on both sides.
- Shadows: disabled for parity while shadow maps remain parked.

The direct WebGPU parity URL is:

```text
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&envSamples=16&envIntensity=1&directLight=1
```

The desktop viewer comparison should use the same material, mesh, environment, light rig, direct-light setting, and `--shadowMap false` until the browser path has shadow maps.

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

## Current Recommendation

Treat Naga-translated WebGPU as the primary direct viewer path. It is already showing meaningfully better MaterialX fidelity than the hand-authored bridge and, in early interactive testing, feels faster for simple material cases than the WebGL viewer. The bridge has served its purpose as a binding and camera/mesh scaffold, but building it up to match MaterialX feature parity would be prohibitive now that Naga is successfully compiling and rendering the generated shader output.

The intended product shape is:

- Prefer WebGPU + Naga-translated MaterialX output when `navigator.gpu` and the known shader pipeline compile successfully.
- Fall back to the existing WebGL MaterialX viewer on unsupported or failing systems.
- Keep the bridge path as a development diagnostic for resource contracts, not as a user-facing fidelity path.

The next hardening work should focus on Naga fixtures, textured material bindings, graceful capability routing, and parity checks against the desktop viewer and WebGL fallback.

## Shader Fixture Workflow

Use the shader dump command to create local generated-source fixtures:

```sh
npm run dump:shadergen
npm run dump:shadergen -- --sample=standard --generator=wgsl,essl
```

The default output lives in `vendor/.cache/materialx-shaders` and includes a `manifest.json` with declarations, bindings, uniform blocks, generator metadata, and per-stage source stats.

The Phase 2 proof draw now covers:

- Request adapter/device.
- Configure a canvas.
- Load and upload the MaterialX shaderball GLB, with a generated sphere fallback if model loading fails.
- Bind camera/model uniforms.
- Render with position, normal, and tangent attributes.
- Use the same camera FOV, near plane, far plane, and approximate fit distance as the lab.

The Phase 3 bridge replaced the original proof shader's single combined uniform block with the MaterialX-style resource bindings while keeping the Phase 2 browser WebGPU setup, mesh upload, camera, and metrics intact. It remains useful as a small diagnostic path, but Naga is now the primary path for fidelity and future product evaluation.

## Phase 3 Progress

The direct WebGPU proof now has a MaterialX-shaped binding harness:

- `binding=0`: vertex private uniform data for world, view-projection, and inverse-transpose matrices.
- `binding=1`: pixel private uniform data for environment matrix, environment settings, view position, and active-light count.
- `binding=2` and `binding=3`: HDR environment radiance texture and sampler, with a 1x1 fallback texture if loading fails.
- `binding=4` and `binding=5`: HDR environment irradiance texture and sampler, with a 1x1 fallback texture if loading fails.
- `binding=6`: public standard-surface material values in the order reported by the MaterialX generator.
- `binding=7`: generated-style light data block for the default directional light rig.

The proof draw now uses the vendored MaterialX `shaderball.glb` by default. The loader applies mesh transforms, normalizes the model into the direct renderer's view volume, and packs position, normal, tangent, and UV data into one mesh stream. The view uses Three.js `OrbitControls` so desktop and iPad gestures follow the same camera behavior as the original viewer, with a default fit that leaves more breathing room around the shaderball. Naga pipelines choose the attribute layout required by each generated vertex shader, so untextured samples keep the original position/normal/tangent contract while textured samples bind UVs at the generated `i_texcoord_0` location. A custom geometry URL can be supplied with `geom=...` for local experiments.

The direct pipeline includes a `depth24plus` depth attachment and uses single-sided rasterization with `frontFace: "ccw"` and `cullMode: "back"`. The shaderball GLB and generated sphere fallback now both use winding that matches their outward normals, which gives this spike an efficient WebGPU-style draw path while still catching future asset or transform mistakes.

The direct page now loads the filtered MaterialX `san_giuseppe_bridge_split.hdr` environment by default, plus the matching irradiance HDR from `resources/Lights/irradiance`. These are uploaded as `rgba16float` WebGPU textures and sampled through simple latitude-longitude helper functions in the bridge. The radiance texture is also uploaded with a CPU-generated mip chain, and the real mip count is written to generated `u_envRadianceMips` so Naga-translated `textureSampleLevel` environment lookups can follow the MaterialX LOD path. The sampling and mip generation are still approximations rather than MaterialX's full environment prefiltering implementation, but bindings 2-5 now carry real HDR data instead of constant placeholder colors.

The direct page can draw the radiance HDR as the scene background with the `Environment` checkbox or `drawEnvironment=1` URL parameter. This mirrors the desktop viewer's `--drawEnvironment` option and keeps the default off. The background pass uses a fullscreen WebGPU draw, camera-derived view rays with a 180 degree lat-long U offset, the same radiance texture, and the current environment intensity so the visible environment is rotated relative to the lighting lookup without flipping V.

The direct page now loads the MaterialX runtime and runs `WgslShaderGenerator` for each sample. Since this runtime still emits Vulkan-style GLSL rather than browser WGSL, the page does not feed the generated pixel source directly into WebGPU yet. It does use the generated shader object to extract `PublicUniforms_pixel` and upload the generated standard-surface values into the WebGPU uniform buffer. The initial hand-authored JS values remain as a fallback while shadergen is loading or if shadergen fails.

The generated vertex stage is now consumed through a narrow adapter. The direct page validates the expected MaterialX vertex contract from the generated Vulkan-style GLSL source, then rebuilds the browser WebGPU pipeline with an equivalent WGSL vertex entry point. This keeps the generated attribute, uniform, transform, and varying contract live without starting a general shader translator.

The public material uniform buffer now follows the generated `PublicUniforms_pixel` member order and std140-style alignment instead of the first bridge's padded `array<vec4, 39>` table. Bridge-compatible samples still validate the generated 39-port block before using shadergen values, while Naga samples can use a sample-specific public layout; the tiled texture samples currently use 55-56 public fields in a 400-byte block. The private pixel buffer now mirrors the generated `PrivateUniforms_pixel` layout as well: environment matrix, environment intensity and sampling integers, refraction sidedness, view position, and active-light count. Filename private ports remain represented by texture/sampler bindings, while light data uses the binding emitted for the active sample.

The generated fragment source is also probed before the bridge reports shadergen as active. The direct page checks the expected fragment-stage declarations, validates the generated `NG_standard_surface_surfaceshader_100` function parameter order, and validates the generated `main()` call argument order. This still does not render the generated fragment source directly, but it locks down the next hand-port or tiny-translator target against the live MaterialX output.

The browser WGSL fragment bridge mirrors the generated outer shape. It builds generated-style normal/tangent locals, calls a WGSL bridge function named `NG_standard_surface_surfaceshader_100`, and returns a generated-style `out1` color. This remains useful for contract debugging, but the compact hand-authored standard-surface approximation is no longer a practical route to full fidelity now that the Naga-translated generated shader is working.

The first generated helper slice has been ported into the WGSL bridge with MaterialX-compatible names: `mx_square`, `mx_pow5`, `mx_ior_to_f0`, and `mx_fresnel_schlick`. The fragment adapter validates that those helper names still exist in the live generated pixel source and reports helper coverage in the HUD. The remaining approximation-specific helpers are still named with an `mx_bridge_` prefix so it is clear which pieces are not direct generated-function ports yet.

The second helper slice ports the generated GGX helper names `mx_average_alpha`, `mx_ggx_NDF`, `mx_ggx_smith_G1`, and `mx_ggx_smith_G2`. The bridge now uses this GGX slice for its direct specular lobes, so the fragment approximation has begun moving real shading behavior under generated-compatible helper boundaries while still avoiding a broad GLSL-to-WGSL translator.

The direct diffuse response now uses a port of the generated `mx_oren_nayar_diffuse` helper. This brings the adapter coverage to the first diffuse helper while keeping indirect irradiance and the broader BSDF layering model intentionally approximate.

Generated pre-BSDF helpers `mx_luminance_color3` and `mx_roughness_anisotropy` are now ported as well. Opacity luminance and anisotropic roughness packing now flow through those helper boundaries before the bridge calls its direct diffuse and specular approximations.

The bridge also ports `mx_rotate_vector3` and uses it for specular and coat tangent rotation. This starts honoring the generated shader's tangent-rotation inputs for anisotropic specular and coating paths instead of leaving those ports inert.

The direct lab light now flows through generated-style `numActiveLightSources` and `sampleLightSource` helpers. Binding 7 uses the generated directional-light layout from the default light rig, and the bridge consumes the same direction, color, type, and intensity block that the Naga-translated fragment path expects.

MaterialX emits a known warning for the `standard_surface.thin_walled` boolean port because WGSL does not allow booleans in uniform/storage address spaces. The direct page filters that specific Emscripten `printErr` message and surfaces it as `Shader Notes: bool uniform mapped`; unknown MaterialX stderr output is still forwarded to the console.

This is not yet a direct translation of the generated `wgsl-complete.pixel.glsl` output. Instead, it is a browser-WGSL bridge that keeps the generated binding numbers, vertex-stage semantics, and public-uniform semantic order while using a compact hand-authored standard-surface approximation for the fragment stage. That gives the spike a real WebGPU resource contract to measure before investing in a broader shader translator.

The spike includes a deliberately tiny generated GLSL-to-WGSL translator layer. It extracts selected leaf/helper functions from the Vulkan-style MaterialX pixel source, lowers their signatures and simple bodies into browser WGSL, and compile-checks that translated helper module in the WebGPU device. This path is now best treated as a narrow fallback or diagnostic tool rather than a planned full shader translator.

Naga is now the preferred translation probe. `npm run spike:naga` regenerates the cached MaterialX shader fixtures, applies a small bool-uniform pre-pass for MaterialX aliases such as `#define thin_walled bool(thin_walled)`, applies a narrow derivative-free fallback for the generated subsurface radius path that otherwise trips Chrome's `fwidth` uniformity analysis, and invokes `naga-cli` on every generated vertex and pixel shader. With `naga-cli v29.0.3`, all current samples convert successfully to WGSL: the untextured vertex stages are about 207 lines and full pixel stages are about 5033 lines with the registered directional-light path; `woodTiled` and `brassTiled` add UV and image sampling code, producing about 214 vertex lines and roughly 5400 pixel lines.

`npm run verify:naga-wgsl` browser-verifies those Naga WGSL outputs with Chrome/WebGPU. With the current pre-passes, all generated vertex and pixel modules compile as browser WGSL shader modules, the generated bindings and entry points match the direct WebGPU harness, and all nine translated samples compile as render pipelines with generated-layout-derived bind groups. The shader dump registers the default direct-light rig before generation, so the Naga fixtures include a real directional-light `sampleLightSource` path instead of the zero-light stub. The direct WebGPU page defaults to those generated fixtures; `shader=bridge` remains available for the smaller diagnostic path. The Naga path draws the shaderball with the translated vertex and pixel modules while reusing the direct page's mesh buffers, MaterialX-shaped uniform buffers, HDR environment textures, generated-style light data, and material image textures. The runtime path applies display encoding to the translated fragment output before presentation, exposes `envSamples` / `envIntensity` / `directLight` controls so expensive FIS-heavy materials can be measured at lower sample counts or in IBL-only mode, and supplies a mipmapped radiance texture so rough and anisotropic environment lookups are no longer forced through mip 0. The subsurface-radius pre-pass and simple CPU mip generation remain deliberate spike compromises, not claims that the translated shader is visually equivalent to the desktop viewer.

The first texture-backed samples are `woodTiled` and `brassTiled`, based on the upstream Standard Surface tiled materials. They add non-environment image resources for color and roughness, plus generated UV tiling controls. The generated contract shifts vertex attributes to position/UV/normal/tangent, adds texture/sampler bindings 7-10, and moves `LightData_pixel` to binding 11. The direct viewer now derives the Naga bind group from the active sample, uploads sample-specific public uniforms into a larger shared public buffer, and loads material images as repeat-sampled `rgba8unorm` WebGPU textures so MaterialX's generated color-space conversion remains responsible for the color texture decode.

The direct page includes a material selector for the generated coverage sample values, and accepts the same state through the URL:

```text
http://127.0.0.1:8000/webgpu-direct.html?material=standard
http://127.0.0.1:8000/webgpu-direct.html?material=standard&shader=bridge
http://127.0.0.1:8000/webgpu-direct.html?material=brushedMetal&envSamples=4
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&envSamples=16
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&envSamples=16&directLight=1
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&envSamples=16&directLight=0
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint&drawEnvironment=1
http://127.0.0.1:8000/webgpu-direct.html?material=pearl
http://127.0.0.1:8000/webgpu-direct.html?material=brushedMetal
http://127.0.0.1:8000/webgpu-direct.html?material=carPaint
http://127.0.0.1:8000/webgpu-direct.html?material=smokedGlass
http://127.0.0.1:8000/webgpu-direct.html?material=emissivePlastic
http://127.0.0.1:8000/webgpu-direct.html?material=coatedFabric
http://127.0.0.1:8000/webgpu-direct.html?material=woodTiled
http://127.0.0.1:8000/webgpu-direct.html?material=brassTiled
http://127.0.0.1:8000/webgpu-direct.html?material=pearl&environment=vendor/MaterialX/resources/Lights/table_mountain_split.hdr
```

Next, harden the Naga path against real product needs: add more textured and graph-heavy MaterialX samples, improve capability routing, keep the generated shader fixtures repeatable, and compare Naga/WebGPU against the WebGL fallback and desktop viewer for visual parity and performance.

The direct page now exposes material-switch instrumentation:

- `Upload`: CPU-side time to pack the selected material values and enqueue the `PublicUniforms_pixel` buffer update.
- `Switch Frame`: time from material selection to the next submitted render pass.
- `Switch GPU`: time from material selection until the queue reports the submitted switch frame as complete.
- `Switch Avg` and `Switch p95`: rolling stats from manual switches or the built-in switch benchmark.

Use the `Run switches` control on `/webgpu-direct.html` to cycle through the configured generated sample set. This measures the cheap WebGPU uniform-update path before any generated shader translation work is added.
