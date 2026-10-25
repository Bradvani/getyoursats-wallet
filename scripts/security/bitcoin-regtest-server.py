#!/usr/bin/env python3
"""Local-only disposable Bitcoin Core regtest. No public network or user wallet.
The Esplora-shaped adapter injects a lost acknowledgement AFTER Core accepts the
transaction; all chain/mempool results otherwise come from the actual local node.
"""
import json,os,subprocess,time,threading
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path

cli=os.environ['BITCOIN_CLI'];datadir=os.environ['BITCOIN_REGTEST_DATADIR']
def rpc(method,*args,wallet=None):
 command=[cli,'-regtest','-datadir='+datadir]
 if wallet:command+=['-rpcwallet='+wallet]
 command+=[method]+[json.dumps(v,separators=(',',':')) if not isinstance(v,str) else v for v in args]
 result=subprocess.run(command,text=True,capture_output=True)
 if result.returncode:raise RuntimeError(result.stderr.strip())
 try:return json.loads(result.stdout)
 except json.JSONDecodeError:return result.stdout.strip()
for _ in range(100):
 try:
  if rpc('getblockchaininfo')['chain']!='regtest':raise SystemExit('Refusing a non-regtest chain')
  break
 except RuntimeError:time.sleep(.1)
else:raise SystemExit('Local Bitcoin Core is unavailable')
rpc('createwallet','gys-miner');rpc('createwallet','gys-recipient')
mining=rpc('getnewaddress',wallet='gys-miner')
rpc('generatetoaddress',101,mining)
coin=rpc('listunspent',1,9999999,wallet='gys-miner')[0]
destination=rpc('getnewaddress',wallet='gys-recipient');value=round(coin['amount']*100_000_000);fee=1000
unsigned=rpc('createrawtransaction',[{'txid':coin['txid'],'vout':coin['vout']}],{destination:round((value-fee)/100_000_000,8)})
signed=rpc('signrawtransactionwithwallet',unsigned,wallet='gys-miner')
if not signed.get('complete'):raise SystemExit('Disposable transaction signing failed')
decoded=rpc('decoderawtransaction',signed['hex'])
fixture={'txid':coin['txid'],'vout':coin['vout'],'destination':destination,'amountSats':value,'feeSats':fee,'txId':decoded['txid'],'txHex':signed['hex']}
state={'posts':[],'lostAck':False,'lastBlock':None,'staleStatus':None,'fault':'none'}
mutex=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,code,value):
  if isinstance(value,(dict,list,bool)):body=json.dumps(value).encode();content='application/json'
  else:body=str(value).encode();content='text/plain'
  self.send_response(code);self.send_header('content-type',content);self.send_header('access-control-allow-origin','*');self.send_header('cache-control','no-store');self.end_headers();self.wfile.write(body)
 def do_OPTIONS(self):
  self.send_response(204);self.send_header('access-control-allow-origin','*');self.send_header('access-control-allow-methods','GET,POST,OPTIONS');self.send_header('access-control-allow-headers','content-type');self.end_headers()
 def do_GET(self):
  try:
   if self.path=='/test/fixture':return self.send(200,fixture)
   if self.path=='/test/state':return self.send(200,{'posts':state['posts'],'mempool':rpc('getrawmempool'),'chain':'regtest'})
   if self.path=='/blocks/tip/height':return self.send(200,rpc('getblockcount'))
   if self.path.startswith('/block-height/'):return self.send(200,rpc('getblockhash',int(self.path.rsplit('/',1)[1])))
   if self.path==f"/tx/{fixture['txId']}/hex":
    if state['fault']=='wrong-bytes':return self.send(200,'0100')
    return self.send(200,rpc('getrawtransaction',fixture['txId']))
   if self.path==f"/tx/{fixture['txId']}/status":
    if state['fault']=='unavailable':return self.send(503,'unavailable')
    if state['fault']=='stale' and state['staleStatus']:return self.send(200,state['staleStatus'])
    tx=rpc('getrawtransaction',fixture['txId'],True)
    if tx.get('confirmations',0)>0:
     block=rpc('getblockheader',tx['blockhash']);status={'confirmed':True,'block_height':block['height'],'block_hash':tx['blockhash']}
     state['staleStatus']=status;return self.send(200,status)
    return self.send(200,{'confirmed':False})
   return self.send(404,'not found')
  except RuntimeError:return self.send(404,'not found')
 def do_POST(self):
  body=self.rfile.read(int(self.headers.get('content-length','0'))).decode()
  try:
   if self.path=='/test/mine':
    state['fault']='none';blocks=rpc('generatetoaddress',1,mining);state['lastBlock']=blocks[-1];return self.send(200,{'block':blocks[-1]})
   if self.path=='/test/reorg':
    if not state['lastBlock']:return self.send(400,'No test block to invalidate')
    rpc('invalidateblock',state['lastBlock']);state['fault']='stale';return self.send(200,True)
   if self.path=='/test/fault':
    fault=json.loads(body)['fault']
    if fault not in ['none','wrong-bytes','unavailable','stale']:return self.send(400,'Unknown test fault')
    state['fault']=fault;return self.send(200,True)
   if self.path=='/tx':
    if body!=fixture['txHex']:return self.send(400,'Only the exact disposable fixture transaction is allowed')
    with mutex:
     state['posts'].append(rpc('decoderawtransaction',body)['txid'])
     try:txid=rpc('sendrawtransaction',body)
     except RuntimeError as e:
      if fixture['txId'] in rpc('getrawmempool'):txid=fixture['txId']
      else:raise e
     if not state['lostAck']:
      state['lostAck']=True;return self.send(503,'Injected response loss after Bitcoin Core accepted the transaction')
     return self.send(200,txid)
   return self.send(404,'not found')
  except Exception:return self.send(500,'Regtest operation failed; no new transaction was created')
print('DISPOSABLE_BITCOIN_REGTEST_READY',flush=True)
ThreadingHTTPServer(('127.0.0.1',3002),Handler).serve_forever()
