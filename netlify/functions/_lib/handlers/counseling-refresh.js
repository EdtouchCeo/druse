'use strict';
const C=require('../counseling');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='POST')C.fail(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');
 const input=C.body(event,16384);C.onlyKeys(input,['refresh_token']);
 if(typeof input.refresh_token!=='string'||!input.refresh_token.trim()||input.refresh_token.length>8192)C.fail(400,'BAD_REQUEST','학교 로그인 갱신 정보를 확인해 주세요.');
 const {url,key}=C.config();let response;
 try{response=await fetch(url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({refresh_token:input.refresh_token}),signal:AbortSignal.timeout(8000)});}
 catch{C.fail(503,'AUTH_UNAVAILABLE','학교 로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
 if(response.status===400||response.status===401)C.fail(401,'AUTH_REQUIRED','학교 로그인이 만료되었습니다. 다시 로그인해 주세요.');
 if(!response.ok)C.fail(503,'AUTH_UNAVAILABLE','학교 로그인을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.');
 const data=await response.json().catch(()=>null);
 if(typeof data?.access_token!=='string'||!data.access_token||data.access_token.length>16384||typeof data.refresh_token!=='string'||!data.refresh_token||data.refresh_token.length>8192||typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0)C.fail(503,'AUTH_UNAVAILABLE','학교 로그인 갱신 결과를 확인하지 못했습니다.');
 return C.json(200,{access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in});
});
