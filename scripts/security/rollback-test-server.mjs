import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve('dist-rollback');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5185','--strictPort'],{stdio:'ignore',env:{...process.env,VITE_STAGING_PASSWORD:''}});
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url??'/', 'http://127.0.0.1').pathname;
 if(pathname==='/rollback-control-worker.js'){
  // Test-only worker: exercises a real late takeover without touching wallet storage.
  res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store','Service-Worker-Allowed':'/'});
  res.end("self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");
  return;
 }
 if(pathname.startsWith('/recovery-rollback/')){
  try{
   const relative=decodeURIComponent(pathname.slice('/recovery-rollback/'.length))||'index.html';
   const filename=path.resolve(root,relative);
   if(!filename.startsWith(root+path.sep)||!(await stat(filename)).isFile()){res.writeHead(404);res.end();return;}
   const type=filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'application/json';
   res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(await readFile(filename));
  }catch{res.writeHead(404);res.end();}
  return;
 }
 const proxy=http.request({hostname:'127.0.0.1',port:5185,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:5185'}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
 proxy.on('error',()=>{res.writeHead(503);res.end('Test fixture starting');});req.pipe(proxy);
});
server.listen(5184,'127.0.0.1');
for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>{server.close();vite.kill();process.exit(0);});
