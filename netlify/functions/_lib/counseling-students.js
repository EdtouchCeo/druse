'use strict';
// Shared by the HTTP boundary and the storage adapter; identities and access
// controls are never accepted as student form fields.
function normalizeStudentInput(value,fail){
 const fields=['name','student_number','academic_year','school_stage','grade'];
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'BAD_REQUEST','학생 정보를 확인해 주세요.');
 if(Object.keys(value).some(key=>!fields.includes(key)))fail(400,'FIELD_NOT_ALLOWED','허용하지 않는 학생 입력 항목입니다.');
 const name=typeof value.name==='string'?value.name.trim():'';
 const number=typeof value.student_number==='string'?value.student_number.trim():'';
 if(!name||name.length>80||/[\u0000-\u001f\u007f-\u009f]/.test(name)||!/^\d{4,8}$/.test(number)||!Number.isInteger(value.academic_year)||value.academic_year<2020||value.academic_year>2100||!['middle','high'].includes(value.school_stage)||![1,2,3].includes(value.grade))fail(400,'INVALID_STUDENT','이름, 학번(4~8자리 숫자), 학년도, 학교급과 학년을 확인해 주세요.');
 return {name,student_number:number,academic_year:value.academic_year,school_stage:value.school_stage,grade:value.grade};
}
module.exports={normalizeStudentInput};
