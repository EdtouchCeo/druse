import {readSessionToken} from './model'
import type {Health} from './types'

export const AUTH_ORIGIN='https://daeryun.life'
export const AUTH_MESSAGE='daeryun-counseling-auth'
export const AUTH_RESULT='daeryun-counseling-auth-result'
export const CONNECTION_STORAGE_KEY='daeryun-counseling:connection:v1'
const CONNECTION_TTL=15*60*1000
export function validatedLocalOrigin(value:string|null):string|null{
 if(!value||!/^http:\/\/(127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(value))return null
 try{const url=new URL(value);return url.origin}catch{return null}
}
export function connectionUrl(localOrigin:string):string{
 const target=validatedLocalOrigin(localOrigin)
 if(!target)throw new Error('이 PC의 localhost 또는 127.0.0.1 주소에서 연결해 주세요.')
 return AUTH_ORIGIN+'/counseling/?connect_local='+encodeURIComponent(target)
}
export function schoolLoginUrl():string{return '/?login_return=%2Fcounseling%2F#login'}

export function rememberConnection(storage:Pick<Storage,'setItem'|'removeItem'>,localOrigin:string,now=Date.now()):boolean{
 try{
  storage.removeItem(CONNECTION_STORAGE_KEY)
  const origin=validatedLocalOrigin(localOrigin)
  if(!origin||!Number.isFinite(now))return false
  storage.setItem(CONNECTION_STORAGE_KEY,JSON.stringify({origin,createdAt:now}))
  return true
 }catch{return false}
}
export function consumeConnection(storage:Pick<Storage,'getItem'|'removeItem'>,now=Date.now()):string|null{
 try{
  const raw=storage.getItem(CONNECTION_STORAGE_KEY)
  storage.removeItem(CONNECTION_STORAGE_KEY)
  if(!raw||!Number.isFinite(now))return null
  const data:unknown=JSON.parse(raw)
  if(!data||typeof data!=='object'||Array.isArray(data)||!('origin' in data)||!('createdAt' in data)||Object.keys(data).length!==2)return null
  if(typeof data.origin!=='string'||typeof data.createdAt!=='number'||!Number.isFinite(data.createdAt)||data.createdAt>now||now-data.createdAt>=CONNECTION_TTL)return null
  return validatedLocalOrigin(data.origin)
 }catch{return null}
}

export function receivedConnectionResult(event:Pick<MessageEvent,'origin'|'source'|'data'>,expectedOpener:MessageEventSource|null,targetOrigin:string|null):'connected'|'failed'|null{
 const target=validatedLocalOrigin(targetOrigin)
 if(!expectedOpener||!target||event.origin!==target||event.source!==expectedOpener)return null
 const data=event.data
 return data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===2&&data.type===AUTH_RESULT&&(data.status==='connected'||data.status==='failed')?data.status:null
}

export function receivedTeacherToken(event:Pick<MessageEvent,'origin'|'source'|'data'>,expected:MessageEventSource|null):string|null{
 if(!expected||event.origin!==AUTH_ORIGIN||event.source!==expected)return null
 const data=event.data
 return data&&typeof data==='object'&&data.type===AUTH_MESSAGE&&typeof data.token==='string'&&data.token.length>0&&data.token.length<16384?data.token:null
}
export function approvedTeacherToken(health:Health|null,storage:Pick<Storage,'getItem'>):string|null{
 if(health?.mode!=='online'||health.teacher?.role!=='teacher'||health.teacher.approved!==true)return null
 return readSessionToken(storage)
}
