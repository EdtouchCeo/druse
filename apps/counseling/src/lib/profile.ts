import type {AdmissionTarget,GradeRecord,StudentProfile,Strategy} from './types'

export const profileFields=[
 {key:'target_major',label:'관심 전공·계열',hint:'미정이면 탐색 중인 계열이나 질문을 적습니다.'},
 {key:'interests',label:'관심 주제',hint:'학생이 궁금해하는 문제, 좋아하는 수업 주제를 적습니다.'},
 {key:'learning_concerns',label:'학습 고민',hint:'학생이 말한 어려움과 도움을 받고 싶은 상황을 기록합니다.'},
 {key:'study_habits',label:'학습 습관',hint:'실제 공부 방법과 시간을 적고, 효과는 학생과 확인합니다.'},
 {key:'activities',label:'활동 경험',hint:'참여한 활동, 학생의 역할과 확인 가능한 결과를 적습니다.'},
 {key:'reading',label:'읽기 경험',hint:'읽은 자료와 생긴 질문을 적습니다. 책 제목만으로 성취를 판단하지 않습니다.'},
 {key:'attendance_notes',label:'출결 참고',hint:'필요한 경우 확인한 상황만 기록합니다. 빈칸은 문제가 있다는 뜻이 아닙니다.'},
 {key:'teacher_observations',label:'교사 관찰',hint:'관찰한 행동과 근거, 추가 확인이 필요한 해석을 구분합니다.'},
] as const satisfies readonly {key:keyof StudentProfile;label:string;hint:string}[]
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function emptyProfile():StudentProfile{return {target_major:'',interests:'',learning_concerns:'',study_habits:'',activities:'',reading:'',attendance_notes:'',teacher_observations:'',selected_subjects:[],weekly_minutes:null,grades:[],admission_targets:[]}}
const admissionTextFields={university:200,major:200,admission_type:100,admission_name:200} as const
export function newAdmissionTarget():AdmissionTarget{return {id:crypto.randomUUID(),university:'',major:'',admission_type:'',admission_name:'',admission_year:null}}
export function hasAdmissionTarget(row:AdmissionTarget):boolean{return Object.keys(admissionTextFields).some(key=>row[key as keyof typeof admissionTextFields].trim())||row.admission_year!==null}
export function admissionTargetSummary(row:AdmissionTarget):string{return [row.university,row.major,row.admission_type,row.admission_name,row.admission_year===null?'':row.admission_year+'학년도 대입'].filter(value=>value.trim()).join(' · ')}
export function admissionTargetIssues(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>12)return ['희망 대학·전공은 최대 12개 항목으로 입력해 주세요.']
 const issues:string[]=[],ids=new Set<string>()
 for(const [index,row] of value.entries()){
  const label=`희망 ${index+1}`
  if(!row||typeof row!=='object'||Array.isArray(row)){issues.push(label+'의 대학·전공 정보를 확인해 주세요.');continue}
  if(Object.keys(row).some(key=>!['id','admission_year',...Object.keys(admissionTextFields)].includes(key)))issues.push(label+'에 허용하지 않은 항목이 있습니다.')
  if(typeof row.id!=='string'||!uuid.test(row.id)||ids.has(row.id.toLowerCase()))issues.push(label+'의 식별자나 중복을 확인해 주세요.')
  else ids.add(row.id.toLowerCase())
  for(const [key,limit] of Object.entries(admissionTextFields))if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>limit||row[key].includes('\0')))issues.push(label+`의 대학·전공·전형은 읽을 수 없는 문자 없이 ${key==='admission_type'?100:200}자 이내로 입력해 주세요.`)
  if(row.admission_year!==undefined&&row.admission_year!==null&&(!Number.isInteger(row.admission_year)||row.admission_year<1990||row.admission_year>2100))issues.push(label+'의 대입 학년도는 1990~2100 범위의 정수로 입력하거나 비워 두세요.')
 }
 return issues
}
export function profileIssues(profile:StudentProfile):string[]{
 const issues:string[]=[]
 issues.push(...admissionTargetIssues(profile.admission_targets))
 for(const field of profileFields)if(typeof profile[field.key]!=='string'||(profile[field.key] as string).length>6000||(profile[field.key] as string).includes('\0'))issues.push(field.label+'는 특수 제어 문자 없이 6,000자 이내의 글로 작성해 주세요.')
 if(!Array.isArray(profile.selected_subjects)||profile.selected_subjects.length>20||profile.selected_subjects.some(s=>typeof s!=='string'||!s.trim()||s.length>100||s.includes('\0')))issues.push('이수 과목은 과목당 100자 이내, 최대 20개로 입력해 주세요.')
 else if(new Set(profile.selected_subjects.map(s=>s.trim())).size!==profile.selected_subjects.length)issues.push('이수 과목이 중복되었습니다. 같은 과목은 한 번만 입력해 주세요.')
 if(profile.weekly_minutes!==null&&(!Number.isInteger(profile.weekly_minutes)||profile.weekly_minutes<0||profile.weekly_minutes>2400))issues.push('주간 가용 시간은 미확인 또는 0~2,400분의 정수로 입력해 주세요.')
 if(!Array.isArray(profile.grades)||profile.grades.length>60){issues.push('성적 기록은 최대 60개입니다.');return issues}
 const ids=new Set<string>()
 for(const [i,grade] of profile.grades.entries()){
  if(!grade||typeof grade!=='object'){issues.push(`${i+1}번째 성적 기록을 확인해 주세요.`);continue}
  const label=`성적 ${i+1}`
  if(Object.keys(grade).some(key=>!['id','subject','academic_year','semester','grade_scale','rank_grade','score','achievement'].includes(key)))issues.push(label+'에 허용하지 않은 항목이 있습니다.')
  if(typeof grade.id!=='string'||!uuid.test(grade.id)||ids.has(grade.id))issues.push(label+'의 식별자를 확인해 주세요.');ids.add(grade.id)
  if(typeof grade.subject!=='string'||grade.subject.length>100||grade.subject.includes('\0'))issues.push(label+'의 과목을 100자 이내로 입력해 주세요.')
  if(!Number.isInteger(grade.academic_year)||grade.academic_year<1990||grade.academic_year>2100||![1,2].includes(grade.semester))issues.push(label+'의 학년도와 학기를 확인해 주세요.')
  if(!['5','9','achievement','unknown'].includes(grade.grade_scale))issues.push(label+'의 등급 체계를 확인해 주세요.')
  if(grade.rank_grade!==null&&(!['5','9'].includes(grade.grade_scale)||!Number.isInteger(grade.rank_grade)||grade.rank_grade<1||grade.rank_grade>Number(grade.grade_scale)))issues.push(label+'의 석차등급은 선택한 5·9등급제 범위의 정수만 입력할 수 있습니다.')
  if(grade.score!==null&&(typeof grade.score!=='number'||!Number.isFinite(grade.score)||grade.score<0||grade.score>100))issues.push(label+'의 원점수는 0~100 또는 미확인으로 입력해 주세요.')
  if(typeof grade.achievement!=='string'||grade.achievement.length>20||grade.achievement.includes('\0'))issues.push(label+'의 성취도는 20자 이내로 입력해 주세요.')
 }
 return issues
}
export function normalizeProfile(value:unknown):StudentProfile{
 if(value===undefined)return emptyProfile()
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('학생 기본자료 형식을 확인해 주세요.')
 if(Object.keys(value).some(key=>!(key in emptyProfile())))throw new Error('학생 기본자료에 허용하지 않은 항목이 있습니다.')
 const profile={...emptyProfile(),...value} as StudentProfile
 const issues=profileIssues(profile);if(issues.length)throw new Error(issues[0])
 profile.admission_targets=profile.admission_targets.map(row=>Object.assign({university:'',major:'',admission_type:'',admission_name:'',admission_year:null},row))
 return JSON.parse(JSON.stringify(profile)) as StudentProfile
}
export function newGrade(year:number):GradeRecord{return {id:crypto.randomUUID(),subject:'',academic_year:year,semester:1,grade_scale:'unknown',rank_grade:null,score:null,achievement:''}}
export function hasGradeData(row:GradeRecord):boolean{return Boolean(row.subject.trim()&&(row.rank_grade!==null||row.score!==null||row.achievement.trim()))}
export function gradeScaleLabel(scale:GradeRecord['grade_scale']):string{return scale==='5'?'5등급제':scale==='9'?'9등급제':scale==='achievement'?'성취도':'체계 미확인'}
export type GradeTrend={subject:string;scale:string;records:GradeRecord[];description:string}
export function gradeTrends(profile:StudentProfile):GradeTrend[]{
 const groups=new Map<string,GradeRecord[]>()
 for(const row of profile.grades){if(!row.subject.trim()||!Number.isInteger(row.academic_year)||row.academic_year<1990||row.academic_year>2100||![1,2].includes(row.semester)||!['5','9'].includes(row.grade_scale)||row.rank_grade===null||!Number.isInteger(row.rank_grade)||row.rank_grade<1||row.rank_grade>Number(row.grade_scale))continue;const key=row.subject.trim()+'\0'+row.grade_scale;groups.set(key,[...(groups.get(key)||[]),row])}
 return [...groups.values()].map(rows=>{const records=[...rows].sort((a,b)=>a.academic_year-b.academic_year||a.semester-b.semester);const periods=records.map(r=>r.academic_year+'-'+r.semester);const duplicate=new Set(periods).size!==periods.length;const last=records.at(-1)!,first=records.at(-2);let description='같은 과목·같은 등급 체계의 다른 학기 기록이 추가되면 비교합니다.';if(duplicate)description='같은 학기 기록이 중복되어 추이를 연결하지 않습니다. 원자료를 확인하세요.';else if(first){const delta=last.rank_grade!-first.rank_grade!;description=`${first.academic_year}년 ${first.semester}학기 ${first.rank_grade} → ${last.academic_year}년 ${last.semester}학기 ${last.rank_grade}등급 · ${delta===0?'등급 숫자 동일':`등급 숫자 ${Math.abs(delta)} ${delta<0?'낮아짐':'높아짐'}`}`}return {subject:last.subject,scale:gradeScaleLabel(last.grade_scale),records,description}})
}
export type ProfileQuestion={id:string;source:string;evidence:string;question:string}
const quote=(text:string)=>text.trim().slice(0,120)+(text.trim().length>120?'…':'')
export function profileQuestions(profile:StudentProfile):ProfileQuestion[]{
 const questions:ProfileQuestion[]=[]
 const add=(id:string,source:string,evidence:string,question:string)=>questions.push({id,source,evidence:quote(evidence),question})
 if(profile.target_major.trim())add('major','입력 · 관심 전공·계열',profile.target_major,'이 전공·계열에 관심을 갖게 된 수업이나 경험은 무엇인가요?')
 const admissions=profile.admission_targets.filter(hasAdmissionTarget)
 if(admissions.length)add('admission','입력 · 희망 대학·전공·전형',admissions.map(admissionTargetSummary).join('\n'),'희망 대학과 전공을 고른 이유는 무엇이며, 해당 대입 학년도의 모집단위·전형 조건은 어디까지 확인했나요?')
 if(profile.interests.trim())add('interest','입력 · 관심 주제',profile.interests,'이 주제에서 직접 확인하고 싶은 질문 하나를 고른다면 무엇인가요?')
 if(profile.selected_subjects.length)add('subject','입력 · 이수 과목',profile.selected_subjects.join(', '),'이 과목에서 실제로 배우는 내용과 현재 과제의 학기·마감·허용 조건은 무엇인가요?')
 if(profile.grades.length){const row=[...profile.grades].filter(hasGradeData).sort((a,b)=>b.academic_year-a.academic_year||b.semester-a.semester)[0];if(row)add('grade','입력 · 성적 기록',`${row.academic_year}학년도 ${row.semester}학기 ${row.subject} · ${gradeScaleLabel(row.grade_scale)} · 석차등급 ${row.rank_grade??'미확인'} / 원점수 ${row.score??'미확인'}`,'어떤 단원과 평가에서 이해가 쉬웠거나 어려웠나요? 당시 공부 방법과 함께 확인해 볼까요?')}
 if(profile.learning_concerns.trim())add('concern','입력 · 학습 고민',profile.learning_concerns,'이 고민이 나타나는 구체적인 상황과 이미 시도한 방법은 무엇인가요?')
 if(profile.study_habits.trim())add('habit','입력 · 학습 습관',profile.study_habits,'이 방법을 언제 사용하며, 이해에 도움이 된 사례를 확인할 수 있나요?')
 if(profile.activities.trim())add('activity','입력 · 활동 경험',profile.activities,'학생이 맡은 역할과 직접 만든 결과물, 받은 피드백은 무엇인가요?')
 if(profile.reading.trim())add('reading','입력 · 읽기 경험',profile.reading,'읽은 내용에서 남은 질문을 수업이나 탐구와 어떻게 이어 볼 수 있나요?')
 if(profile.teacher_observations.trim())add('observation','입력 · 교사 관찰',profile.teacher_observations,'관찰한 행동이 나타난 상황과 학생의 설명이 일치하는지 확인했나요?')
 const priority=['concern','grade','activity','habit','observation','interest','major','admission','subject','reading'];return questions.sort((a,b)=>priority.indexOf(a.id)-priority.indexOf(b.id))
}
export function missingProfile(profile:StudentProfile):string[]{const missing=[];if(!profile.target_major.trim()&&!profile.interests.trim())missing.push('학생의 관심과 진로 탐색 방향');if(!profile.selected_subjects.length)missing.push('실제 이수 과목');if(!profile.grades.some(hasGradeData))missing.push('과목별 성적과 등급 체계');if(!profile.activities.trim())missing.push('활동에서 맡은 역할과 확인 자료');if(!profile.learning_concerns.trim()&&!profile.study_habits.trim())missing.push('학습 경험과 필요한 도움');return missing}
export function profileDraft(profile:StudentProfile):Partial<Strategy>{
 const next:Partial<Strategy>={}
 if(profile.target_major.trim())next.target_major=profile.target_major.trim()
 const admissions=profile.admission_targets.filter(hasAdmissionTarget)
 if(admissions.length)next.target_major=[next.target_major,...admissions.map(row=>'희망(입력): '+admissionTargetSummary(row))].filter(Boolean).join('\n')
 if(profile.interests.trim()){next.target_path=`관심 주제: ${profile.interests.trim()}`;next.inquiry_plan=`관심 주제(입력): ${quote(profile.interests)}\n선택 이유(확인 필요): 입력한 관심과 현재 수업의 연결을 확인합니다.\n실행 초안: 관심과 연결되는 수업 자료에 출처·근거를 표시해 탐구 질문으로 좁힙니다.\n산출물 후보(예시): 질문·근거를 정리한 비교표 또는 짧은 설명.\n점검 기준(제안): 표시한 근거로 질문에 답할 수 있는지 교사 피드백과 대조합니다.\n탐구 질문·학교 과제·사용 자료·허용 조건은 교사와 확인할 사항입니다.`}
 if(profile.selected_subjects.length)next.subject_plan=`대상 과목(입력): ${profile.selected_subjects.join(', ')}\n선택 이유: 입력한 이수 과목에서 준비할 내용을 고르는 초안입니다.\n실행 초안: 배운 개념을 수업 사례와 연결해 설명하고, 근거를 수업 자료에 표시합니다.\n산출물 후보(예시): 개념·사례·근거를 적은 짧은 설명.\n점검 기준(제안): 개념과 사례의 연결을 표시한 근거로 설명할 수 있는지 확인합니다.\n실제 단원·학교 과제·제출 조건은 담당 교사와 확인할 사항입니다.`
 if(profile.activities.trim())next.activity_plan=`입력한 활동 경험(근거 확인 필요): ${profile.activities.trim()}\n실행 초안: 기존 자료에 자신이 한 역할·과정·피드백을 표시하고 다음 할 일과 구분합니다.\n산출물 후보(예시): 기존 작업 자료에 붙인 역할·근거 설명.\n점검 기준(제안): 자료에서 자신의 역할과 피드백으로 고친 부분을 설명합니다.\n실제 참여·성과와 후속 범위는 근거를 확인한 뒤 정하며, 새 활동 일지나 제출 의무를 부여하지 않습니다.`
 if(Object.keys(next).length)next.semester_plan='먼저 시도할 과제와 확인할 산출물을 선택합니다. 교사 피드백으로 다음 범위를 정하고, 구체적인 시간 계획은 학생 본인이 세웁니다.'
 // Retain an explicitly saved no-extra-work constraint without reviving time allocation.
 if(profile.weekly_minutes===0){for(const key of ['subject_plan','inquiry_plan','activity_plan','semester_plan'] as const)if(next[key])next[key]+='\n기존 수업·활동 안에서 가능한 범위로 정합니다.'}
 return next
}
export function adoptProfile(profile:StudentProfile,strategy:Strategy):Strategy{const copy={...strategy};for(const [key,value] of Object.entries(profileDraft(profile)) as [keyof Strategy,string][])if(!copy[key].trim())copy[key]=value;return copy}
