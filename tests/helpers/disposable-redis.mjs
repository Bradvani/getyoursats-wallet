import {execFile,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const redisServer=process.env.GYS_REDIS_SERVER||'redis-server';
const redisCli=process.env.GYS_REDIS_CLI||'redis-cli';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function startRedis(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gys-push-'));
  const socket = join(directory, 'redis.sock');
  const child = spawn(redisServer, ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700',
    '--save', '', '--appendonly', 'no', '--dir', directory], {stdio: ['ignore', 'pipe', 'pipe']});
  let startupError;
  let log = '';
  child.on('error', error => { startupError = error; });
  child.stdout.on('data', chunk => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
  const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      let deadline;
      await Promise.race([closed, new Promise(resolve => { deadline = setTimeout(resolve, 2000); })]);
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
    await rm(directory, {recursive: true, force: true});
  });
  const command = async (...args) => {
    const {stdout} = await execute(redisCli, ['-s', socket, '--json', ...args.map(String)], {timeout: 5000, maxBuffer: 2 * 1024 * 1024});
    const result = stdout.trim();
    if (result.startsWith('error:')) throw new Error(result);
    return JSON.parse(result);
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (startupError) throw new Error(`Disposable Redis could not start: ${startupError.message}`);
    try { if (await command('PING') === 'PONG') return command; } catch { /* Wait for the private socket. */ }
    if (child.exitCode !== null) throw new Error(`Disposable Redis stopped: ${log}`);
    await pause(25);
  }
  throw new Error(`Disposable Redis did not become ready: ${log}`);
}
