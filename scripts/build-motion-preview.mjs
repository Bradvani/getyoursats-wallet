// Separate public preview. Deliberately no wallet entry or VITE_ environment injection.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
await build({configFile:false,envPrefix:'MOTION_STUDIO_NO_ENV_',plugins:[react(),wasm(),nodePolyfills()],
 resolve:{alias:{'@':resolve('src')}},define:{__APP_VERSION__:JSON.stringify('motion-preview')},
 build:{outDir:'motion-preview-dist',rollupOptions:{input:'e2e/fixtures/transfer-pulse.html'}}});
await copyFile('motion-preview-dist/e2e/fixtures/transfer-pulse.html','motion-preview-dist/index.html');
await mkdir('motion-preview-dist/evidence',{recursive:true});
