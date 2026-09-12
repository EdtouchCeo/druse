'use strict';
const C=require('../counseling');
const storage=require('../counseling-storage');
const {getCounselingAiConfig}=require('../counseling-ai-config');
// Public readiness contains no account details and never writes a probe record.
exports.handler=C.wrap(async event=>{
 if(event.httpMethod!=='GET')C.fail(405,'METHOD_NOT_ALLOWED','GET 요청만 허용됩니다.');
 const checks=await Promise.allSettled([
  C.db('counseling_roles?select=user_id&limit=1'),
  C.db('users?select=id,google_id,name,email,role,approved,grade,class,admission_year&limit=0')
 ]);
 const ready=checks[0].status==='fulfilled',auth=checks[1].status==='fulfilled';
 return C.json(ready&&auth?200:503,{service:'daeryun-counseling',version:'0.5.0',storage:storage.mode(),storage_ready:ready,storage_diagnostic:ready?'READY':storage.diagnostic(checks[0].reason),school_auth_ready:auth,record_analysis:'local-ollama-only',server_ai_configured:getCounselingAiConfig().enabled});
});
