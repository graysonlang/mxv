# TODO

Working checklist for the MaterialX viewer experiment. The deeper rationale lives in
`docs/materialx-rendering-strategy.md`; the direct WebGPU spike notes live in
`docs/webgpu-materialx-shader-spike.md`.

## Current Focus

- [ ] Continue the direct WebGPU MaterialX shader spike.
  - Status: in progress.
  - Current shape: `/webgpu-direct.html` renders the MaterialX shaderball with a direct WebGPU pipeline, generated sample material values, generated vertex-stage contract validation, MaterialX-shaped public/private/light uniform bindings, HDR environment textures, and an optional Naga-translated generated WGSL pixel path.
  - Current recommendation: Naga-translated WebGPU is the primary direct viewer path; the hand-authored bridge remains a diagnostic scaffold, and WebGL remains the fallback for unsupported systems.

## Done

- [x] Split the MaterialX JavaScript/WASM runtime into the sibling `../mx` package and consume it from this repo as `@graysonlang/mx`.
- [x] Keep runtime packaging separate from viewer assets so the WASM package stays small and reusable.
- [x] Add filtered MaterialX viewer asset setup for geometry/resources used by this repo.
- [x] Add explicit viewer entry points for WebGL, WebGPU lab, direct WebGPU, and smoke testing.
- [x] Make the shell default to the direct WebGPU mode and support fragment-based mode switching.
- [x] Align WebGPU lab camera controls, initial framing, and clipping behavior with the WebGL viewer.
- [x] Add material switching for generated sample values.
- [x] Add generated coverage samples for metal/anisotropy, car paint/coat, transmission/opacity, emission, and sheen/coat.
- [x] Load the MaterialX shaderball GLB in the direct WebGPU proof draw.
- [x] Fix direct WebGPU mesh orientation and use single-sided rendering with back-face culling.
- [x] Capture the current MaterialX `WgslShaderGenerator` reality: it is available, but emits Vulkan-style GLSL rather than browser WGSL.
- [x] Add a generated vertex-stage adapter for the narrow MaterialX vertex contract.
- [x] Pack `PublicUniforms_pixel` in generated order with std140-style alignment.
- [x] Align `PrivateUniforms_pixel` with the generated MaterialX private uniform block.
- [x] Keep light data in binding 7 instead of adding it to private uniforms.
- [x] Add `npm run verify:webgpu` for Chrome-based direct WebGPU validation on port `8080`.
- [x] Add a generated fragment-source contract probe for the standard-surface function signature and generated `main()` call argument order.
- [x] Reshape the browser WGSL fragment bridge around a generated-style `NG_standard_surface_surfaceshader_100` call.
- [x] Port low-risk generated helper names into the WGSL bridge: `mx_square`, `mx_pow5`, `mx_ior_to_f0`, and `mx_fresnel_schlick`.
- [x] Validate ported fragment helpers against the live generated pixel source and report adapter coverage in the HUD/verifier.
- [x] Port the generated GGX helper slice and use it for the bridge's direct specular lobes.
- [x] Port `mx_oren_nayar_diffuse` and use it for the bridge's direct diffuse response.
- [x] Port generated pre-BSDF helpers for luminance and roughness/anisotropy packing.
- [x] Port `mx_rotate_vector3` and use it for specular and coat tangent rotation.
- [x] Route direct lab lighting through generated-style `numActiveLightSources` and `sampleLightSource` helpers.
- [x] Bind real MaterialX HDR radiance and irradiance environment maps in the direct WebGPU path, with 1x1 fallback textures.
- [x] Add an initial generated GLSL-to-WGSL translator scaffold for a compile-checked helper-function slice.
- [x] Add a repeatable Naga CLI spike; after a tiny bool-uniform pre-pass, Naga converts all seven generated vertex and pixel shaders to WGSL.
- [x] Add a browser compile verifier for Naga WGSL output; all generated vertex and pixel modules now pass strict Chrome/WebGPU shader-module compilation.
- [x] Add a narrow Naga pre-pass for the generated subsurface `fwidth` path, replacing curvature-derived radius with a derivative-free material radius fallback for the spike.
- [x] Extend the Naga verifier to compare generated bindings and entry points against the direct WebGPU harness and compile all seven samples as render pipelines.
- [x] Add a direct WebGPU `shader=naga` mode that draws the shaderball with the Naga-generated vertex and pixel WGSL fixtures.
- [x] Add sRGB display encoding and environment sample/intensity controls for the direct Naga path.
- [x] Generate and bind HDR radiance mip levels for the direct Naga path so generated `u_envRadianceMips` / `textureSampleLevel` environment lookups are meaningful.
- [x] Add the upstream Standard Surface car-paint sample as a visual parity check that exercises clear coat and anisotropy without emission clipping.
- [x] Capture the MaterialX desktop viewer environment-lighting defaults for the Phase 3 comparison: FIS by default, `envSampleCount` 16, and `envLightIntensity` 1.
- [x] Match the direct WebGPU environment sampler to the desktop viewer's lat-long policy: repeat in U, clamp in V, and linear mip filtering.
- [x] Add a direct WebGPU environment-background toggle with `drawEnvironment=1`, matching the desktop viewer default of off.
- [x] Register the default MaterialX direct-light rig during shader generation so Naga fixtures use a real directional-light `sampleLightSource` path instead of the zero-light stub.
- [x] Add a direct-light toggle with `directLight=1|0` for desktop-style direct+IBL versus IBL-only comparison.
- [x] Decide to prioritize Naga-translated WebGPU over growing the hand-authored bridge toward feature parity.

