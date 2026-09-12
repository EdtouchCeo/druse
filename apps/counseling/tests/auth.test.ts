import test from 'node:test'
import assert from 'node:assert/strict'
import {validatedLocalOrigin,connectionUrl,schoolLoginUrl,receivedTeacherToken,approvedTeacherToken,AUTH_ORIGIN,AUTH_MESSAGE} from '../src/lib/authBridge'
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
