import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const override = process.env.GYS_SDK_STORAGE_ADAPTER;
if (process.env.CI && override) throw new Error('CI must verify the installed SDK storage adapter');
const adapterPath = override ? resolve(override) : fileURLToPath(new URL(
  '../../node_modules/@breeztech/breez-sdk-spark/web/storage/index.js', import.meta.url));
const adapter = await readFile(adapterPath);
if (adapter.length > 512 * 1024) throw new Error('Unexpected storage adapter size');
const identity = JSON.stringify({
  source: override ? 'explicit-source-override' : 'installed-sdk',
  sha256: createHash('sha256').update(adapter).digest('hex'), bytes: adapter.length,
});

const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.writeHead(405).end();
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="en"><title>Disposable SDK storage verification</title><body>Local storage fixture</body></html>');
  } else if (request.url === '/adapter.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.end(adapter);
  } else if (request.url === '/identity.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(identity);
  } else {
    response.writeHead(404).end();
  }
});
server.listen(4186, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
