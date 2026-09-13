'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../netlify/functions/_lib/handlers/counseling-refresh').handler;
const event=(value={refresh_token:'synthetic-refresh'})=>({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
function setup(t){const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_KEY,fetch:global.fetch};process.env.SUPABASE_URL='https://school.example.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-server-key';t.after(()=>{for(const [key,value]of [['SUPABASE_URL',previous.url],['SUPABASE_SERVICE_KEY',previous.key]])if(value===undefined)delete process.env[key];else process.env[key]=value;global.fetch=previous.fetch;});}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('refresh validates input and keeps credentials in POST bodies',async t=>{
 setup(t);const calls=[];global.fetch=async(url,options)=>{calls.push({url,options});return response({access_token:'synthetic-access',refresh_token:'synthetic-rotated',expires_in:3600,user:{id:'private'},provider_token:'private-provider'});};
 const result=await handler(event());assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');
 assert.deepEqual(JSON.parse(result.body),{access_token:'synthetic-access',refresh_token:'synthetic-rotated',expires_in:3600});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://school.example.invalid/auth/v1/token?grant_type=refresh_token');
 assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{refresh_token:'synthetic-refresh'});
 assert.equal(calls[0].options.headers.apikey,'synthetic-server-key');assert.equal(result.body.includes('private'),false);
 for(const [input,status]of [[{},400],[{refresh_token:1},400],[{refresh_token:' '},400],[{refresh_token:'a'.repeat(8193)},400],[{refresh_token:'synthetic',role:'teacher'},400]])assert.equal((await handler(event(input))).statusCode,status);
 assert.equal((await handler({...event(),httpMethod:'GET'})).statusCode,405);
 assert.equal((await handler({...event(),body:'x'.repeat(16385)})).statusCode,413);assert.equal(calls.length,1);
});

test('invalid refresh is distinct from temporary auth service failures',async t=>{
 setup(t);
 for(const status of [400,401,403,429,500,503]){
  global.fetch=async()=>response({message:'sensitive upstream detail'},status);
  const result=await handler(event());assert.equal(result.statusCode,[400,401].includes(status)?401:503);assert.equal(result.body.includes('sensitive'),false);assert.equal(result.headers['Cache-Control'],'no-store');
 }
 global.fetch=async()=>{throw new Error('sensitive network detail')};assert.equal((await handler(event())).statusCode,503);
 for(const payload of [null,{}, {access_token:'synthetic',refresh_token:'synthetic',expires_in:0},{access_token:'synthetic',refresh_token:'synthetic',expires_in:'3600'}]){
  global.fetch=async()=>response(payload);assert.equal((await handler(event())).statusCode,503);
 }
});
