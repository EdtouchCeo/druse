'use strict';
const C=require('../counseling');
const {normalizeStudentInput}=require('../counseling-students');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='POST')C.fail(405,'METHOD_NOT_ALLOWED','POST 요청만 허용됩니다.');
 const actor=await C.auth(event,{roles:['teacher']});
 const input=normalizeStudentInput(C.body(event,6000),C.fail);
 const student=await C.db('rpc/counseling_create_student',{method:'POST',data:{p_actor:actor.id,p_input:input}});
 return C.json(200,{student});
});
