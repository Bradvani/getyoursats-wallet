import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('./rollback',import.meta.url)),
 base:'./',publicDir:false,
 build:{outDir:fileURLToPath(new URL('./dist-rollback',import.meta.url)),emptyOutDir:true,sourcemap:false,target:'es2022'},
});
