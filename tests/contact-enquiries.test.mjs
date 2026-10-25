import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../site/api/contact.js';

function mockResponse(){
 return {
   statusCode:200, payload:null,
   setHeader(){return this},
   status(code){this.statusCode=code;return this},
   json(value){this.payload=value;return this}
 };
}
function request(topic){
 return {
  method:'POST',
  headers:{origin:'https://getyoursats.com','content-type':'application/json'},
  body:{
   name:'Public form QA',email:'quality@example.net',topic,
   message:'Checking the public enquiry category routing without sending a real email.',
   consent:true,website:''
  }
 };
}
test('contact endpoint accepts action-oriented public topics and rejects unknown categories',async()=>{
 const previous=process.env.GETYOURSATS_SUPPORT_FROM;
 // A missing required sender guarantees no real email is sent in this test.
 delete process.env.GETYOURSATS_SUPPORT_FROM;
 try{
   for(const topic of ['support','feedback','partnership','media','privacy','general']){
     const res=mockResponse();
     await handler(request(topic),res);
     assert.equal(res.statusCode,503,topic+' should pass validation before delivery checks');
   }
   const unknown=mockResponse();
   await handler(request('recover-my-keys'),unknown);
   assert.equal(unknown.statusCode,400);
   assert.equal(unknown.payload.error,'Choose an enquiry type');
   // Backwards compatibility for users with a previously cached form.
   const cached=mockResponse();
   await handler(request('recovery'),cached);
   assert.equal(cached.statusCode,503);
 }finally{
   if(previous===undefined)delete process.env.GETYOURSATS_SUPPORT_FROM;
   else process.env.GETYOURSATS_SUPPORT_FROM=previous;
 }
});
