/** Read-only inventory. This records call sites, not proof of runtime security. */
import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
import child from 'node:child_process';
const methods=new Set(['sendPayment','lnurlPay','lnurlWithdraw','lnurlAuth','refundDeposit','claimDeposit','updateUserSettings','buyBitcoin','signMessage','broadcast','broadcastTransaction','broadcastPackage','broadcastTx','sendTransaction','setPin','clearPin','storeSeed','retrieveSeed','clearSeed','saveMnemonic','getSavedMnemonic','clearMnemonic','wipeAllLocalData','connectWallet','reconnectWithDerivedWallet','migrateLegacyMnemonicIfNeeded']);
const files=child.execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>/\.tsx?$/.test(f)&&!/(\.test\.|\.spec\.|__tests__)/.test(f));
const rows=[];
for(const file of files){const text=fs.readFileSync(file,'utf8');const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const hash=crypto.createHash('sha256').update(text).digest('hex');
 const visit=node=>{if(ts.isCallExpression(node)){
  const expr=node.expression;const name=ts.isPropertyAccessExpression(expr)?expr.name.text:ts.isIdentifier(expr)?expr.text:null;
  if(name&&methods.has(name)){const pos=source.getLineAndCharacterOfPosition(node.getStart(source));rows.push({file,line:pos.line+1,method:name,expression:expr.getText(source),sourceSha256:hash});}
 }ts.forEachChild(node,visit);};visit(source);
}
const result={baseline:'2c848e8666a415f216fb6a813b107a228345d156',scope:'Application TypeScript call sites. Dynamic dispatch, compiled SDK internals, native plugins and hardware behavior require additional validation.',callSites:rows};
fs.writeFileSync('docs/review/security-call-sites.json',JSON.stringify(result,null,2)+'\n');console.log(`${rows.length} explicit application call sites inventoried`);
