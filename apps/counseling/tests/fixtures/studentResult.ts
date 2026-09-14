import {syntheticCase} from './intuitive'
import {readFileSync} from 'node:fs'
import {adoptSchoolTask,adoptSchoolActivity,type SchoolContext} from '../../src/lib/schoolContext'

export function finalCase(teacherRefined=false){
 const value=syntheticCase(),s=value.sessions[0]!,data:SchoolContext=JSON.parse(readFileSync(new URL('../../src/data/school-context.json',import.meta.url),'utf8'))
 value.student.name='합성 최종결과 검증';s.topic='교내 환경 문제를 근거로 설명하는 연습'
 const task=data.assessments.find(t=>t.ai_status==='prohibited'&&t.subject==='화법과 언어')!
 if(!task)throw new Error('The reviewed school assignment fixture is missing')
 s.strategy!.target_major='환경 분야 탐색'
 s.strategy!.target_path='교내 환경 문제에 대한 서로 다른 주장과 근거를 비교하며 관심을 확인한다.'
 s.strategy!.strengths='상담에서 확인한 합성 활동지에서 주장과 근거를 구분했다. 이번에는 자료 선택 이유까지 설명한다.'
 s.strategy!.gaps='설명문에서 반대 근거를 다루지 않은 부분을 확인했다. 반대 근거와 자신의 판단을 함께 적는다.'
 s.strategy!.subject_plan='화법과 언어 수업에서 허용한 자료를 활용해 교내 환경 문제의 찬반 근거를 비교한다. 선택한 근거가 주장을 뒷받침하는지 활동지로 점검한다.'
 s.strategy!.inquiry_plan='질문: 같은 환경 문제를 다르게 설명하는 이유는 무엇인가?\n방법: 자료에 제시된 조건과 근거를 비교한다.\n산출물: 찬반 근거 비교표.\n점검 기준: 근거의 출처와 반대 의견에 대한 설명.'
 s.strategy=adoptSchoolTask(task,s.strategy!)
 const activity=data.activities.find(a=>a.title==='개인 성장 목표의 실천 일지와 경험 공유')!
 if(!activity)throw new Error('The reviewed school activity fixture is missing')
 s.strategy=adoptSchoolActivity(activity,s.strategy!,{student:value.student,semester:2,weekly_minutes:0})
 s.strategy.student_message='이번에는 현재 수업에서 허용한 자료로 찬반 근거 비교표를 작성해 주세요. 비교표와 설명문을 가지고 아래 점검일에 근거 선택 이유를 함께 확인하겠습니다.'
 s.strategy.semester_plan='이번 학기에는 수업 자료의 비교와 피드백 반영에 집중한다. 다음 탐구는 비교표 점검 후 범위를 정한다.'
 s.actions=[{id:'result-one',text:'화법과 언어 수업 자료로 찬반 근거 비교표와 설명문을 작성한다. AI 활용 금지 조건을 지키고, 점검 때 자료 선택 이유와 반대 근거를 설명한다.',due_date:'2026-09-21',status:'planned'},{id:'result-two',text:'학급 활동의 운영·참여 가능 여부를 확인한다. 참여가 가능하면 기존 활동 시간 안에서 맡을 역할과 성장 활동 일지의 피드백 방식을 정한다.',due_date:'',status:'planned'}]
 s.next_date='2026-09-28'
 s.preparation={prepared_at:'2026-09-14T00:00:00Z',prepared_by:'synthetic',topic:'상담 전 비공개표식',strategy:{...s.strategy,subject_plan:'상담 전 비공개표식: 별도 실험을 먼저 제안함'},actions:[]}
 s.consultation={status:'completed',date:'2026-09-14',student_response:'상담 비공개표식: 추가 시간이 부족함',agreed_direction:'별도 실험을 현재 수업 자료 비교로 바꾸기로 합의함',adjustments:'실험 준비를 제외하고 비교표에 집중함',summary:''}
 if(teacherRefined){
  // A teacher-authored synthetic final revision after consultation, not an AI
  // or automatic adoption result. Preserve every original school condition.
  s.strategy.subject_plan=s.strategy.subject_plan.replace(/^선택 이유[^:\n]*:.*$/m,'선택 이유: 주장과 근거를 구분한 강점을 활용해 교내 환경 논제의 찬반 근거를 비교하려고 선택했습니다.').replace(/^할 일\(제안\):.*$/m,'이번 할 일: 수업에서 허용한 자료로 찬반 근거 비교표와 설명문을 작성하고, 선택한 근거와 반대 의견을 함께 설명합니다.')
  s.strategy.activity_plan=s.strategy.activity_plan.replace(/^선택 이유[^:\n]*:.*$/m,'선택 이유: 피드백을 반영해 설명을 고친 과정을 돌아보기 위해 성장 활동 일지의 방식을 참고합니다.').replace(/^할 일\(제안\):.*$/m,'이번 할 일: 활동 운영·참여 가능 여부를 먼저 확인하고, 가능하면 기존 활동 시간에 맡을 역할과 일지의 피드백 방식을 정합니다.')
 }
 return value
}
