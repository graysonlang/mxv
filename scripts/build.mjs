import pluginImp from '@graysonlang/esp/esbuild-plugin-imp';
import { runBuild } from '@graysonlang/esp/esbuild-runner';
import { prepareStaticAssets } from './prepare-static-assets.mjs';

function getOptions(args, verbose, logger) {
  const options = {
    assetNames: '[name]',
    bundle: true,
    entryPoints: {
      'index': 'src/index.js',
      'main': 'app/main.js',
      'smoke': 'app/smoke.js',
      'webgpu-direct': 'app/webgpu-direct.js',
      'webgpu': 'app/webgpu.js',
    },
    format: 'esm',
    loader: {
      '.html': 'file',
    },
    outdir: 'dist',
    plugins: [
      pluginImp({ logger, verbose }),
    ],
    target: ['esnext'],
    ...args,
  };

  // The viewer streams many copied assets. ESP's live-reload EventSource can
  // reload the page when those asset requests provoke server-side change events,
  // so keep watch rebuilds but require manual browser refreshes for now.
  delete options.banner;

  return options;
}

await prepareStaticAssets();
runBuild(getOptions);
