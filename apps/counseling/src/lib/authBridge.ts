import {readSessionToken} from './model'
import type {Health} from './types'

export const AUTH_ORIGIN='https://daeryun.life'
export const AUTH_MESSAGE='daeryun-counseling-auth'
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

export function receivedTeacherToken(event:Pick<MessageEvent,'origin'|'source'|'data'>,expected:MessageEventSource|null):string|null{
 if(!expected||event.origin!==AUTH_ORIGIN||event.source!==expected)return null
 const data=event.data
 return data&&typeof data==='object'&&data.type===AUTH_MESSAGE&&typeof data.token==='string'&&data.token.length>0&&data.token.length<16384?data.token:null
}
export function approvedTeacherToken(health:Health|null,storage:Pick<Storage,'getItem'>):string|null{
 if(health?.mode!=='online'||health.teacher?.role!=='teacher'||health.teacher.approved!==true)return null
 return readSessionToken(storage)
}
