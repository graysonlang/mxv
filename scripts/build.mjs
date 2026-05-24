import pluginGlobCopy from '@graysonlang/esp/esbuild-plugin-glob-copy';
import pluginImp from '@graysonlang/esp/esbuild-plugin-imp';
import { runBuild } from '@graysonlang/esp/esbuild-runner';

function isLiveReloadBuild() {
  return process.argv.includes('--serve') || process.argv.includes('--watch');
}

function getOptions(args, verbose, logger) {
  const options = {
    assetNames: '[name]',
    bundle: true,
    entryPoints: {
      index: 'src/index.js',
      main: 'app/main.js',
      smoke: 'app/smoke.js',
    },
    format: 'esm',
    loader: {
      '.html': 'file',
    },
    outdir: 'dist',
    plugins: [
      pluginGlobCopy({ logger }),
      pluginImp({ logger, verbose }),
    ],
    target: ['esnext'],
    ...args,
  };

  if (!isLiveReloadBuild()) {
    delete options.banner;
  }

  return options;
}

runBuild(getOptions);
