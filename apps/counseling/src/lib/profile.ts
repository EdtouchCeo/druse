import type {GradeRecord,StudentProfile,Strategy} from './types'

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
export function emptyProfile():StudentProfile{return {target_major:'',interests:'',learning_concerns:'',study_habits:'',activities:'',reading:'',attendance_notes:'',teacher_observations:'',selected_subjects:[],weekly_minutes:null,grades:[]}}
export function profileIssues(profile:StudentProfile):string[]{
 const issues:string[]=[]
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
 if(profile.interests.trim())add('interest','입력 · 관심 주제',profile.interests,'이 주제에서 직접 확인하고 싶은 질문 하나를 고른다면 무엇인가요?')
 if(profile.selected_subjects.length)add('subject','입력 · 이수 과목',profile.selected_subjects.join(', '),'이 과목에서 실제로 배우는 내용과 현재 과제의 학기·마감·허용 조건은 무엇인가요?')
 if(profile.grades.length){const row=[...profile.grades].filter(hasGradeData).sort((a,b)=>b.academic_year-a.academic_year||b.semester-a.semester)[0];if(row)add('grade','입력 · 성적 기록',`${row.academic_year}학년도 ${row.semester}학기 ${row.subject} · ${gradeScaleLabel(row.grade_scale)} · 석차등급 ${row.rank_grade??'미확인'} / 원점수 ${row.score??'미확인'}`,'어떤 단원과 평가에서 이해가 쉬웠거나 어려웠나요? 당시 공부 방법과 함께 확인해 볼까요?')}
 if(profile.learning_concerns.trim())add('concern','입력 · 학습 고민',profile.learning_concerns,'이 고민이 나타나는 구체적인 상황과 이미 시도한 방법은 무엇인가요?')
 if(profile.study_habits.trim())add('habit','입력 · 학습 습관',profile.study_habits,'이 방법을 언제 사용하며, 이해에 도움이 된 사례를 확인할 수 있나요?')
 if(profile.activities.trim())add('activity','입력 · 활동 경험',profile.activities,'학생이 맡은 역할과 직접 만든 결과물, 받은 피드백은 무엇인가요?')
 if(profile.reading.trim())add('reading','입력 · 읽기 경험',profile.reading,'읽은 내용에서 남은 질문을 수업이나 탐구와 어떻게 이어 볼 수 있나요?')
 if(profile.teacher_observations.trim())add('observation','입력 · 교사 관찰',profile.teacher_observations,'관찰한 행동이 나타난 상황과 학생의 설명이 일치하는지 확인했나요?')
 if(profile.weekly_minutes!==null)add('time','입력 · 주간 가용 시간',`${profile.weekly_minutes}분`,profile.weekly_minutes===0?'추가 시간을 요구하지 않고 기존 수업 안에서 점검할 일을 정할 수 있나요?':'학교 일정과 휴식을 고려해 이번 주에 실제로 가능한 과제 하나는 무엇인가요?')
 const priority=['concern','grade','activity','habit','observation','interest','major','subject','reading','time'];return questions.sort((a,b)=>priority.indexOf(a.id)-priority.indexOf(b.id))
}
export function missingProfile(profile:StudentProfile):string[]{const missing=[];if(!profile.target_major.trim()&&!profile.interests.trim())missing.push('학생의 관심과 진로 탐색 방향');if(!profile.selected_subjects.length)missing.push('실제 이수 과목');if(!profile.grades.some(hasGradeData))missing.push('과목별 성적과 등급 체계');if(!profile.activities.trim())missing.push('활동에서 맡은 역할과 확인 자료');if(!profile.learning_concerns.trim()&&!profile.study_habits.trim())missing.push('학습 경험과 필요한 도움');if(profile.weekly_minutes===null)missing.push('주간 가용 시간');return missing}
export function profileDraft(profile:StudentProfile):Partial<Strategy>{
 const next:Partial<Strategy>={}
 if(profile.target_major.trim())next.target_major=profile.target_major.trim()
 if(profile.interests.trim()){next.target_path=`입력한 관심: ${profile.interests.trim()}\n교사는 관련 수업과 활동에서 탐색할 방향을 준비하고 상담에서 학생의 관심과 대조합니다.`;next.inquiry_plan=`교사 준비안: 관심 주제 “${quote(profile.interests)}”를 실제 수업 개념과 연결할 탐구 질문 후보 하나로 좁힙니다. 수업 범위와 허용 조건을 확인해 방법 → 산출물 → 피드백을 계획하고 상담에서 학생과 실행 범위를 조정합니다.`}
 if(profile.selected_subjects.length)next.subject_plan=`입력한 이수 과목: ${profile.selected_subjects.join(', ')}\n교사 준비안: 실제 수업의 개념 하나를 골라 설명·연습·점검으로 이어갈 교과 학습 계획을 세웁니다. 과제의 연도·학기·마감·허용 조건은 원문과 확인한 뒤 반영합니다.`
 if(profile.activities.trim())next.activity_plan=`입력한 활동 경험: ${profile.activities.trim()}\n교사 준비안: 기존 활동의 역할·결과물·피드백을 근거로 이어갈 활동 하나를 검토합니다. 상담에서 학생의 실제 역할과 참여 여건을 확인해 최종 범위를 정합니다.`
 if(profile.weekly_minutes!==null)next.semester_plan=profile.weekly_minutes===0?'추가 가용 시간은 0분으로 입력했습니다. 기존 수업과 활동 안에서 실행·점검할 계획을 준비하며, 추가 활동을 전제하지 않습니다.':`주간 가용 시간은 ${profile.weekly_minutes}분으로 입력했습니다. 교사는 이번 학기에 실행할 과제 하나와 점검 기준을 준비하고, 상담에서 일정과 부담을 확인해 최종 점검일과 이후 학기 계획을 조정합니다.`
 if(profile.weekly_minutes===0){for(const key of ['subject_plan','inquiry_plan','activity_plan'] as const)if(next[key])next[key]+='\n추가 가용 시간 0분: 기존 수업·활동 안에서 가능한 범위로 제한합니다.'}
 return next
}
export function adoptProfile(profile:StudentProfile,strategy:Strategy):Strategy{const copy={...strategy};for(const [key,value] of Object.entries(profileDraft(profile)) as [keyof Strategy,string][])if(!copy[key].trim())copy[key]=value;return copy}
