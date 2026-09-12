import { modeForHost } from './model'
import type { Transport } from './types'
export async function createTransport(host=location.hostname):Promise<Transport> {
 if(modeForHost(host)==='local'){const {LocalTransport}=await import('./localTransport');return new LocalTransport()}
 const {CloudTransport}=await import('./cloudTransport');return new CloudTransport()
}
export class ApiError extends Error { constructor(public status:number,public code:string,message:string){super(message);this.name='ApiError'} }
export async function checked(response:Response):Promise<Response> {
 if(response.ok)return response
 let code='request_failed',message='요청을 처리하지 못했습니다.'
 try {const data=await response.json();code=data.error?.code||code;message=data.error?.message||message}catch{/* Do not expose raw server HTML. */}
 if(response.status===409)message='다른 창에서 이 상담을 수정했습니다. 작성 내용을 백업한 뒤 최신 기록을 불러와 주세요.'
 if(response.status===401)message='로그인을 다시 확인해 주세요. 작성한 내용은 현재 화면에 남아 있습니다.'
 if(response.status===403&&code==='csrf_invalid')message='상담실 연결이 갱신되었습니다. 새로고침한 뒤 다시 시도해 주세요.'
 throw new ApiError(response.status,code,message)
}
