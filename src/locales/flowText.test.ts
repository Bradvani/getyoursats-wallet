import {describe,expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {flowText,hasFlowText} from './flowText';
import {APP_LANGUAGES} from '../services/presentationPreferences';

describe('payment language coverage',()=>{
 it('applies reviewed English labels and safe retry wording',()=>{
  expect(flowText('en','Payment Sent!')).toBe('Payment sent');
  expect(flowText('en','Authenticated!')).toBe('Signed in');
  expect(flowText('en','There was an error processing your payment. Please try again.'))
   .toBe('The payment could not be completed. Check payment history before trying again.');
 });
 it('covers every static useFlowText message without an English fallback',()=>{
  const missing:string[]=[];
  const visitFiles=(directory:string)=>{
   for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()){visitFiles(path);continue;}
    if(!/\.tsx?$/.test(path)||/\.test\./.test(path))continue;
    const source=readFileSync(path,'utf8');
    if(!source.includes('useFlowText'))continue;
    const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const walk=(node:ts.Node)=>{
     if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
      const key=node.arguments[0].text;
      if(!hasFlowText(key))missing.push(`${path}: ${key}`);
      for(const {code} of APP_LANGUAGES){
       if(code!=='en'&&flowText(code,key)===key&&!['BTC','USD','Lightning','Spark','USDT','USDC','URL','LNURL'].includes(key))missing.push(`${path} [${code}]: ${key}`);
      }
     }
     ts.forEachChild(node,walk);
    };walk(tree);
   }
  };visitFiles('src');
  expect([...new Set(missing)]).toEqual([]);
 });
 it('leaves unknown text and protocol destinations unchanged',()=>{
  for(const key of ['constructor','toString','spark1USER_001','user@example.com','Custom user description']){
   expect(flowText('ar',key)).toBe(key);
   expect(hasFlowText(key)).toBe(false);
  }
  expect(flowText('es','Pay to {recipient}',{recipient:'Send {amount}'})).toBe('Pagar a Send {amount}');
 });
});