## In Progress

- [ ] Phase 3 direct WebGPU bridge.
  - Status: binding contract is active; generated fragment source is validated for the expected standard-surface shape; the browser WGSL fragment path now mirrors the generated outer `main()` to standard-surface call flow; a narrow custom translator compiles a first helper-function slice; Naga translates the full emitted shader fixtures offline; Chrome accepts the generated Naga vertex and pixel modules after the bool-uniform and subsurface-radius pre-passes; all seven translated samples compile as render pipelines with the direct WebGPU bind group layout; the direct viewer can now draw the shaderball through the Naga-generated WGSL path with display encoding, runtime environment sample controls, mipmapped HDR radiance lookups, and generated-style directional light data.
  - Next decision: harden `shader=naga` as the primary WebGPU shader path and keep `shader=bridge` only for contract diagnostics.

- [ ] Performance comparison against the WebGL viewer.
  - Status: direct page exposes first-frame, frame-time, FPS, material upload, switch-frame, switch-GPU, average, and p95 metrics.
  - Next work: record apples-to-apples measurements for WebGL and direct WebGPU on representative desktop hardware.

## Next Tasks

1. Make Naga the first-class direct viewer mode.
   - Default `/webgpu-direct.html` to `shader=naga` when fixtures are available.
   - Keep `shader=bridge` available as an explicit diagnostic fallback.
   - Surface a clear status if Naga fixtures are missing and fall back to WebGL or bridge only by explicit routing.

2. Add capability routing between WebGPU/Naga and WebGL.
   - Probe `navigator.gpu`, adapter/device creation, and known shader pipeline compilation.
   - Route supported systems to WebGPU/Naga.
   - Route unsupported or failing systems to the existing WebGL viewer.

3. Capture a small baseline matrix for the representative generated samples in the WebGL viewer and `/webgpu-direct.html`.
   - Include first visible frame, steady FPS, frame-time average/p95, material switch CPU time, and material switch GPU completion time.

4. Continue visual/performance evaluation of the Naga path.
   - Use car paint, brushed metal, pearl, and coated fabric as the main visual checks; keep emissive plastic as emission coverage, not a parity reference.
   - Compare Naga against the desktop viewer with the same material, shaderball mesh, `san_giuseppe_bridge_split` environment/light rig, `envSamples=16`, `envIntensity=1`, `directLight=1`, matched environment-background visibility, and shadows disabled.
   - Re-run the same views with `directLight=0` to isolate image-based lighting from direct-light contribution.
   - Measure steady FPS for complex materials at `envSamples=4`, `8`, and `16`.
   - If it holds, keep the build-time Naga wrapper path first and consider a WASM wrapper later.

5. Add a textured MaterialX sample.
   - Goal: prove non-environment texture and sampler bindings before investing further in shader translation.

6. Improve environment parity when visual comparison becomes important.
   - Continue from the loaded HDR radiance/irradiance textures and generated radiance mips toward viewer-equivalent environment prefiltering and intensity.
   - Keep this behind the performance/fidelity evaluation so it does not block shader-contract learning.

7. Expand verification once the Naga path grows.
   - Add assertions for private uniform contract text, shader notes, WebGPU validation errors, and optionally a simple screenshot pixel sanity check.

## Parking Lot

- [ ] Re-run generator diagnostics after any MaterialX runtime upgrade.
- [ ] Decide whether WebGPU belongs in the main R3F product canvas or a separate pop-out material editor.
- [ ] Investigate Three.js WebGPU/TSL integration only if direct WebGPU proves useful but too isolated.
- [ ] Explore GPU-side baking or precomputation after the basic renderer path has measured value.
- [ ] Add MaterialX-aligned dynamic direct lighting and shadow maps after Naga visual/performance value is clearer.
- [ ] Evaluate displacement/geometry expressivity separately; WebGPU does not automatically provide tessellation or geometry shader stages.
- [ ] Finalize `@graysonlang/mx` package API and publishing/versioning once the runtime shape settles.
