/**
 * Recreate the approved light-monogram favicon from the unchanged SVG master.
 * Run from the repository root after npm ci:
 *     node site/scripts/build-favicons.mjs
 * Requires the existing Sharp dev dependency; no network calls.
 */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const svg=await readFile(path.join(root,'assets/favicon-light.svg'));
const sizes=[16,32,48,64,180];
const files=new Map();
await mkdir(path.join(root,'assets'),{recursive:true});
for(const n of sizes){
 const png=await sharp(svg,{density:320}).resize(n,n).png().toBuffer();
 files.set(n,png);
 await writeFile(path.join(root,'assets',`favicon-${n}.png`),png);
}
// ICO embeds actual PNG frames, preserving alpha at the tab's native size.
const icoSizes=[16,32,48,64];
const header=Buffer.alloc(6+icoSizes.length*16);
header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);
header.writeUInt16LE(icoSizes.length,4);
let offset=header.length;
for(const [i,size] of icoSizes.entries()){
 const bytes=files.get(size);
 const at=6+i*16;
 header.writeUInt8(size===256?0:size,at);
 header.writeUInt8(size===256?0:size,at+1);
 header.writeUInt8(0,at+2);header.writeUInt8(0,at+3);
 header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
 header.writeUInt32LE(bytes.length,at+8);
 header.writeUInt32LE(offset,at+12);
 offset+=bytes.length;
}
await writeFile(path.join(root,'favicon.ico'),Buffer.concat([header,...icoSizes.map(n=>files.get(n))]));
process.stdout.write('Generated GetYourSats favicon set from approved light monogram.\\n');
