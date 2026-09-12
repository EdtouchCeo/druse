export type ManagedUser={id:string;name:string;role:string;approved:boolean}
export type AdminData={users:ManagedUser[];roles:{user_id:string;role:string;approved:boolean}[];students:{id:string;user_id:string;name:string;active:boolean}[];numbers:{student_id:string;academic_year:number;student_number:string;school_stage:'middle'|'high';grade:number}[];assignments:{student_id:string;teacher_user_id:string;active:boolean}[]}
export type AdminAction=
 |{action:'role';user_id:string;role:'teacher'|'student';approved:boolean}
 |{action:'student';user_id:string;student_id?:string;student_number:string;academic_year:number;school_stage:'middle'|'high';grade:number;name:string}
 |{action:'assign';student_id:string;teacher_user_id:string;active:boolean}
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function schoolCounselingRole(user?:ManagedUser):'teacher'|'student'|null{return user?.role==='교사'?'teacher':user?.role==='학생'?'student':null}
export function validateAdminAction(input:AdminAction,data:AdminData):void{
 if(input.action==='assign'){
  const student=data.students.find(item=>item.id===input.student_id),teacher=data.users.find(item=>item.id===input.teacher_user_id)
  if(!uuid(input.student_id)||!student||!uuid(input.teacher_user_id)||!teacher||typeof input.active!=='boolean')throw new Error('등록 학생과 담당 교사를 선택해 주세요.')
  if(input.active&&(!student.active||teacher.role!=='교사'||!teacher.approved||!data.roles.some(item=>item.user_id===teacher.id&&item.role==='teacher'&&item.approved)))throw new Error('배정에는 활성 학생과 상담 권한이 승인된 교사가 필요합니다.')
  if(!input.active&&!data.assignments.some(item=>item.student_id===student.id&&item.teacher_user_id===teacher.id))throw new Error('현재 등록된 담당 관계를 선택해 주세요.')
  return
 }
 const user=data.users.find(item=>item.id===input.user_id)
 if(!uuid(input.user_id)||!user)throw new Error('등록된 학교 계정을 선택해 주세요.')
 if(input.action==='role'){
  if(!['teacher','student'].includes(input.role)||schoolCounselingRole(user)!==input.role)throw new Error('학교 계정의 교사·학생 구분과 상담 역할이 일치해야 합니다.')
  if(typeof input.approved!=='boolean'||(input.approved&&!user.approved))throw new Error('학교 회원 승인이 완료된 계정만 상담 참여를 허용할 수 있습니다.')
  return
 }
 if(user.role!=='학생'||!user.approved)throw new Error('학교에서 승인된 학생 계정을 선택해 주세요.')
 const existing=data.students.find(item=>item.user_id===user.id)
 if(input.student_id&&(!uuid(input.student_id)||existing?.id!==input.student_id))throw new Error('기존 학생 연결 정보를 다시 확인해 주세요.')
 if(!/^\d{4,8}$/.test(input.student_number)||!Number.isInteger(input.academic_year)||input.academic_year<2020||input.academic_year>2100||!['middle','high'].includes(input.school_stage)||![1,2,3].includes(input.grade)||!input.name.trim()||input.name.length>80)throw new Error('학생 이름, 학년도, 숫자 4~8자리 학번과 학년을 확인해 주세요.')
 const duplicate=data.numbers.find(item=>item.academic_year===input.academic_year&&item.student_number===input.student_number&&item.student_id!==existing?.id)
 if(duplicate)throw new Error('같은 학년도에 이미 등록된 학번입니다. 해당 학생의 기록을 확인해 주세요.')
}
