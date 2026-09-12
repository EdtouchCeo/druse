'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');

// Execute the deployed page's real authentication IIFE. Only its public service
// configuration is replaced; every request is intercepted inside this VM.
const html=fs.readFileSync(path.join(__dirname,'../output/web/index.html'),'utf8');
const candidates=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.includes("var SESSION_KEY = 'dr_sess_v1'")&&source.includes('function captureLoginReturn('));
assert.equal(candidates.length,1,'one actual school authentication script must be present');
const authSource=candidates[0].replace(/\b(var|const|let)\s+SB_URL\s*=\s*(['"])[^'"]*\2\s*;/,'var SB_URL = "https://synthetic-auth.invalid";').replace(/\b(var|const|let)\s+SB_KEY\s*=\s*(['"])[^'"]*\2\s*;/,'var SB_KEY = "synthetic-public-key";');
const NOW=Date.parse('2026-09-12T00:00:00Z'),SESSION='dr_sess_v1',RETURN='dr_login_return_v1';
const authId='70000000-0000-4000-8000-000000000001',profileId='70000000-0000-4000-8000-000000000002';
const profile={id:profileId,google_id:authId,name:'합성 교사',role:'교사',approved:true};
const token=label=>Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:authId,email:'synthetic@example.invalid',user_metadata:{full_name:'합성 교사'},fixture:label})).toString('base64url')+'.synthetic';
const access=token('access'),fresh=token('fresh');
const pending=at=>JSON.stringify({path:'/counseling/',at:at??NOW});
const stored=()=>JSON.stringify({token:access,refresh_token:'synthetic-refresh',expires_at:NOW-1000,user:{...profile,name:'캐시 표시 이름'}});

function storage(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),snapshot:()=>Object.fromEntries(values)};}
function browser({url='https://daeryun.life/',local={},session={},reply}={}){
 const localStorage=storage(local),sessionStorage=storage(session),calls=[],navigation=[],replacements=[],tabs=[],alerts=[],events=[],elements=new Map();
 let current=new URL(url),inFlight=0;
 const location={get href(){return current.href;},set href(value){current=new URL(value,current);navigation.push({kind:'href',url:current.href});},get search(){return current.search;},get hash(){return current.hash;},get pathname(){return current.pathname;},get origin(){return current.origin;},replace(value){current=new URL(value,current);navigation.push({kind:'replace',url:current.href});}};
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',style:{},disabled:false,textContent:'',addEventListener(){},click(){if(id==='school')tabs.push('school');}});return elements.get(id);};
 const document={readyState:'complete',getElementById:element,querySelectorAll:()=>[],querySelector:selector=>selector.includes('reg-role')?{value:'교사'}:selector.includes('school')?element('school'):null,addEventListener(){}};
 const window={location,dispatchEvent:event=>events.push(event.type)};
 const history={replaceState(_state,_title,value){current=new URL(value,current);replacements.push(current.href);events.push('history-clean');}};
 class ClockDate extends Date {static now(){return NOW;}}
 const fetch=async(input,options={})=>{
  const request={url:new URL(input,'https://daeryun.life'),method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined,authorization:options.headers?.Authorization};
  calls.push(request);events.push('fetch:'+request.url.pathname);inFlight++;
  try{if(request.url.pathname.endsWith('/save-log'))return Response.json({ok:true});if(!reply)throw Error('unexpected synthetic request');return await reply(request,calls);}finally{inFlight--;}
 };
 const sandbox={window,document,history,localStorage,sessionStorage,fetch,Date:ClockDate,URL,URLSearchParams,TextEncoder,Uint8Array,Event:class Event{constructor(type){this.type=type;}},alert:value=>alerts.push(value),switchTab:name=>tabs.push(name),refreshActiveTabGate(){},crypto:{getRandomValues:array=>array.fill(7),subtle:{digest:async(_name,data)=>Uint8Array.from(crypto.createHash('sha256').update(data).digest()).buffer}},atob:value=>Buffer.from(value,'base64').toString('binary'),btoa:value=>Buffer.from(value,'binary').toString('base64'),setTimeout,clearTimeout};
 vm.runInNewContext(authSource,sandbox,{filename:'actual-school-auth.js',timeout:1000});
 return {window,location,localStorage,sessionStorage,calls,navigation,replacements,tabs,alerts,events,element,async settle(){for(let i=0;i<10;i++)await new Promise(setImmediate);assert.equal(inFlight,0,'synthetic requests settled');}};
}
const getUser=request=>request.url.pathname==='/.netlify/functions/get-user';
const grant=request=>request.url.searchParams.get('grant_type');
const successfulProfile=async request=>{assert.ok(getUser(request));return Response.json([profile]);};
function assertReturned(b){assert.deepEqual(b.navigation,[{kind:'replace',url:'https://daeryun.life/counseling/'}]);assert.equal(b.sessionStorage.getItem(RETURN),null);assert.ok(!b.tabs.includes('school'));}
function assertOAuth(b){assert.equal(b.navigation.length,1);const url=new URL(b.navigation[0].url);assert.equal(url.origin,'https://synthetic-auth.invalid');assert.equal(url.pathname,'/auth/v1/authorize');assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),'https://daeryun.life');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(url.searchParams.get('code_challenge'),/^[A-Za-z0-9_-]{43}$/);assert.ok(!url.searchParams.has('access_token'));}

