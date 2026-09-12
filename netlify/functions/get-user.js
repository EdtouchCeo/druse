'use strict';
const C=require('./_lib/counseling');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='POST')C.fail(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');
 const b=C.body(event,3000),me=await C.identity(event);C.onlyKeys(b,['google_id']);
 if(b.google_id&&b.google_id!==me.id)C.fail(403,'IDENTITY_MISMATCH','본인 회원 정보만 조회할 수 있습니다.');
 const rows=await C.db(`users?google_id=eq.${encodeURIComponent(me.id)}&select=id,google_id,email,name,role,approved,admission_year,grade,class&limit=1`);
 return C.json(200,rows);
});
