import type {AdminAction,AdminData} from './admin'
import {checked} from './transport'
import {assertStandard,sessionOf,isLoopback} from './model'
import {SchoolSessionAuth} from './schoolSession'
import type {Transport,Health,Student,NewStudentInput,CounselingCase,Backup,Job,AiSettings,Actor} from './types'
import {validateNewStudent} from './students'
import {getAdmissionContext} from './admissions'
const base='/.netlify/functions/'
const STRATEGY_QUALITY='교육적 실행 가능성을 모든 전략의 기준으로 삼는다. 현재 학년의 실제 이수 과목과 확인된 선수 개념으로 수행할 수 있는 준비를 제안한다. 상담에서 정한 실험 축소·기존 자료 재분석 등의 실제 대상·기간·범위를 모든 학년·학기 계획과 학생 준비사항에 보존한다. 특정 과거 탐구의 재분석 합의를 모든 미래 학습·탐구의 금지로 확대하지 않는다. 후반 학년이라는 이유만으로 새 실험·장비·전문 자료·고급 기법을 다시 필수로 넣지 않는다. 진로가 미확정이거나 여러 분야를 탐색 중이면 복수의 탐색 방향과 비교 기준을 유지하고, 의학 등 한 전공으로 고정하거나 적합성을 단정하지 않는다. 심화는 앞으로 배울 개념·관점을 확장하고 자료의 비교 조건을 명료하게 하기, 근거의 질과 자료 선정 이유 설명하기, 결과의 해석과 한계 구분하기, 대안 설명 비교하기의 단계로 구체화한다. 다변량 분석·고급 회귀·임상 진단·응급도 예측이나 최적화는 필수 활동으로 요구하지 않는다. 전문 용어를 나열하거나 난도를 올리는 것으로 심화를 대신하지 않는다. 학생의 통계 사용 경험이 기록되어 있어도 새 고급 기법의 숙련이나 실제 임상 적용 능력을 추정하지 않는다. 외부 자료는 입력에서 기관·문서명·주소 등으로 실제 식별된 자료와 앞으로 찾아볼 자료 후보를 구분한다. 식별되지 않은 자료를 이미 확보한 공공데이터·임상데이터로 표현하거나 실제 수치를 만들어 내지 않는다. 가상·모의자료는 설명용 가상자료라고 표시하고 실제 관찰 결과·공공데이터·검증 결과와 구분한다. 자료 확보가 확인되지 않으면 기존 자료·교과서 예시·문헌의 조건 비교로 가능한 대안을 제시한다. 출력은 한글 평문과 읽기 쉬운 소제목·목록·표를 사용한다. LaTeX 수식·달러 기호 수식 구분자·이모지·장식 기호는 생성하지 않는다. 필요한 수학 개념과 관계는 학생이 설명할 수 있는 문장으로 풀어 쓴다. 분석 과정이나 이러한 작성 규칙 자체를 결과에 넣지 않고 학생에게 필요한 선택 근거·학습 방법·준비 자료만 제시한다.'
const FUTURE_STRATEGY='과거 세특은 이미 수행한 활동의 평가 자료이며 재수행 목록이 아니다. 과거 원자료 찾기·기초 설명 복습만을 준비의 중심으로 삼지 않는다. 확인된 기반을 앞으로 배울 과목·새 개념·다음 탐구 질문으로 연결하고 필요한 준비의 이유와 방법을 설명한다. 실제 이수 과목과 희망·예정 과목, 학교 개설·선수 조건을 확인할 후보를 구분한다. selected_subjects나 과거 기록의 과목명만으로 현재·미래 이수를 확정하지 않는다. 과거 사실·그에 대한 판단·미래 제안을 구분한다. 현재 탐구에서 실험을 반복하지 않기로 한 상담을 모든 미래 과목 학습·새 질문의 금지로 확대하지 않는다. 전체 기간에 적용되는 제약은 그대로 유지하고, 새로운 수업·자료 비교·문헌 질문은 합의와 학교 여건 안에서 선택 가능하게 제안한다. 로드맵은 현재 남은 학기와 이후 학년의 1학기·2학기를 각각 작성한다. 현재 학기가 입력되지 않았다면 날짜나 과거 성적으로 추정하지 않는다. 각 학기는 단계: 학교급 N학년 기간 아래 과목과 선택 조건:, 학습 개념·방법:, 탐구 질문:, 자료 선정·확보 대안:, 준비 결과:, 필요한 도움:, 다음 단계로 이어지는 이유:를 각각 줄바꿈하고 1~2문장으로 구체적으로 설명한다. 왜 준비하는지, 어느 과목에서 어떤 개념을 어떻게 배우는지, 그 학습이 어떤 질문·자료·결과로 발전하는지 연결한다. 자료는 질문에 맞는 선정 기준과 확보가 어려울 때의 대안, 결과물은 담을 질문·근거·해석, 도움은 교사가 확인·설명·피드백할 내용을 적는다. 학기 이름만 바꾼 반복이나 제목·미정·확인 필요만 있는 항목을 만들지 않는다. 끝에 방향을 바꿀 때:로 관심·과목 미개설·자료 접근·희망 전형 변경에 따른 대안을 설명한다. profile.admission_targets의 희망 대학·전공·전형은 부분입력대로 존중하고 없는 학년도·목표를 채우지 않는다. admission_context가 제공되면 출처·모집학년도·reference_only를 확인하여 실제 확인된 참고사항을 과목 선택과 학습·탐구 준비의 이유에 반영한다. 이전 학년도 자료를 지원 연도의 확정 요건으로 쓰지 않으며 자료가 없다고 나머지 전략을 보류하지 않는다. 여러 목표의 공통 학습 기반과 선택 기준을 설명하고 필수과목·지원자격·합격 가능성은 추정하지 않는다.'
const CONSUMER_WRITING='한 문장에는 한 핵심을 담고 주어와 서술어를 가깝게 둔다. 추상적 역량 이름보다 실제 과목·질문·학습 방법을 먼저 설명한다. 전문용어는 처음 사용할 때 쉽게 풀어 쓴다. 판단에는 근거를, 제안에는 준비의 이유를 연결한다. 한 문단은 한 내용을 설명하고 명사화·겹수식·상투어·반복 요약을 줄인다. 필요한 소제목·목록·표는 유지하되 콜론 제목만 나열하지 말고 아래에 온전한 설명을 쓴다. 본문에서 화살표·장식 기호로 논리를 대신하지 않는다. 직접 인용·공식 명칭·단위·수치·조건은 바꾸지 않는다.'
const TOPIC_QUESTION='새로 제안하는 전략 주제(topic)는 결과의 첫 제목으로 제시하고, 학생의 기록·관심·상담과 연결되는 구체적인 탐구 질문 한 문장으로 작성한다. 어떻게·왜·어떤 조건에서를 활용하여 무엇을 비교하거나 설명할지 드러내고, 할 수 있을까? 또는 달라질까?처럼 답을 탐색할 수 있는 완결된 질문으로 끝낸다. 명사형 표제에 물음표만 붙이지 않는다. 답이나 효과를 미리 확정하지 않으며 확인된 자료·학생의 현재 학년·상담에서 정한 범위 안에서 다룰 수 있는 질문을 고른다. 이 질문은 교과·탐구와 아래 여섯 학교생활 영역의 준비 방향을 연결하는 중심 질문이다. 연결 근거가 없는 활동을 억지로 같은 주제로 묶거나 새 활동을 의무화하지 않는다. 새 초안의 제목 제안이며 기존 저장·확정 제목이나 보고서 문서명을 자동 변경하지 않는다.'
const AREA_STRATEGY='교과와 학교생활 영역의 준비 전략을 각각 구체화한다. 과목별 학습 전략은 subject_plan에 해당하는 교과 전략으로 설명하고, 활동 전략 activity_plan의 상위 제목은 창체·봉사·독서·행동특성 전략으로 쓴다. 새 전략 필드를 추가하지 말고 기존 9개 전략 문자열 구조를 유지한다. activity_plan에 해당하는 본문은 다음 여섯 블록을 이 순서로 모두 작성한다: 영역: 자율·자치활동; 영역: 동아리활동; 영역: 진로활동; 영역: 봉사활동; 영역: 독서활동; 영역: 행동특성 및 종합의견. 각 영역 제목은 독립된 줄로 쓰고 그 아래에 현재 근거:, 준비 방향:, 준비할 자료·결과물:, 필요한 도움:, 연결할 교과·탐구: 항목을 각각 줄을 나누어 작성한다. 각 항목에는 해당 학생의 근거와 상황에 맞는 구체적인 설명을 담으며 동일한 계획을 여섯 영역에 복사하지 않는다. 기록이 없는 영역도 생략하지 않는다. 현재 근거에는 제공된 자료에서 해당 경험이 확인되지 않는다는 범위만 간결히 밝히고, 준비 방향에는 현재 관심·수업·기존 자료 안에서 선택할 수 있는 조건부 준비와 대안을 제안한다. 기록 부재를 성취 부족·약점·성격으로 해석하지 않고, 결과물은 앞으로 준비할 자료임을 구분한다. 미확인 목록만 나열하지 말고 필요한 도움과 수업·탐구 연결도 설명한다. 자율·자치는 기존 학급의 공동 문제를 살펴보는 질문·의견 수렴·협의 자료처럼 실제 여건에서 가능한 준비를, 동아리는 확인된 기존 관심·활동을 발전시키는 자료 비교·역할·탐구 방법을 제안한다. 진로활동은 미확정인 복수 진로를 유지하며 분야별 질문과 선택 기준을 비교하고, 봉사활동은 실제 필요와 참여 가능 조건을 먼저 확인하여 상대방의 필요를 이해할 자료와 기존 학교생활에서 가능한 대안을 제시한다. 독서활동은 탐구에서 생긴 질문, 읽을 자료의 선정 기준, 읽은 뒤 기존 생각이나 자료를 어떻게 재해석할지를 연결한다. 확인되지 않은 책을 이미 읽은 것으로 쓰거나 독서량을 임의로 할당하지 않는다. 행동특성 및 종합의견은 성격을 판정하는 대신 관찰 가능한 협력·책임·피드백의 사례를 돌아볼 기준, 학생이 준비할 자기 설명과 필요한 지원을 제안한다. 여섯 영역을 다룬다는 이유로 모든 영역의 새 활동 참여를 의무화하지 않는다. 기존 자료와 상담에서 정한 범위·제약을 우선하며 담당 교사에게 확인할 도움과 접근 가능한 대안을 제시한다. 학교생활기록부 기재용 문구를 대필하거나 수행하지 않은 실적을 만들지 않는다. 봉사 시간을 할당하지 않고 입시 반영 여부나 대학 평가상의 유불리를 단정하지 않는다. 이 지침 자체나 내부 필드명은 학생이 읽는 결과 설명에 노출하지 않는다.'
export class CloudTransport implements Transport {
 readonly mode='online' as const
 private auth:SchoolSessionAuth|undefined
 async admin(){return this.request<AdminData>('counseling-admin')}
 async administer(input:AdminAction){if(input.action==='role'&&input.role!=='student')throw new Error('학생의 상담 참여 권한만 변경할 수 있습니다. 교직원은 학교 회원 승인으로 자동 이용합니다.');return this.request<{ok?:boolean;student_id?:string}>('counseling-admin','POST',input)}
 private async authenticatedFetch(path:string,options:RequestInit={}):Promise<Response>{
  const auth=this.auth??=new SchoolSessionAuth(localStorage)
  let token=await auth.token()
  const send=()=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin'})
  let response=await send()
  if(response.status===401){token=await auth.token(true,token);response=await send()}
  return checked(response)
 }
 private async request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{const r=await this.authenticatedFetch(path,{method,...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});return r.json() as Promise<T>}
 private path(id?:string,action?:string){const q=new URLSearchParams();if(id)q.set('id',id);if(action)q.set('action',action);return 'counseling-cases'+(q.size?'?'+q:'')}
 async health(signal?:AbortSignal):Promise<Health>{const data=await this.request<{user:Actor;ai:{server:boolean};students:Student[]}>('counseling-session','GET',undefined,signal);return {mode:'online',demo:false,teacher:data.user.role==='teacher'?data.user:null,user:data.user,students:data.students,ai:data.ai,ollama:{available:false,models:[]}}}
 authenticate(_token:string){return this.health()}
 async list(signal?:AbortSignal){return(await this.request<{cases:CounselingCase[]}>(this.path(), 'GET',undefined,signal)).cases}
 async get(id:string){return(await this.request<{case:CounselingCase}>(this.path(id))).case}
 async addStudent(input:NewStudentInput){return(await this.request<{student:Student}>('counseling-students','POST',validateNewStudent(input))).student}
 async create(student:Student,teacher:string){return(await this.request<{case:CounselingCase}>(this.path(),'POST',{student:{student_id:student.student_id},teacher:{display_name:teacher}})).case}
 async save(value:CounselingCase){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id),'PUT',{case:value})).case}
 async deleteCase(value:CounselingCase){assertStandard(value);await this.request(this.path(value.id),'DELETE',{revision:value.revision})}
 async next(value:CounselingCase){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'next'),'POST',{revision:value.revision})).case}
 async importBackup(bundle:Backup){assertStandard(bundle.case);return(await this.request<{case:CounselingCase}>(this.path(undefined,'import'),'POST',{bundle,student_id:bundle.case.student.student_id,student_confirmed:true})).case}
 private async blob(path:string){return(await this.authenticatedFetch(path)).blob()}
 exportBackup(id:string){return this.blob(this.path(id,'export'))}
 report(id:string,sessionId:string,audience:'student'|'teacher'|'analysis'='teacher'){if(audience==='analysis')return Promise.reject(new Error('학생부 분석 보고서는 이 PC의 로컬 전략실에서 저장해 주세요.'));return this.blob(this.path(id,'report')+'&session_id='+encodeURIComponent(sessionId)+'&audience='+audience)}
 private restricted():never {throw new Error('학생부 분석은 교사 PC의 로컬 상담실에서만 사용할 수 있습니다.')}
 async upload():Promise<CounselingCase>{return this.restricted()}
 async updateRecordMetadata():Promise<CounselingCase>{return this.restricted()}
 async analyze():Promise<Job>{return this.restricted()}
 async review(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'review'),'POST',{revision:value.revision,session_id:sessionId})).case}
 async prepare(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'prepare'),'POST',{revision:value.revision,session_id:sessionId})).case}
  async confirm(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'confirm'),'POST',{revision:value.revision,session_id:sessionId,review_acknowledged:true})).case}
  async publish(value:CounselingCase,sessionId:string){assertStandard(value);const session=sessionOf(value,sessionId);if(!session.confirmed)throw new Error('전략을 검토하고 교사 확정을 먼저 완료해 주세요.');if(session.guidance)throw new Error('이미 학생에게 안내한 전략입니다. 개정은 새 회차에서 진행해 주세요.');return(await this.request<{case:CounselingCase}>(this.path(value.id,'publish'),'POST',{revision:value.revision,session_id:sessionId})).case}
 async job():Promise<Job>{return this.restricted()}
 async cancel():Promise<Job>{return this.restricted()}
 async fixtures(){return []}
 async fixture():Promise<Blob>{return this.restricted()}
 async generalAi(_value:CounselingCase,_sessionId:string,_settings:AiSettings,_signal?:AbortSignal):Promise<string>{
  throw new Error('개인정보 보호를 위해 로컬 전략실의 비식별 학종 전략 생성을 사용해 주세요.')
 }

}
export const AI_SETTINGS_KEY='daeryun-counseling:ai:v1'
export function loadAiSettings():AiSettings{try{return {...defaultSettings(),...JSON.parse(localStorage.getItem(AI_SETTINGS_KEY)||'{}')}}catch{return defaultSettings()}}
export function defaultSettings():AiSettings{return {provider:'server',model:'',apiKey:'',ollamaUrl:'http://127.0.0.1:11434'}}
export function saveAiSettings(settings:AiSettings):void{localStorage.setItem(AI_SETTINGS_KEY,JSON.stringify(settings))}
