import test from 'node:test'
import assert from 'node:assert/strict'
import {validatedLocalOrigin,connectionUrl,schoolLoginUrl,receivedTeacherToken,approvedTeacherToken,receivedConnectionResult,rememberConnection,consumeConnection,AUTH_ORIGIN,AUTH_MESSAGE,AUTH_RESULT,CONNECTION_STORAGE_KEY} from '../src/lib/authBridge'
import type {Health} from '../src/lib/types'

test('authentication bridge accepts only explicit HTTP loopback origins',()=>{
 for(const value of ['http://127.0.0.1:8765','http://localhost:8766'])assert.equal(validatedLocalOrigin(value),value)
 for(const value of ['https://127.0.0.1:8765','http://127.0.0.1.evil.test','http://localhost@evil.test','http://localhost:8765/path','http://localhost:8765?token=x','http://localhost:65536','http://[::1]:8765',null])assert.equal(validatedLocalOrigin(value),null)
 const url=new URL(connectionUrl('http://127.0.0.1:8765'))
 assert.equal(url.origin,AUTH_ORIGIN);assert.deepEqual([...url.searchParams.keys()],['connect_local'])
})
test('authentication message rejects wrong origin, wrong source, missing popup and malformed token',()=>{
 const expected={} as Window,other={} as Window,data={type:AUTH_MESSAGE,token:'synthetic-token'}
 assert.equal(receivedTeacherToken({origin:'https://evil.test',source:expected,data},expected),null)
 assert.equal(receivedTeacherToken({origin:AUTH_ORIGIN,source:other,data},expected),null)
 assert.equal(receivedTeacherToken({origin:AUTH_ORIGIN,source:expected,data},null),null)
 assert.equal(receivedTeacherToken({origin:AUTH_ORIGIN,source:expected,data:{...data,token:123}},expected),null)
 assert.equal(receivedTeacherToken({origin:AUTH_ORIGIN,source:expected,data},expected),'synthetic-token')
})
test('only a server-confirmed approved online teacher may share the token',()=>{
 const storage={getItem:()=>JSON.stringify({token:'synthetic-token',user:{role:'teacher',approved:true}})}
 const health:Health={mode:'online',demo:false,teacher:{id:'teacher',display_name:'합성교사',role:'teacher',approved:true},ollama:{available:false,models:[]}}
 assert.equal(approvedTeacherToken(health,storage),'synthetic-token')
 assert.equal(approvedTeacherToken({...health,teacher:null,user:{id:'student',display_name:'합성학생',role:'student',approved:true}},storage),null)
 assert.equal(approvedTeacherToken({...health,teacher:{...health.teacher!,approved:false}},storage),null)
 assert.equal(approvedTeacherToken({...health,mode:'local'},storage),null)
})


test('school login has a fixed strategy-room return path with no connection or credential parameters',()=>{
 assert.equal(schoolLoginUrl(),'/?login_return=%2Fcounseling%2F#login')
 const login=new URL(schoolLoginUrl(),AUTH_ORIGIN)
 assert.equal(login.origin,AUTH_ORIGIN);assert.equal(login.pathname,'/');assert.equal(login.hash,'#login')
 assert.deepEqual([...login.searchParams.keys()],['login_return'])
 assert.equal(login.searchParams.get('login_return'),'/counseling/')
 assert.equal(new URL(login.searchParams.get('login_return')!,AUTH_ORIGIN).search,'')
})

