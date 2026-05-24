// Copy static app assets into dist/ alongside the bundle.
import { paths as imagePaths } from 'virtual:glob' with { pattern: 'assets/**/*.{png,jpg}', baseDir: '..' };

// Copy the generated Emscripten loader, WASM, and preload data files.
import { paths as materialXPathPaths } from 'virtual:glob' with { pattern: 'vendor/materialx-runtime/*.{js,wasm,data}', baseDir: '..' };

// Copy the upstream MaterialX example resources used by the viewer.
import { paths as materialXResourcePaths } from 'virtual:glob' with { pattern: 'vendor/MaterialX/resources/**/*.{mtlx,glb,hdr,jpg,jpeg,png,exr,tga,bmp,gif}', baseDir: '..' };

// Copy viewer UI assets expected by the upstream property editor.
import 'virtual:copy' with { path: '../vendor/MaterialX/javascript/MaterialXView/public/shader_ball.svg', dest: 'public' };
import 'virtual:copy' with { path: '../vendor/MaterialX/javascript/MaterialXView/public/shader_ball2.svg', dest: 'public' };

export { imagePaths, materialXPathPaths, materialXResourcePaths };
