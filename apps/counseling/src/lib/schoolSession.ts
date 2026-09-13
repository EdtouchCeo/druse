import {ApiError,checked} from './transport'

const SESSION_KEY='dr_sess_v1'
type Session={token:string;refresh_token?:string;expires_at?:number;[key:string]:unknown}
type SessionStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>
const loginRequired=()=>new ApiError(401,'AUTH_REQUIRED','학교 계정 로그인이 필요합니다. 아래 로그인 버튼을 누르면 로그인 후 학종 전략실로 이동합니다.')
const sessionChanged=()=>new ApiError(401,'SESSION_CHANGED','로그인 계정이 변경되었습니다. 작성 내용을 백업한 뒤 로그인 상태를 다시 확인해 주세요.')

function read(storage:SessionStorage):Session|null {
 try{const value=JSON.parse(storage.getItem(SESSION_KEY)||'null');return value&&typeof value.token==='string'&&value.token?value:null}catch{return null}
}
function expiry(session:Session):number|null {
 if(typeof session.expires_at==='number'&&Number.isFinite(session.expires_at))return session.expires_at
 try{const payload=JSON.parse(atob(session.token.split('.')[1]!.replace(/-/g,'+').replace(/_/g,'/')));return typeof payload.exp==='number'&&Number.isFinite(payload.exp)?payload.exp*1000:null}catch{return null}
}
function sameCredentials(a:Session|null,b:Session):boolean{return a?.token===b.token&&a.refresh_token===b.refresh_token}

/** Uses the manual's session without copying its public Supabase configuration. */
export class SchoolSessionAuth {
 private pending=new Map<string,Promise<string>>()
 private rotation:{before:string;after:string}|null=null
 constructor(private storage:SessionStorage,private request:typeof fetch=(...args)=>globalThis.fetch(...args),private now:()=>number=Date.now){}

 async token(force=false,rejectedToken?:string):Promise<string>{
  const session=read(this.storage)
  if(!session)throw loginRequired()
  if(rejectedToken&&session.token!==rejectedToken){
   if(this.rotation?.before===rejectedToken&&this.rotation.after===session.token)return session.token
   throw sessionChanged()
  }
  const expiresAt=expiry(session)
  if(!force&&(!session.refresh_token||(expiresAt!==null&&expiresAt>this.now()+60000)))return session.token
  if(typeof session.refresh_token!=='string'||!session.refresh_token)throw loginRequired()
  const key=session.token+'\n'+session.refresh_token
  const existing=this.pending.get(key)
  if(existing)return existing
  const pending=this.refresh(session).finally(()=>this.pending.delete(key))
  this.pending.set(key,pending)
  return pending
 }

 private async refresh(session:Session):Promise<string>{
  let response:Response
  try{response=await this.request('/.netlify/functions/counseling-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)})}
  catch{throw new ApiError(503,'AUTH_UNAVAILABLE','학교 로그인 연결을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
  if(!sameCredentials(read(this.storage),session))throw sessionChanged()
  if(response.status===401){this.storage.removeItem(SESSION_KEY);throw loginRequired()}
  await checked(response)
  const data=await response.json()
  if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new ApiError(503,'AUTH_UNAVAILABLE','학교 로그인 갱신 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  const current=read(this.storage)
  if(!sameCredentials(current,session))throw sessionChanged()
  this.storage.setItem(SESSION_KEY,JSON.stringify({...current,token:data.access_token,refresh_token:data.refresh_token,expires_at:this.now()+data.expires_in*1000}))
  this.rotation={before:session.token,after:data.access_token}
  return data.access_token
 }
}
