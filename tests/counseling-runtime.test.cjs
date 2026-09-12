'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {getStore,setEnvironmentContext}=require('../netlify/functions/_lib/vendor/netlify-blobs.cjs');
const S=require('../netlify/functions/_lib/counseling-storage');
const {getCounselingAiConfig}=require('../netlify/functions/_lib/counseling-ai-config');
const originalFetch=global.fetch;
const runtime={siteID:'synthetic-site',token:'synthetic-only',edgeURL:'https://cache.synthetic.invalid',uncachedEdgeURL:'https://origin.synthetic.invalid'};
test('vendored SDK matches provenance hash and loads without any npm dependencies',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
 const directory=path.join(__dirname,'../netlify/functions/_lib/vendor');
 const source=fs.readFileSync(path.join(directory,'netlify-blobs.cjs'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'netlify-blobs.manifest.json'),'utf8'));
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),manifest.sha256);
 assert.equal(manifest.sdk.version,'11.0.3');assert.deepEqual(manifest.external_builtins,['process']);
 const module={exports:{}},loaded=[];
 vm.runInNewContext(source,{module,exports:module.exports,process:{env:{NODE_ENV:'test'}},Buffer,URL,fetch:()=>{throw Error('unexpected network');},require:name=>{loaded.push(name);assert.equal(name,'process');return {env:{NODE_ENV:'test'}};}});
 assert.equal(typeof module.exports.getStore,'function');assert.ok(loaded.every(name=>name==='process'));
 assert.ok(!source.includes('OneDrive'));assert.ok(!source.includes('synthetic-service-key'));
});
test.beforeEach(()=>{
 process.env.COUNSELING_STORAGE='blobs';process.env.SUPABASE_URL='https://school.synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';
 for(const key of ['GEMINI_API_KEY','VERTEX_PROJECT','VERTEX_SA_KEY','LLM_MODEL','COUNSELING_SERVER_AI_ENABLED'])delete process.env[key];
 setEnvironmentContext(runtime);
});
test.afterEach(()=>{global.fetch=originalFetch;delete process.env.NETLIFY_BLOBS_CONTEXT;});