test('unauthenticated strategy entry automatically starts PKCE OAuth with fixed school callback',async()=>{
 const b=browser({url:'https://daeryun.life/?login_return=%2Fcounseling%2F#login'});await b.settle();assertOAuth(b);
 assert.deepEqual(JSON.parse(b.sessionStorage.getItem(RETURN)),{path:'/counseling/',at:NOW});const verifier=b.localStorage.getItem('pkce_v');assert.match(verifier,/^[A-Za-z0-9_-]{43}$/);assert.equal(new URL(b.navigation[0].url).searchParams.get('code_challenge'),crypto.createHash('sha256').update(verifier).digest('base64url'));assert.equal(b.calls.length,0);
});

test('code callback consumes the same-tab return once and removes callback credentials from the address',async()=>{
 const b=browser({url:'https://daeryun.life/?code=synthetic-code',local:{pkce_v:'synthetic-verifier'},session:{[RETURN]:pending()},reply:async request=>{
  if(grant(request)==='pkce'){assert.deepEqual(request.body,{auth_code:'synthetic-code',code_verifier:'synthetic-verifier'});return Response.json({access_token:access,refresh_token:'synthetic-refresh',expires_in:3600});}
  assert.ok(getUser(request));assert.equal(request.authorization,'Bearer '+access);return Response.json([profile]);
 }});await b.settle();assertReturned(b);assert.deepEqual(b.replacements,['https://daeryun.life/']);assert.ok(b.events.indexOf('history-clean')<b.events.indexOf('fetch:/auth/v1/token'));assert.equal(b.localStorage.getItem('pkce_v'),null);assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).token,access);assert.ok(!b.location.href.includes('code='));
 const reopened=browser({local:b.localStorage.snapshot(),session:b.sessionStorage.snapshot()});await reopened.settle();assert.deepEqual(reopened.navigation,[]);
});

test('implicit hash callback also clears token-bearing URL and returns only after profile resolution',async()=>{
 const b=browser({url:'https://daeryun.life/#'+new URLSearchParams({access_token:access,refresh_token:'synthetic-refresh',expires_in:'3600'}),session:{[RETURN]:pending()},reply:successfulProfile});await b.settle();assertReturned(b);assert.deepEqual(b.replacements,['https://daeryun.life/']);assert.equal(b.calls.filter(getUser).length,1);assert.ok(!b.location.href.includes(access));assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).user.id,profileId);
});

test('cached strategy login revalidates identity with bearer and an empty body before returning',async()=>{
 const b=browser({url:'https://daeryun.life/?login_return=%2Fcounseling%2F#login',local:{[SESSION]:stored()},reply:async request=>{assert.ok(getUser(request));assert.equal(request.method,'POST');assert.deepEqual(request.body,{});assert.equal(request.authorization,'Bearer '+access);return Response.json([profile]);}});await b.settle();assertReturned(b);assert.equal(b.calls.filter(getUser).length,1);assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).user.name,profile.name);assert.equal(b.localStorage.getItem('pkce_v'),null);
});

test('401 cached token refreshes exactly once and revalidates the new token before return',async()=>{
 let checks=0;
 const b=browser({url:'https://daeryun.life/?login_return=%2Fcounseling%2F#login',local:{[SESSION]:stored()},reply:async request=>{
  if(getUser(request)){checks++;assert.equal(request.authorization,'Bearer '+(checks===1?access:fresh));return checks===1?Response.json({error:'expired'},{status:401}):Response.json([profile]);}
  assert.equal(grant(request),'refresh_token');assert.deepEqual(request.body,{refresh_token:'synthetic-refresh'});return Response.json({access_token:fresh,refresh_token:'synthetic-rotated',expires_in:3600});
 }});await b.settle();assertReturned(b);assert.equal(checks,2);assert.equal(b.calls.filter(request=>grant(request)==='refresh_token').length,1);assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).token,fresh);
});

test('failed refresh or a second rejected token clears the cache and starts one OAuth attempt',async()=>{
 for(const refreshed of [false,true]){
  let checks=0;const b=browser({url:'https://daeryun.life/?login_return=%2Fcounseling%2F#login',local:{[SESSION]:stored()},reply:async request=>{if(getUser(request)){checks++;return Response.json({error:'revoked'},{status:403});}assert.equal(grant(request),'refresh_token');return refreshed?Response.json({access_token:fresh,expires_in:3600}):Response.json({error:'expired'},{status:401});}});
  await b.settle();assertOAuth(b);assert.equal(b.localStorage.getItem(SESSION),null);assert.equal(checks,refreshed?2:1);assert.equal(b.calls.filter(request=>grant(request)==='refresh_token').length,1);assert.notEqual(b.sessionStorage.getItem(RETURN),null);
 }
});

