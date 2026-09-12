'use strict';
const C=require('../counseling');
async function listRows(table,columns,order){
 const fields=columns.split(','),result=[];
 for(let offset=0;offset<=10000;offset+=500){
  const rows=await C.db(`${table}?select=${columns}&order=${order}&limit=500&offset=${offset}`);
  if(!Array.isArray(rows))C.fail(503,'ADMIN_LIST_UNAVAILABLE','상담 관리 목록을 불러오지 못했습니다.');
  if(result.length+rows.length>10000)C.fail(503,'ADMIN_LIST_LIMIT','관리 목록이 조회 범위를 넘었습니다. 운영 담당자에게 문의해 주세요.');
  for(const row of rows)result.push(Object.fromEntries(fields.map(key=>[key,row[key]])));
  if(rows.length<500)return result;
 }
 C.fail(503,'ADMIN_LIST_LIMIT','관리 목록이 조회 범위를 넘었습니다. 운영 담당자에게 문의해 주세요.');
}
exports.handler=C.wrap(async event=>{
 if(!['GET','POST'].includes(event.httpMethod))C.fail(405,'METHOD_NOT_ALLOWED','GET 또는 POST 요청만 허용됩니다.');
 const actor=await C.auth(event,{roles:['manager']});
 if(event.httpMethod==='GET'){
  const [users,roles,students,numbers,assignments]=await Promise.all([
   listRows('users','id,name,role,approved','id.asc'),
   listRows('counseling_roles','user_id,role,approved','user_id.asc,role.asc'),
   listRows('counseling_students','id,user_id,name,active','id.asc'),
   listRows('counseling_student_numbers','student_id,academic_year,student_number,school_stage,grade','student_id.asc,academic_year.desc'),
   listRows('counseling_assignments','student_id,teacher_user_id,active','student_id.asc,teacher_user_id.asc')
  ]);
  return C.json(200,{users,roles,students,numbers,assignments});
 }
 const b=C.body(event,6000);C.rejectPrivate(b);
 if(b.action==='role'){C.onlyKeys(b,['action','user_id','role','approved']);if(!C.uuid(b.user_id)||!['teacher','student','manager'].includes(b.role)||typeof b.approved!=='boolean')C.fail(400,'BAD_REQUEST','역할 입력을 확인해 주세요.');}
 else if(b.action==='assign'){C.onlyKeys(b,['action','student_id','teacher_user_id','active']);if(!C.uuid(b.student_id)||!C.uuid(b.teacher_user_id)||typeof b.active!=='boolean')C.fail(400,'BAD_REQUEST','담당 배정 정보를 확인해 주세요.');}
 else if(b.action==='student'){C.onlyKeys(b,['action','user_id','student_id','student_number','academic_year','school_stage','grade','name']);if(!C.uuid(b.user_id)||(b.student_id&&!C.uuid(b.student_id))||!/^\d{4,8}$/.test(b.student_number||'')||!Number.isInteger(b.academic_year)||b.academic_year<2020||b.academic_year>2100||!['middle','high'].includes(b.school_stage)||![1,2,3].includes(b.grade)||typeof b.name!=='string'||b.name.length>80)C.fail(400,'BAD_REQUEST','학생·학년도별 학번을 확인해 주세요.');}
 else C.fail(400,'UNKNOWN_ACTION','지원하지 않는 관리 작업입니다.');
 return C.json(200,await C.db('rpc/counseling_administer',{method:'POST',data:{p_actor:actor.id,p_input:b}}));
});