test('actual pinned SDK sends strong reads and conditional writes to platform origin',async()=>{
 const requests=[];
 const store=getStore({name:S.STORE_NAME,consistency:'strong',fetch:S.strictFetch(async(url,options)=>{
  requests.push({url:String(url),options});
  return new Response(options.method==='put'?'':JSON.stringify({schema_version:1}),{status:200,headers:{etag:'"v1"'}});
 })});
 const read=await store.getWithMetadata('configuration/v1',{type:'json',consistency:'strong'});
 assert.equal(read.etag,'"v1"');assert.equal(read.data.schema_version,1);
 const create=await store.set('configuration/v1','{}',{onlyIfNew:true});assert.equal(create.modified,true);
 await store.set('configuration/v1','{}',{onlyIfMatch:'"v1"'});
 assert.ok(requests.every(r=>new URL(r.url).origin===runtime.uncachedEdgeURL));
 assert.equal(new Headers(requests[1].options.headers).get('if-none-match'),'*');
 assert.equal(new Headers(requests[2].options.headers).get('if-match'),'"v1"');
});
test('actual SDK cannot turn repeated conditional-write 503 into modified true',async()=>{
 let calls=0;const store=getStore({name:S.STORE_NAME,consistency:'strong',fetch:S.strictFetch(async()=>{calls++;return new Response('',{status:503});})});
 await assert.rejects(store.set('configuration/v1','{}',{onlyIfNew:true}),e=>e.code==='STORAGE_UNAVAILABLE');
 assert.ok(calls>=1&&calls<=6);
});
test('actual SDK maps conditional 412 to conflict instead of successful mutation',async()=>{
 const store=getStore({name:S.STORE_NAME,consistency:'strong',fetch:S.strictFetch(async()=>new Response('',{status:412}))});
 assert.deepEqual(await store.set('configuration/v1','{}',{onlyIfMatch:'"stale"'}),{modified:false});
});
test('native health entry preserves automatic strong context and exposes no profile data',async()=>{
 const requests=[];global.fetch=async(url,options)=>{
  requests.push({url:String(url),method:options.method});
  if(new URL(url).origin===runtime.uncachedEdgeURL)return new Response('',{status:404});
  assert.equal(new URL(url).origin,'https://school.synthetic.invalid');return Response.json([]);
 };
 const entry=(await import('../netlify/functions/counseling-health.mjs')).default;
 const response=await entry(new Request('https://site.synthetic.invalid/.netlify/functions/counseling-health'));
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.version,'0.4.1');assert.equal(value.storage_ready,true);assert.equal(value.school_auth_ready,true);assert.equal(value.server_ai_configured,false);
 assert.equal(requests.length,2);assert.ok(requests.every(r=>!r.method||r.method.toUpperCase()==='GET'));
 assert.ok(!JSON.stringify(value).includes('synthetic'));assert.equal(response.headers.get('cache-control'),'no-store');
});
test('native entry rejects missing bearer before storage and does not trust supplied blobs headers',async()=>{
 delete process.env.NETLIFY_BLOBS_CONTEXT;global.fetch=async()=>{throw Error('unexpected network');};
 const entry=(await import('../netlify/functions/counseling-session.mjs')).default;
 const response=await entry(new Request('https://site.synthetic.invalid/.netlify/functions/counseling-session',{headers:{'x-netlify-blobs-context':Buffer.from(JSON.stringify(runtime)).toString('base64')}}));
 assert.equal(response.status,401);assert.equal((await response.json()).error.code,'AUTH_REQUIRED');
});
test('missing uncached platform origin fails readiness instead of degrading consistency',async()=>{
 setEnvironmentContext({...runtime,uncachedEdgeURL:undefined});global.fetch=async url=>{assert.equal(new URL(url).origin,'https://school.synthetic.invalid');return Response.json([]);};
 const entry=(await import('../netlify/functions/counseling-health.mjs')).default;
 const response=await entry(new Request('https://site.synthetic.invalid/.netlify/functions/counseling-health'));
 assert.equal(response.status,503);const result=await response.json();assert.equal(result.storage_ready,false);assert.equal(result.storage_diagnostic,'STRONG_CONTEXT_MISSING');
});
test('public readiness classifies missing automatic context without leaking SDK errors',async()=>{
 delete process.env.NETLIFY_BLOBS_CONTEXT;global.fetch=async()=>Response.json([]);
 const entry=(await import('../netlify/functions/counseling-health.mjs')).default;
 const response=await entry(new Request('https://site.synthetic.invalid/.netlify/functions/counseling-health'));
 assert.equal(response.status,503);const result=await response.json();assert.equal(result.storage_diagnostic,'PLATFORM_CONTEXT_MISSING');assert.ok(!JSON.stringify(result).includes('synthetic'));
});
test('diagnostic categories never reflect arbitrary error text, URL or secret fields',async()=>{
 for(const error of [new Error('secret token https://private.invalid'),{name:'secret',code:'secret',storageDiagnostic:'secret'},new TypeError('secret')])assert.equal(S.diagnostic(error),'STORAGE_UNCLASSIFIED');
 let rejected;try{await S.strictFetch(async()=>new Response('secret',{status:403}))('https://synthetic.invalid');}catch(error){rejected=error;}
 assert.equal(S.diagnostic(rejected),'HTTP_403');assert.ok(!rejected.message.includes('secret'));
});
test('server AI defaults reuse site credentials while explicit false always disables',()=>{
 assert.deepEqual(getCounselingAiConfig(),{enabled:false,model:'gemini-2.5-flash'});
 process.env.GEMINI_API_KEY='synthetic-only';assert.equal(getCounselingAiConfig().enabled,true);
 process.env.COUNSELING_SERVER_AI_ENABLED='false';assert.equal(getCounselingAiConfig().enabled,false);
 delete process.env.COUNSELING_SERVER_AI_ENABLED;delete process.env.GEMINI_API_KEY;
 process.env.VERTEX_PROJECT='synthetic-only';assert.equal(getCounselingAiConfig().enabled,false);
 process.env.VERTEX_SA_KEY='synthetic-only';process.env.LLM_MODEL='synthetic-model';assert.deepEqual(getCounselingAiConfig(),{enabled:true,model:'synthetic-model'});
});