test('ordinary school entry does not auto-login or inherit return state and ordinary OAuth keeps school navigation',async()=>{
 const ordinary=browser({session:{[RETURN]:pending()}});await ordinary.settle();assert.deepEqual(ordinary.navigation,[]);assert.equal(ordinary.calls.length,0);assert.equal(ordinary.sessionStorage.getItem(RETURN),null);
 const explicit=browser({url:'https://daeryun.life/#login'});await explicit.settle();assertOAuth(explicit);assert.equal(explicit.sessionStorage.getItem(RETURN),null);
 const callback=browser({url:'https://daeryun.life/#access_token='+access,reply:successfulProfile});await callback.settle();assert.deepEqual(callback.navigation,[]);assert.deepEqual(callback.tabs,['school']);
});

test('external, duplicate, scheme, encoded and query/path traversal return targets never become destinations',async()=>{
 const targets=['https://example.invalid/counseling/','//example.invalid/','javascript:alert(1)','\\example.invalid\\','/counseling/?connect_local=http://127.0.0.1:8765','/counseling/../','/counseling/#other','%2Fcounseling%2F'];
 const queries=targets.map(target=>new URLSearchParams({login_return:target}));const duplicate=new URLSearchParams();duplicate.append('login_return','/counseling/');duplicate.append('login_return','/counseling/');queries.push(duplicate);
 for(const query of queries){const b=browser({url:'https://daeryun.life/?'+query+'#login',session:{[RETURN]:pending()}});await b.settle();assertOAuth(b);assert.equal(b.sessionStorage.getItem(RETURN),null);}
});

test('callback rejects expired, future, malformed and tampered sessionStorage returns',async()=>{
 const values=[pending(NOW-30*60*1000),pending(NOW+1),JSON.stringify({path:'https://example.invalid/',at:NOW}),JSON.stringify({path:'/counseling/',at:String(NOW)}),JSON.stringify({path:'/counseling/',at:null}),'{invalid'];
 for(const value of values){const b=browser({url:'https://daeryun.life/#access_token='+access,session:{[RETURN]:value},reply:successfulProfile});await b.settle();assert.deepEqual(b.navigation,[]);assert.deepEqual(b.tabs,['school']);assert.equal(b.sessionStorage.getItem(RETURN),null);}
});

test('first registration keeps the pending return until the profile is saved successfully',async()=>{
 const b=browser({url:'https://daeryun.life/#access_token='+access,session:{[RETURN]:pending()},reply:async request=>{if(getUser(request))return Response.json([]);assert.equal(request.url.pathname,'/.netlify/functions/save-user');assert.equal(request.authorization,'Bearer '+access);assert.equal(request.body.google_id,authId);return Response.json([profile]);}});
 await b.settle();assert.deepEqual(b.navigation,[]);assert.deepEqual(b.tabs,['register']);assert.notEqual(b.sessionStorage.getItem(RETURN),null);assert.equal(b.element('reg-step-form').style.display,'');
 b.element('reg-name-t').value='합성 교사';b.window.submitReg({preventDefault(){}});await b.settle();assertReturned(b);assert.equal(b.calls.filter(request=>request.url.pathname.endsWith('/save-user')).length,1);assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).user.id,profileId);
});

test('callback profile network failure stays at registration without consuming a return or treating tempUser as success',async()=>{
 const b=browser({url:'https://daeryun.life/#access_token='+access,session:{[RETURN]:pending()},reply:async()=>{throw new TypeError('synthetic network failure');}});await b.settle();assert.deepEqual(b.navigation,[]);assert.deepEqual(b.tabs,['register']);assert.notEqual(b.sessionStorage.getItem(RETURN),null);assert.equal(b.element('reg-step-form').style.display,'');assert.equal(JSON.parse(b.localStorage.getItem(SESSION)).user.role,'');
});

test('cached profile service errors and failed PKCE exchange do not manufacture a successful login',async()=>{
 const cached=browser({url:'https://daeryun.life/?login_return=%2Fcounseling%2F#login',local:{[SESSION]:stored()},reply:async()=>Response.json({error:'unavailable'},{status:503})});await cached.settle();assert.deepEqual(cached.navigation,[]);assert.equal(cached.alerts.length,1);assert.notEqual(cached.sessionStorage.getItem(RETURN),null);
 const pkce=browser({url:'https://daeryun.life/?code=synthetic-code',local:{pkce_v:'synthetic-verifier'},session:{[RETURN]:pending()},reply:async()=>Response.json({error:'invalid_code'},{status:400})});await pkce.settle();assert.deepEqual(pkce.navigation,[]);assert.equal(pkce.localStorage.getItem(SESSION),null);assert.notEqual(pkce.sessionStorage.getItem(RETURN),null);assert.equal(pkce.localStorage.getItem('pkce_v'),null);
});
