import type {NewStudentInput} from './types'

export function validateNewStudent(input:NewStudentInput):NewStudentInput{
 const name=input.name.trim(),student_number=input.student_number.trim()
 if(!name||name.length>80||/[\u0000-\u001f\u007f-\u009f]/.test(name))throw new Error('학생 이름을 줄바꿈 없이 1~80자로 입력해 주세요.')
 if(!/^\d{4,8}$/.test(student_number))throw new Error('학번은 숫자 4~8자리로 입력해 주세요.')
 if(!Number.isInteger(input.academic_year)||input.academic_year<2020||input.academic_year>2100)throw new Error('학년도는 2020~2100년 사이의 정수로 입력해 주세요.')
 if(!['middle','high'].includes(input.school_stage))throw new Error('학교급을 선택해 주세요.')
 if(!Number.isInteger(input.grade)||input.grade<1||input.grade>3)throw new Error('학년은 1~3학년 중 선택해 주세요.')
 return {name,student_number,academic_year:input.academic_year,school_stage:input.school_stage,grade:input.grade}
}
