'use strict';
const C=require('../counseling');
const {getCounselingAiConfig}=require('../counseling-ai-config');
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='GET')C.fail(405,'METHOD_NOT_ALLOWED','GET 요청만 허용됩니다.');
 const actor=await C.auth(event,{roles:['teacher','student','manager'],allowBootstrap:true}),students=await C.studentsFor(actor);
 return C.json(200,{user:{id:actor.id,role:actor.role,approved:true,can_manage:actor.roles.includes('manager'),display_name:actor.display_name,...(actor.role==='student'&&students[0]?{student_id:students[0].student_id}:{})},students,ai:{server:actor.role==='teacher'&&getCounselingAiConfig().enabled}});
});