test('connection results require the original local opener, exact loopback origin and known result shape',()=>{
 const opener={} as Window,other={} as Window,origin='http://127.0.0.1:8765'
 const event={origin,source:opener,data:{type:AUTH_RESULT,status:'connected'}}
 assert.equal(receivedConnectionResult(event,opener,origin),'connected')
 assert.equal(receivedConnectionResult({...event,data:{type:AUTH_RESULT,status:'failed'}},opener,origin),'failed')
 for(const invalidOrigin of ['https://daeryun.life','http://localhost:8765','http://127.0.0.1:8766','http://127.0.0.1.evil.test'])assert.equal(receivedConnectionResult({...event,origin:invalidOrigin},opener,origin),null)
 assert.equal(receivedConnectionResult({...event,source:other},opener,origin),null)
 assert.equal(receivedConnectionResult(event,null,origin),null)
 assert.equal(receivedConnectionResult(event,opener,null),null)
 assert.equal(receivedConnectionResult({...event,origin:'https://evil.test'},opener,'https://evil.test'),null)
 for(const data of [null,[],true,'connected',{type:AUTH_MESSAGE,status:'connected'},{type:AUTH_RESULT},{type:AUTH_RESULT,status:true},{type:AUTH_RESULT,status:'sent'},{type:AUTH_RESULT,status:'connected',token:'unexpected'}])assert.equal(receivedConnectionResult({...event,data},opener,origin),null)
})

function connectionStorage(){
 const data=new Map<string,string>()
 return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}
}

test('same-tab login preserves only a short-lived loopback address, consumed once',()=>{
 const storage=connectionStorage(),origin='http://127.0.0.1:8765',now=1_000_000
 assert.equal(rememberConnection(storage,origin,now),true)
 assert.deepEqual(JSON.parse(storage.getItem(CONNECTION_STORAGE_KEY)!),{origin,createdAt:now})
 assert.equal(consumeConnection(storage,now+15*60*1000-1),origin)
 assert.equal(storage.getItem(CONNECTION_STORAGE_KEY),null)
 assert.equal(consumeConnection(storage,now),null)
 assert.equal(rememberConnection(storage,'http://localhost:80',now),true)
 assert.equal(consumeConnection(storage,now),'http://localhost')
})

test('saved connection context rejects expired, future, malformed and nonlocal addresses and always consumes them',()=>{
 const storage=connectionStorage(),origin='http://127.0.0.1:8765',now=1_000_000
 const invalid=[
  '{',JSON.stringify(null),JSON.stringify([]),JSON.stringify('http://localhost'),
  JSON.stringify({origin,createdAt:now-15*60*1000}),JSON.stringify({origin,createdAt:now+1}),
  JSON.stringify({origin,createdAt:String(now)}),JSON.stringify({origin,createdAt:null}),
  JSON.stringify({origin}),JSON.stringify({createdAt:now}),JSON.stringify({origin,createdAt:now,token:'unexpected'}),
  ...['https://evil.test','http://localhost@evil.test','http://localhost:8765/path','http://127.0.0.1:65536'].map(origin=>JSON.stringify({origin,createdAt:now})),
 ]
 for(const raw of invalid){storage.setItem(CONNECTION_STORAGE_KEY,raw);assert.equal(consumeConnection(storage,now),null);assert.equal(storage.getItem(CONNECTION_STORAGE_KEY),null)}
 for(const localOrigin of ['https://evil.test','http://localhost:8765?token=secret']){rememberConnection(storage,origin,now);assert.equal(rememberConnection(storage,localOrigin,now),false);assert.equal(storage.getItem(CONNECTION_STORAGE_KEY),null)}
 assert.equal(rememberConnection(storage,origin,Number.NaN),false)
 rememberConnection(storage,origin,now)
 assert.equal(consumeConnection(storage,Number.POSITIVE_INFINITY),null)
 assert.equal(storage.getItem(CONNECTION_STORAGE_KEY),null)
})

test('connection context storage failures cannot authorize a connection',()=>{
 const unavailable=()=>{throw new Error('Storage unavailable')}
 assert.equal(rememberConnection({setItem:unavailable,removeItem:()=>{}},'http://localhost:8765'),false)
 assert.equal(rememberConnection({setItem:()=>{},removeItem:unavailable},'http://localhost:8765'),false)
 assert.equal(consumeConnection({getItem:unavailable,removeItem:()=>{}}),null)
 assert.equal(consumeConnection({getItem:()=>JSON.stringify({origin:'http://localhost:8765',createdAt:Date.now()}),removeItem:unavailable}),null)
})
