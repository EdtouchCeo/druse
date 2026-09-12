'use strict';
const textFields=['target_major','interests','learning_concerns','study_habits','activities','reading','attendance_notes','teacher_observations'];
const gradeFields=['id','subject','academic_year','semester','grade_scale','rank_grade','score','achievement'];
function profileOf(session){
 const value=session.profile||{};
 return {...Object.fromEntries(textFields.map(key=>[key,typeof value[key]==='string'?value[key].trim():''])),selected_subjects:Array.isArray(value.selected_subjects)?value.selected_subjects.map(subject=>typeof subject==='string'?subject.trim():subject):[],weekly_minutes:value.weekly_minutes??null,grades:Array.isArray(value.grades)?value.grades.map(row=>Object.fromEntries(gradeFields.map(key=>[key,['id','subject','achievement'].includes(key)&&typeof row[key]==='string'?row[key].trim():row[key]]))):[]};
}
function hasData(profile){return textFields.some(key=>profile[key]!=='')||profile.selected_subjects.length>0||profile.weekly_minutes!==null||profile.grades.length>0;}
function validateProfile(value,{onlyKeys,fail,uuid}){
 if(value===undefined)return;
 onlyKeys(value,[...textFields,'selected_subjects','weekly_minutes','grades']);
 for(const key of textFields)if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>6000||value[key].includes('\0')))fail(400,'INVALID_PROFILE','학생 자료의 서술 항목은 읽을 수 없는 문자 없이 6,000자 이내 문자열로 입력해 주세요.');
 if(value.selected_subjects!==undefined&&(!Array.isArray(value.selected_subjects)||value.selected_subjects.length>20||value.selected_subjects.some(subject=>typeof subject!=='string'||!subject.trim()||subject.length>100||subject.includes('\0'))))fail(400,'INVALID_PROFILE','선택 과목은 빈 이름이나 읽을 수 없는 문자 없이 과목당 100자, 20개 이내로 입력해 주세요.');
 if(value.selected_subjects&&new Set(value.selected_subjects.map(subject=>subject.trim())).size!==value.selected_subjects.length)fail(400,'INVALID_PROFILE','선택 과목의 중복을 확인해 주세요.');
 if(value.weekly_minutes!==undefined&&value.weekly_minutes!==null&&(!Number.isInteger(value.weekly_minutes)||value.weekly_minutes<0||value.weekly_minutes>2400))fail(400,'INVALID_PROFILE','주간 학습 시간은 0~2,400분 정수 또는 미입력으로 지정해 주세요.');
 if(value.grades!==undefined&&(!Array.isArray(value.grades)||value.grades.length>60))fail(400,'INVALID_GRADE','성적 자료는 60개 이내로 입력해 주세요.');
 const ids=new Set();
 for(const grade of value.grades||[]){
  onlyKeys(grade,gradeFields);
  if(typeof grade.id!=='string'||grade.id.length>80||!uuid(grade.id.trim())||ids.has(grade.id.trim())||typeof grade.subject!=='string'||grade.subject.length>100||grade.subject.includes('\0')||!Number.isInteger(grade.academic_year)||grade.academic_year<1990||grade.academic_year>2100||![1,2].includes(grade.semester)||!['5','9','achievement','unknown'].includes(grade.grade_scale)||typeof grade.achievement!=='string'||grade.achievement.length>20||grade.achievement.includes('\0'))fail(400,'INVALID_GRADE','성적 자료의 과목·학년도·학기·평가 척도를 확인해 주세요.');
  const maximum=grade.grade_scale==='5'?5:grade.grade_scale==='9'?9:null;
  if(grade.rank_grade!==null&&(maximum===null||!Number.isInteger(grade.rank_grade)||grade.rank_grade<1||grade.rank_grade>maximum))fail(400,'INVALID_GRADE','석차등급은 해당 5·9등급 척도 안의 정수여야 하며 성취도·미확인 척도에서는 비워 주세요.');
  if(grade.score!==null&&(typeof grade.score!=='number'||!Number.isFinite(grade.score)||grade.score<0||grade.score>100))fail(400,'INVALID_GRADE','점수는 0~100 범위 숫자 또는 미입력으로 지정해 주세요.');
  ids.add(grade.id.trim());
 }
}
module.exports={textFields,gradeFields,profileOf,hasData,validateProfile};
