'use strict';
const C=require('./_lib/counseling');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='POST')C.fail(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');
 const b=C.body(event,4000),me=await C.identity(event);C.onlyKeys(b,['google_id','email','name','role','admission_year','grade','class','student_number']);
 if((b.google_id&&b.google_id!==me.id)||(b.email&&b.email!==me.email))C.fail(403,'IDENTITY_MISMATCH','로그인한 본인의 정보만 등록할 수 있습니다.');
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!['\uad50\uc0ac','\ud559\uc0dd','\ud559\ubd80\ubaa8'].includes(b.role))C.fail(400,'BAD_REQUEST','이름과 회원 구분을 확인해 주세요.');
 const rows=await C.db(`users?google_id=eq.${me.id}&select=id,role&limit=1`);
 if(rows.length&&b.role!==rows[0].role)C.fail(403,'ROLE_CHANGE_DENIED','회원 구분 변경은 관리자에게 요청해 주세요.');
 const data={name:b.name.trim(),email:me.email||'',grade:b.grade??null,class:b.class??null};
 if(data.grade!==null&&![1,2,3].includes(data.grade))C.fail(400,'BAD_REQUEST','학년을 확인해 주세요.');
 if(data.class!==null&&(!Number.isInteger(data.class)||data.class<1||data.class>30))C.fail(400,'BAD_REQUEST','반을 확인해 주세요.');
 // The existing registration form stores its class number in admission_year.
 // Preserve that contract without adding a column. Counseling uses its own
 // fixed student ID and explicit academic-year number history.
 if(b.student_number!==undefined&&b.student_number!==null){if(!/^\d{1,8}$/.test(String(b.student_number)))C.fail(400,'BAD_REQUEST','학생 번호를 확인해 주세요.');data.admission_year=Number(b.student_number);}
 if(b.admission_year!==undefined&&b.admission_year!==null){if(!Number.isInteger(b.admission_year)||b.admission_year<2000||b.admission_year>2100)C.fail(400,'BAD_REQUEST','입학연도와 학생 번호를 구분해 주세요.');data.admission_year=b.admission_year;}
 if(!rows.length)Object.assign(data,{google_id:me.id,role:b.role,approved:false});
 return C.json(200,await C.db(rows.length?`users?id=eq.${rows[0].id}`:'users',{method:rows.length?'PATCH':'POST',data,prefer:'return=representation'}));
});
