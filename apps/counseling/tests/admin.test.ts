import test from 'node:test'
import assert from 'node:assert/strict'
import {validateAdminAction,type AdminData,type AdminAction} from '../src/lib/admin'
import {CloudTransport} from '../src/lib/cloudTransport'
const teacher='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333'
const fixture=():AdminData=>({users:[{id:teacher,name:'합성교사',role:'교사',approved:true},{id:student,name:'합성학생',role:'학생',approved:true}],roles:[{user_id:teacher,role:'teacher',approved:true}],students:[{id:sid,user_id:student,name:'합성학생',active:true}],numbers:[{student_id:sid,academic_year:2026,student_number:'10101',school_stage:'high',grade:1}],assignments:[]})
test('manager screen only changes student grants and cannot override automatic staff access',()=>{
 for(const input of [{action:'role',user_id:student,role:'teacher',approved:true},{action:'role',user_id:teacher,role:'student',approved:true},{action:'role',user_id:teacher,role:'manager',approved:true}])assert.throws(()=>validateAdminAction(input as AdminAction,fixture()),/일치/)
 for(const approved of [true,false])assert.throws(()=>validateAdminAction({action:'role',user_id:teacher,role:'teacher',approved},fixture()),/자동 이용/)
 const data=fixture();data.users[1]!.approved=false
 assert.throws(()=>validateAdminAction({action:'role',user_id:student,role:'student',approved:true},data),/학교 회원 승인/)
 assert.doesNotThrow(()=>validateAdminAction({action:'role',user_id:student,role:'student',approved:false},data))
 data.users[1]!.approved=true
 assert.doesNotThrow(()=>validateAdminAction({action:'role',user_id:student,role:'student',approved:true},data))
})
test('student registration preserves the existing student ID and rejects malformed or duplicate numbers',()=>{const input:AdminAction={action:'student',user_id:student,student_id:sid,academic_year:2027,student_number:'20101',school_stage:'high',grade:2,name:'합성학생'};assert.doesNotThrow(()=>validateAdminAction(input,fixture()));assert.throws(()=>validateAdminAction({...input,student_id:teacher},fixture()),/연결/);assert.throws(()=>validateAdminAction({...input,student_number:'ABC'},fixture()),/학번/);assert.throws(()=>validateAdminAction({...input,academic_year:1900},fixture()),/학년도/);const data=fixture();data.numbers.push({...data.numbers[0]!,student_id:teacher,academic_year:2027,student_number:'20101'});assert.throws(()=>validateAdminAction(input,data),/이미 등록/);assert.throws(()=>validateAdminAction({...input,user_id:teacher},fixture()),/학생 계정/)})
test('active assignments use school-approved teachers without separate grants',()=>{
 const input:AdminAction={action:'assign',student_id:sid,teacher_user_id:teacher,active:true},data=fixture()
 data.roles=[];assert.doesNotThrow(()=>validateAdminAction(input,data))
 data.roles=[{user_id:teacher,role:'teacher',approved:false}];assert.doesNotThrow(()=>validateAdminAction(input,data))
 data.users[0]!.approved=false;assert.throws(()=>validateAdminAction(input,data),/학교 회원 승인/)
 data.users[0]!.approved=true;data.users[0]!.role='학생';assert.throws(()=>validateAdminAction(input,data),/학교 회원 승인/)
 data.users[0]!.role='교사';data.students[0]!.active=false;assert.throws(()=>validateAdminAction(input,data),/활성 학생/)
 assert.throws(()=>validateAdminAction({...input,active:false},data),/등록된 담당 관계/)
 data.assignments.push({student_id:sid,teacher_user_id:teacher,active:true});assert.doesNotThrow(()=>validateAdminAction({...input,active:false},data))
})
test('cloud transport refuses staff overrides and manager elevation before any network call',async()=>{for(const role of ['teacher','manager'])await assert.rejects(new CloudTransport().administer({action:'role',user_id:teacher,role,approved:true} as unknown as AdminAction),/학생의 상담/)})
