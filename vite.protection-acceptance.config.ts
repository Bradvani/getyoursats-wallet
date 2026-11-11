import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
export default defineConfig({
 root:resolve(process.cwd(),'acceptance/protection'),publicDir:false,
 resolve:{alias:{'@':resolve(process.cwd(),'src')}},
 define:{__PROTECTION_REVISION__:JSON.stringify(execFileSync('git',['rev-parse','--short=12','HEAD'],{encoding:'utf8'}).trim())},
 plugins:[react(),nodePolyfills(),{name:'test-only-manifest',generateBundle(){
  this.emitFile({type:'asset',fileName:'manifest.webmanifest',source:JSON.stringify({name:'GetYourSats Protection Test',short_name:'GYS Test',start_url:'./',scope:'./',display:'standalone',background_color:'#111111',theme_color:'#111111'})});
 }}],
 build:{outDir:resolve(process.cwd(),'dist-protection-acceptance'),emptyOutDir:true},
});
