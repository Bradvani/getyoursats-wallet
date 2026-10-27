// Reuse the lockfile-pinned fonts already used by the wallet. No runtime CDN.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fonts={ja:['noto-sans-jp','Noto Sans JP','400.css'],th:['noto-sans-thai','Noto Sans Thai','400.css'],ta:['noto-sans-tamil','Noto Sans Tamil','400.css'],ar:['noto-sans-arabic','Noto Sans Arabic','400.css'],'zh-CN':['noto-sans-sc','Noto Sans SC','400.css'],hi:['noto-sans-devanagari','Noto Sans Devanagari','400.css'],vi:['plus-jakarta-sans','Plus Jakarta Sans','vietnamese-400.css']};
for(const base of ['public','site']){
 const output=path.join(root,base,'locale-fonts');await mkdir(output,{recursive:true});
 for(const [locale,[pkg,family,entry]] of Object.entries(fonts)){
  const source=path.join(root,'node_modules','@fontsource',pkg);
  let css=await readFile(path.join(source,entry),'utf8');
  // Modern supported browsers use WOFF2; do not copy redundant WOFF assets.
  css=css.replace(/, url\([^)]*\.woff\) format\('woff'\)/g,'');
  const files=[...new Set([...css.matchAll(/url\(\.\/files\/([^)]*)\)/g)].map(match=>match[1]))];
  await Promise.all(files.map(file=>copyFile(path.join(source,'files',file),path.join(output,file))));
  css=css.replaceAll('./files/','/locale-fonts/');
  css+=`\nhtml[lang="${locale}"] body{font-family:"${family}",system-ui,sans-serif}\n`;
  await writeFile(path.join(output,locale+'.css'),css);
  await copyFile(path.join(source,'LICENSE'),path.join(output,pkg+'-LICENSE.txt'));
 }
}
