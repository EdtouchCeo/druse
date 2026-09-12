'use strict';
const C=require('./_lib/counseling');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='POST')C.fail(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');
 const b=C.body(event,3000),me=await C.identity(event),profile=await C.profileFor(me);C.onlyKeys(b,['user_id','event_type','detail','page']);
 if(b.user_id&&b.user_id!==profile.id)C.fail(403,'IDENTITY_MISMATCH','본인 접속 기록만 저장할 수 있습니다.');
 if(typeof b.event_type!=='string'||!b.event_type||b.event_type.length>50)C.fail(400,'BAD_REQUEST','접속 기록 형식을 확인해 주세요.');
 await C.db('logs',{method:'POST',data:{user_id:profile.id,event_type:b.event_type,detail:String(b.detail||'').slice(0,200),page:String(b.page||'').slice(0,200)}});
 return C.json(200,{ok:true});
});
