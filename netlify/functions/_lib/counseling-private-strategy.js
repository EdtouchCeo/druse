'use strict';
// This boundary accepts public vocabulary, never a case, raw record, or free text.
const taxonomy = require('./counseling-private-strategy-taxonomy.json');
const catalogue = require('./counseling-private-strategy-data.json');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
class StrategyError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function reject(code = 'PRIVATE_STRATEGY_INPUT', message = '외부 전략에는 허용된 공개 선택 항목만 전달할 수 있습니다.', status = 400) {
  throw new StrategyError(code, message, status);
}
const own = (object, key) => Object.hasOwn(object, key);
function objectKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject();
  if (required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) reject();
}
function enumeration(value, values) { if (typeof value !== 'string' || !values.includes(value)) reject(); return value; }
function list(value, values, max) {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) reject();
  return value.map(item => enumeration(item, values));
}
function validateRequest(input) {
  objectKeys(input, ['version', 'stage', 'target', 'learner'], ['section_id', 'context_token']);
  if (input.version !== 1) reject();
  const stage = enumeration(input.stage, Object.keys(taxonomy.sections));
  objectKeys(input.target, ['university_id', 'department_id', 'field', 'admission_year']);
  const university_id = enumeration(input.target.university_id, catalogue.universities.map(item => item.id));
  const department_id = enumeration(input.target.department_id, Object.keys(taxonomy.departments));
  const field = enumeration(input.target.field, Object.keys(taxonomy.fields));
  if (taxonomy.departments[department_id].field !== field) reject();
  const admission_year = input.target.admission_year;
  if (admission_year !== null && (!Number.isInteger(admission_year) || admission_year < 2026 || admission_year > 2040)) reject();
  objectKeys(input.learner, ['grade', 'school_stage', 'strengths', 'needs', 'interests', 'subjects'], ['school_opportunities', 'school_constraints']);
  if (![1, 2, 3].includes(input.learner.grade)) reject();
  const learner = {
    grade: input.learner.grade,
    school_stage: enumeration(input.learner.school_stage, ['middle', 'high']),
    strengths: list(input.learner.strengths, Object.keys(taxonomy.competencies), 12),
    needs: list(input.learner.needs, Object.keys(taxonomy.competencies), 12),
    interests: list(input.learner.interests, Object.keys(taxonomy.fields), 5),
    subjects: list(input.learner.subjects, taxonomy.subjects, 12),
    school_opportunities: list(own(input.learner, 'school_opportunities') ? input.learner.school_opportunities : [], Object.keys(taxonomy.school_opportunities), 10),
    school_constraints: list(own(input.learner, 'school_constraints') ? input.learner.school_constraints : [], Object.keys(taxonomy.school_constraints), 4),
  };
  const result = { version: 1, stage, target: { university_id, department_id, field, admission_year }, learner };
  if (own(input, 'section_id')) result.section_id = enumeration(input.section_id, taxonomy.section_ids[stage]);
  if (own(input, 'context_token')) {
    if (stage !== 'inquiry' || typeof input.context_token !== 'string' || input.context_token.length > 24000 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input.context_token)) reject('STRATEGY_CONTEXT_INVALID', '학종 준비 전략의 확인된 연결 자료가 필요합니다.');
    result.context_token = input.context_token;
  }
  return result;
}
function contextSecret() {
  const secret = process.env.COUNSELING_STRATEGY_SIGNING_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GEMINI_API_KEY || process.env.VERTEX_SA_KEY;
  if (!secret) reject('STRATEGY_CONTEXT_CONFIG', '전략 단계 연결 설정이 준비되지 않았습니다.', 503);
  return secret;
}
function contextSignature(body) { return crypto.createHmac('sha256', contextSecret()).update('counseling-private-strategy-v1\n' + body).digest('base64url'); }
function createContextToken(request, section) {
  const context = { version: 1, target: request.target, learner: request.learner, recommendations: section.items.map(({ title, detail, reason, steps }) => ({ title, detail, reason, steps })) };
  const json = Buffer.from(JSON.stringify(context), 'utf8');
  if (json.length > 65536) reject('STRATEGY_CONTEXT_LIMIT', '학종 준비 전략의 연결 자료가 너무 큽니다. 해당 페이지를 다시 작성해 주세요.', 502);
  const body = zlib.deflateRawSync(json).toString('base64url');
  const token = 'v1.' + body + '.' + contextSignature(body);
  if (token.length > 24000) reject('STRATEGY_CONTEXT_LIMIT', '학종 준비 전략의 연결 자료가 너무 큽니다. 해당 페이지를 다시 작성해 주세요.', 502);
  return token;
}
function verifyContextToken(token, request) {
  const [, body, signature] = token.split('.');
  const actual = Buffer.from(signature || '', 'base64url');
  const expected = Buffer.from(contextSignature(body), 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) reject('STRATEGY_CONTEXT_INVALID', '학종 준비 전략의 연결 자료를 확인할 수 없습니다.');
  let value;
  try { value = JSON.parse(zlib.inflateRawSync(Buffer.from(body, 'base64url'), { maxOutputLength: 65536 }).toString('utf8')); }
  catch { reject('STRATEGY_CONTEXT_INVALID', '학종 준비 전략의 연결 자료를 확인할 수 없습니다.'); }
  try {
    objectKeys(value, ['version', 'target', 'learner', 'recommendations']);
    if (value.version !== 1 || JSON.stringify(value.target) !== JSON.stringify(request.target) || JSON.stringify(value.learner) !== JSON.stringify(request.learner)) reject();
    if (!Array.isArray(value.recommendations) || value.recommendations.length < 3 || value.recommendations.length > 8) reject();
    return value.recommendations.map(item => {
      objectKeys(item, ['title', 'detail', 'reason', 'steps']);
      if (!Array.isArray(item.steps) || item.steps.length < 2 || item.steps.length > 8) reject();
      return { title: outputString(item.title, 2, 160), detail: outputString(item.detail, 150, 5000), reason: outputString(item.reason, 60, 2500), steps: item.steps.map(step => outputString(step, 20, 1000)) };
    });
  } catch { reject('STRATEGY_CONTEXT_STALE', '목표나 학습 요약이 달라졌습니다. 학종 준비 전략을 다시 생성한 뒤 연결해 주세요.'); }
}

// These are educational question candidates, not university requirements or student accomplishments.
const questions = {
  medicine: '같은 건강 정보를 서로 다른 자료로 설명할 때 어떤 근거와 한계를 비교해야 할까?',
  biomedical: '생명 현상을 설명하는 모형은 실제 관찰 자료와 어떤 조건에서 일치하거나 달라질까?',
  biology: '같은 생명 현상에 대한 설명이 관찰 조건과 자료에 따라 어떻게 달라질까?',
  nursing: '건강 정보를 이해하기 쉽게 전달하려면 자료의 근거와 상대방의 필요를 어떻게 함께 고려해야 할까?',
  pharmacy: '물질의 성질과 사용 조건을 비교할 때 효과에 대한 설명의 근거와 한계를 어떻게 구분할까?',
  computer_science: '같은 문제를 푸는 두 알고리즘은 입력 조건에 따라 정확성과 처리 과정이 어떻게 달라질까?',
  ai: '같은 분류 문제에서 자료의 구성과 판단 기준을 바꾸면 결과와 오류는 어떻게 달라질까?',
  electrical: '같은 기능을 하는 회로는 구성 조건에 따라 측정값과 에너지 사용이 어떻게 달라질까?',
  mechanical: '같은 기능을 수행하는 구조는 힘의 작용 조건과 재료에 따라 성능이 어떻게 달라질까?',
  chemical: '같은 물질 변화에서 조건을 바꾸면 결과를 설명하는 근거와 한계는 어떻게 달라질까?',
  materials: '같은 용도로 쓰는 재료의 성질과 사용 조건을 어떤 근거로 비교할 수 있을까?',
  civil: '같은 공간 문제에 대한 설계 대안은 안전성과 사용자의 필요를 어떻게 다르게 해결할까?',
  environment: '같은 환경 문제의 해결 방안을 비교할 때 어떤 자료와 조건이 판단을 바꿀까?',
  math: '같은 현상을 서로 다른 수학적 표현으로 나타내면 설명 가능한 범위는 어떻게 달라질까?',
  statistics: '같은 자료라도 표본과 요약 방법을 바꾸면 결론은 어떻게 달라질까?',
  physics: '같은 현상을 설명하는 물리 모형은 가정과 측정 조건에 따라 어디까지 유효할까?',
  chemistry: '물질의 성질을 설명하는 모형은 관찰 조건과 비교 자료에 따라 어떤 한계를 보일까?',
  economics: '같은 경제 현상을 서로 다른 가정과 자료로 설명하면 정책 판단은 어떻게 달라질까?',
  business: '같은 문제를 해결하는 경영 대안은 이해관계자와 판단 기준에 따라 어떻게 달라질까?',
  education: '같은 개념을 서로 다른 설명 방식으로 제시하면 이해를 확인할 근거는 어떻게 달라질까?',
  psychology: '같은 행동에 대한 서로 다른 설명은 어떤 관찰 근거와 연구 한계를 갖고 있을까?',
  law: '같은 사회 문제에서 충돌하는 권리와 공익을 어떤 기준으로 비교할 수 있을까?',
  politics: '같은 공공 문제에 대한 정책 대안은 어떤 근거와 가치 판단에서 차이가 날까?',
  sociology: '같은 사회 현상을 서로 다른 집단과 자료에서 살펴보면 설명은 어떻게 달라질까?',
  languages: '같은 경험을 다른 표현과 관점으로 서술하면 의미와 해석은 어떻게 달라질까?',
  history: '같은 역사적 사건을 다른 사료로 읽으면 설명과 판단은 어떻게 달라질까?',
  media: '같은 사건을 다룬 매체의 자료 선택과 표현 방식은 독자의 해석에 어떤 차이를 만들까?',
  design: '같은 정보를 다른 시각적 구조로 표현하면 전달의 명료성을 어떤 기준으로 비교할 수 있을까?',
  undecided: '같은 관심 문제를 서로 다른 교과의 개념과 방법으로 살펴보면 어떤 질문이 새로 생길까?',
};
const fieldConcepts = {
  humanities: ['텍스트의 표현과 맥락', '근거를 갖춘 해석', '관점 비교와 반례'],
  social_science: ['개념과 관찰의 구분', '자료의 출처와 대표성', '설명과 가치 판단의 구분'],
  business: ['조건과 가정', '선택의 비용과 효과', '자료 비교와 이해관계'],
  science: ['핵심 개념과 모형', '관찰·측정과 변인', '가정과 오차·한계'],
  engineering: ['문제의 조건과 설계 기준', '과학·수학적 원리', '대안 비교와 검증'],
  computing: ['문제 분해와 알고리즘', '자료의 표현과 처리', '오류 분석과 비교 검증'],
  health: ['생명·화학의 기초 개념', '자료의 근거 수준', '일반 정보와 개인별 판단의 구분'],
  education: ['개념 이해와 설명', '학습 자료 비교', '관찰 근거와 해석의 한계'],
  arts: ['표현 요소와 구성', '작품의 맥락과 해석', '창작 선택과 비평 근거'],
  interdisciplinary: ['교과별 설명 관점', '방법 간 연결', '적용 조건과 한계'],
  undecided: ['관심 문제의 구체화', '교과별 기초 개념', '여러 방법의 비교'],
};
function makeContext(input) {
  const request = validateRequest(input);
  const university = catalogue.universities.find(item => item.id === request.target.university_id);
  const department = taxonomy.departments[request.target.department_id];
  const sections = taxonomy.sections[request.stage].filter(section => !request.section_id || section.id === request.section_id);
  const sources = university.sources.map(source => ({ ...source }));
  const previousRecommendations = request.context_token ? verifyContextToken(request.context_token, request) : null;
  const allowedRefs = [
    ...request.learner.strengths.map(code => 'strength:' + code),
    ...request.learner.needs.map(code => 'need:' + code),
    ...sources.map(source => source.id),
  ];
  return {
    request, sections, sources, allowedRefs,
    publicContext: {
      university: { id: university.id, name: university.name, admission_year: university.admission_year, reviewed_on: university.reviewed_on, campus_scope: university.campus_scope, routes: university.routes, shared_rules: university.shared_rules, limitations: university.limitations },
      target: { ...request.target, department_name: department.label, official_department_verified: false, department_status: '학문분야 분류이며 해당 대학의 정확한 모집단위 개설·교육목표·교육과정은 별도 확인 필요', reference_only: request.target.admission_year !== university.admission_year },
      learner: { grade: request.learner.grade, school_stage: request.learner.school_stage, strengths: request.learner.strengths.map(code => ({ code, label: taxonomy.competencies[code], ref: 'strength:' + code })), needs: request.learner.needs.map(code => ({ code, label: taxonomy.competencies[code], ref: 'need:' + code })), interests: request.learner.interests.map(code => taxonomy.fields[code]), subjects: request.learner.subjects, school_opportunities: request.learner.school_opportunities.map(code => taxonomy.school_opportunities[code]), school_constraints: request.learner.school_constraints.map(code => taxonomy.school_constraints[code]) },
      educational_suggestion: { question: questions[request.target.department_id], concepts: fieldConcepts[request.target.field], status: '학문분야와 요약된 학습 기반에서 제안한 후보이며 학생의 기존 질문·학교 과제·대학의 선호 주제로 확인된 사실이 아님' },
      ...(previousRecommendations ? { admissions_preparation_recommendations: previousRecommendations } : {}),
      sources, allowed_evidence_refs: allowedRefs,
    },
  };
}
const plans = {
  target_basis: '해당 대학 학종 전형의 차이, 모집단위 적용 범위와 확인할 조건, 학문분야의 일반 학습 준비와 대학 공식 평가 기준의 구분을 각각 다룬다.',
  learner_alignment: '선택된 강점으로 이어갈 학습, 보완 항목의 구체적인 기초 준비, 자료가 부족한 부분의 판단 보류와 선택 대안을 각각 다룬다. 코드만으로 과거 활동·성적·행동 사례를 만들지 않는다.',
  academic_preparation: '관련 과목을 선택할 이유와 조건, 핵심 개념의 학습 방법, 개념 이해를 설명·적용·비교로 확인할 결과물을 각각 다룬다. 권장과목을 필수로 바꾸지 않는다.',
  experience_preparation: '교과에서 출발하는 탐구 발전, 공동체 문제에 대한 실제 역할과 협업 준비, 확인된 학종 면접 방식에 맞는 근거 설명 준비를 각각 다룬다.',
  next_decisions: '지금 우선할 학습과 이유, 목표 전형별로 다른 확인 사항, 관심·과목·자료 여건이 달라졌을 때 조정 기준을 각각 다룬다. 미확인 목록만 반복하지 않는다.',
  inquiry_question: '제공된 교육적 질문 후보를 중심으로 질문을 택할 이유, 비교할 범위와 하위 질문, 답이 되려면 필요한 근거를 각각 구체화한다. 다른 페이지에서도 동일한 질문 후보를 사용한다.',
  concept_learning: '질문에 필요한 기초 개념, 과목별 학습과 설명·연습 방법, 이해를 새 자료에 적용하고 점검할 방법을 각각 설명한다.',
  inquiry_method: '자료 선정과 신뢰도 판단, 질문에 맞는 비교·분석·탐구 절차, 반례·오차·해석의 한계와 결론 판단 기준을 각각 구체화한다.',
  school_connection: '전달된 일반 학습 기회를 활용하는 방법, 수행 순서와 역할 및 결과물, 실제 과제의 제출·AI·자료 조건을 확인하고 방법을 조정하는 선택을 각각 구체화한다. 학교명·고유 과제명·날짜를 추정하지 않는다.',
  reflection_extension: '질문에 대한 결과를 판단할 근거, 설명이 달라졌을 때 수정할 방법, 새 개념·자료·관점으로 이어지는 후속 질문을 각각 제안한다. 실행 이전의 계획을 실적으로 쓰지 않는다.',
};
function buildPayload(input, model = 'gemini-3.6-flash') {
  const context = makeContext(input);
  const requested = context.sections.map(section => ({ ...section, requirements: plans[section.id] }));
  const instructions = [
    '학생부종합전형 준비와 질문 중심 학습을 돕는 한국어 전략 보고서를 작성한다. 대학·전형·학문분야별 준비 기준을 먼저 적용한 뒤 학습 질문과 방법을 연결한다.',
    '입력은 로컬에서 선택한 공개 어휘 요약이다. 학생부 원문·이름·번호·학교·상담 원문·교사 의견을 받지 않았다. 식별정보를 추정하거나 생성하지 않는다. 누락된 관찰·상담이 있어도 제공된 범위에서 전략을 완성한다.',
    '학종 이외의 교과전형·논술·정시 준비를 섞지 않는다. 수능최저는 해당 학종 전형에서 확인된 경우에만 그 조건으로 언급한다. 선발 배점과 서류 평가역량 가중치를 혼동하지 않는다.',
    'publicContext는 검토일의 시행계획 참고자료다. 다른 대입연도에는 확정 요건으로 적용하지 않는다. 자료에 없는 세부 평가 비중·모집단위 개설·필수과목·대학 전공 교육과정·합격률·합격 등급·순위를 만들지 않는다. 입학처의 실제 상세 정보와 일반적인 학문분야 학습 제안을 명확히 구분한다.',
    '공개 자료의 전형과 모집단위 범위를 문장으로 보존하고 다른 학과의 예외를 목표 학과의 조건으로 옮기지 않는다. 정확한 모집단위가 확인되지 않았으므로 해당 대학에 선택한 학과가 개설되었다고 단정하지 않는다. 미확인이 있더라도 선택된 과목·학습 기반에 맞는 준비 이유와 방법은 구체적으로 설명한다.',
    '각 항목의 detail은 준비할 개념과 사용할 자료의 범위, reason은 선택한 근거에 비추어 이 준비가 필요한 이유, steps는 실행할 행동과 남길 결과물·확인 기준을 맡는다. 서로 다른 역할의 내용을 복사하거나 같은 문장을 반복하지 않는다. 어려운 용어·실험·장비를 제시하는 것만으로 심화라고 부르지 않는다. 자료가 없으면 교과서 예시·접근 가능한 문헌을 비교하는 대안을 제시하고 출처나 수치를 꾸미지 않는다.',
    '학생의 강점·보완 코드는 요약 근거일 뿐 실제 성적·사례의 증거가 아니다. 없는 활동·성격·면접 반응을 만들지 않는다. 교사 관찰·상담은 필수가 아니다. 학생이 스스로 설명·비교·수정하는 방법을 먼저 안내한다.',
    'admissions_preparation_recommendations가 있으면 앞 단계에서 작성한 과목 선택·학업 준비 제안이다. 질문 중심 학습은 그 제안의 구체 개념·방법·준비 이유를 이어 받아 발전시킨다. 앞 단계의 제안은 공식 대학 정책이나 이미 수행한 학생 실적이 아니다. 같은 공개 자료와 학교 조건으로 다시 대조하며 근거 없는 주장은 확대하지 않는다.',
    '같은 역량이 강점과 보완 양쪽에 있어도 모순으로 단정하지 않는다. 수행의 서로 다른 측면에서 발달이 다를 수 있으므로 강점을 활용할 방법과 보완할 방법을 구분하여 조건부로 제안한다. 세부 행동 코드를 우선 활용하고 일반 역량 이름만 반복하지 않는다.',
    'school_constraints에 AI 활용 금지가 있으면 해당 과제물의 주장·답안·보고서·코드·산출물 작성이나 AI 분석 대행을 제안하지 않는다. 기초 개념 학습과 학생 자신의 자료 비교·수행 준비 중심으로 안내한다. 수업 시간 수행·자료 범위 제한은 보존하며 새 마감이나 허용 도구를 만들지 않는다.',
    '시간 배정·시간 상한·분 단위 일정·소요 시간·점검일·과제 완료 관리·학생 순위를 만들지 않는다. 현재 과목 이수를 추정하지 않는다. 학교 과제·동아리 명칭과 운영 조건은 로컬에서 별도로 연결하므로 일반적인 학습 방법과 조건 확인만 제안한다.',
    '앞으로 할 학습은 제안형으로 쓰고 실제 완료한 실적이나 학생부 문구를 대필하지 않는다. 사람을 대상으로 한 임상·진단 실험을 요구하지 않는다. 학생의 학교명·성명·학번·주소·연락처·계정·파일명은 생성하지 않는다.',
    '요청된 sections만 정확한 id와 순서로 출력한다. 각 section에는 overview와 서로 다른 주제의 items 3개 이상을 쓴다. item.detail은 공백을 뺀 한국어 기준 150자 이상, reason은 60자 이상, steps는 2개 이상이며 각 20자 이상이다. 각 section은 공백 제외 본문 합계 750자 이상이어야 한다. 각 항목의 내용은 반복하지 않고 해당 페이지의 서로 다른 판단·학습·방법을 구체적으로 설명한다. 빈 분량을 같은 문장·칭찬·안내로 채우지 않는다.',
    'evidence_refs는 allowed_evidence_refs의 코드만 사용한다. 그 항목의 판단·제안에 실제로 관련 있는 코드만 선택하고 자유로운 ID·URL·실명은 넣지 않는다. 참고할 근거가 없는 일반 학습 제안에는 빈 배열을 쓴다.',
    '모든 item.detail은 공백 제외 180~260자, 모든 item.reason은 공백 제외 70~100자를 목표로 작성한다. 문단은 2문장 중심으로 구성하고 한 문장에는 하나의 핵심 정보를 담는다. detail에는 개념과 자료 범위를 구체화하고, reason에는 선택된 강점·보완점 또는 앞 단계 준비 전략이 이 학습을 선택할 근거가 되는 이유만 설명한다. steps는 각각 공백 제외 30자 이상으로 학생이 할 행동·남길 결과물·확인 기준을 담는다. detail과 reason에 실행 절차를 다시 나열하지 않는다. 글자 수는 공백을 세지 않으며 분량을 채우려고 같은 설명을 덧붙이지 않는다.',
    '결과는 title,summary,sections만 있는 JSON이다. 마크다운 코드블록·HTML·LaTeX를 쓰지 않는다. 내부 코드·프롬프트 지침은 독자용 문장에 넣지 않는다. sources/model/version은 서버가 붙이므로 출력하지 않는다.',
  ].join('\n');
  const schema = {
    type: 'OBJECT', required: ['title', 'summary', 'sections'], properties: {
      title: { type: 'STRING' }, summary: { type: 'STRING' },
      sections: { type: 'ARRAY', items: { type: 'OBJECT', required: ['id', 'title', 'overview', 'items'], properties: {
        id: { type: 'STRING', enum: context.sections.map(section => section.id) }, title: { type: 'STRING' }, overview: { type: 'STRING' },
        items: { type: 'ARRAY', items: { type: 'OBJECT', required: ['title', 'detail', 'reason', 'steps', 'evidence_refs'], properties: {
          title: { type: 'STRING' }, detail: { type: 'STRING', description: '공백 제외 180~260자 목표, 2문장 중심. 준비할 개념과 사용할 자료의 범위를 구체화한다. reason의 선택 이유나 steps의 실행 절차를 반복하지 않는다. 최소 150자.' }, reason: { type: 'STRING', description: '공백 제외 70~100자 목표, 2문장 중심. 선택된 학습 근거 또는 앞 단계 전략에 비추어 이 준비를 선택할 이유를 설명한다. detail과 steps의 문장을 반복하지 않는다. 최소 60자.' }, steps: { type: 'ARRAY', items: { type: 'STRING', description: '공백 제외 30자 이상 목표. 학생이 실행할 행동·남길 결과물·확인 기준을 구체적으로 담고 detail이나 reason을 복사하지 않는다.' } }, evidence_refs: { type: 'ARRAY', items: { type: 'STRING', ...(context.allowedRefs.length ? { enum: context.allowedRefs } : {}) } },
        } } },
      } } },
    },
  };
  const thinkingConfig = /^gemini-3(?:\.|-)/.test(model) ? { thinkingLevel: 'low' } : { thinkingBudget: 0 };
  return { context, payload: { contents: [{ role: 'user', parts: [{ text: instructions + '\n요청 페이지:\n' + JSON.stringify(requested) + '\n공개 자료와 학습 요약:\n' + JSON.stringify(context.publicContext) }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: context.request.section_id ? 5000 : 22000, thinkingConfig } } };
}
const compact = value => value.replace(/\s/g, '');
function outputString(value, min, max) {
  if (typeof value !== 'string' || compact(value).length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) reject('STRATEGY_QUALITY', '보고서의 설명이 충분하지 않아 다시 작성해야 합니다.', 502);
  if (/<\/?[a-z][^>]*>|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:010|011|016|017|018|019)[- ]?\d{3,4}[- ]?\d{4}|[A-Z]:[\\/]|대륜|[가-힣]{2,}(?:고등학교|중학교|초등학교)/i.test(value)) reject('STRATEGY_OUTPUT_PRIVATE', '반환된 문장에 허용하지 않는 식별정보 또는 형식이 있어 표시하지 않았습니다.', 502);
  return value.trim();
}
function normalizeModelResponse(result, context, model) {
  if (!result?.ok) reject(result?.status === 429 ? 'AI_QUOTA' : 'AI_UNAVAILABLE', '외부 AI 응답을 받지 못했습니다. 준비한 자료는 이 PC에 보존됩니다.', result?.status === 429 ? 429 : 502);
  const candidate = result.data?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') reject('STRATEGY_INCOMPLETE', '보고서 생성이 끝나지 않았습니다. 해당 페이지를 다시 시도해 주세요.', 502);
  const text = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('').trim();
  if (!text || text.length > 180000) reject('STRATEGY_INVALID_OUTPUT', '전략 응답의 형식을 확인하지 못했습니다.', 502);
  let value;
  try { value = JSON.parse(text); } catch { reject('STRATEGY_INVALID_OUTPUT', '전략 응답의 형식을 확인하지 못했습니다.', 502); }
  try {
    objectKeys(value, ['title', 'summary', 'sections']);
    if (!Array.isArray(value.sections) || value.sections.length !== context.sections.length) reject();
    const paragraphs = new Set();
    const sections = value.sections.map((section, index) => {
      objectKeys(section, ['id', 'title', 'overview', 'items']);
      if (section.id !== context.sections[index].id || !Array.isArray(section.items) || section.items.length < 3 || section.items.length > 8) reject();
      const normalized = { id: section.id, title: outputString(section.title, 2, 140), overview: outputString(section.overview, 30, 1500), items: section.items.map(item => {
        objectKeys(item, ['title', 'detail', 'reason', 'steps', 'evidence_refs']);
        if (!Array.isArray(item.steps) || item.steps.length < 2 || item.steps.length > 8) reject();
        const detail = outputString(item.detail, 150, 5000), reason = outputString(item.reason, 60, 2500);
        for (const paragraph of [detail, reason]) { const key = compact(paragraph); if (paragraphs.has(key)) reject('STRATEGY_REPETITION', '같은 설명을 반복한 응답은 보고서로 사용하지 않습니다.', 502); paragraphs.add(key); }
        return { title: outputString(item.title, 2, 160), detail, reason, steps: item.steps.map(step => outputString(step, 20, 1000)), evidence_refs: list(item.evidence_refs, context.allowedRefs, 12) };
      }) };
      const count = compact(normalized.overview + normalized.items.map(item => item.detail + item.reason + item.steps.join('')).join('')).length;
      if (count < 750) reject('STRATEGY_QUALITY', '해당 페이지의 구체적인 학습 설명이 부족합니다. 다시 시도해 주세요.', 502);
      return normalized;
    });
    const academic = context.request.stage === 'admissions' && sections.find(section => section.id === 'academic_preparation');
    return { version: 1, stage: context.request.stage, title: outputString(value.title, 2, 200), summary: outputString(value.summary, 30, 2500), sections, sources: context.sources, model: String(model).slice(0, 100), ...(academic ? { context_token: createContextToken(context.request, academic) } : {}) };
  } catch (error) {
    if (error instanceof StrategyError && error.status >= 500) throw error;
    reject('STRATEGY_INVALID_OUTPUT', '보고서의 항목과 근거 형식이 기준에 맞지 않습니다. 해당 페이지를 다시 시도해 주세요.', 502);
  }
}
function buildRepairPayload(payload, result, error, context) {
  // Feedback may contain only constructed field diagnostics and a public AI draft.
  // Never append upstream errors, authentication metadata, tokens, or local data.
  const candidate = result?.data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('').trim();
  const feedback = ['앞 응답이 보고서 형식 또는 구체성 검증에 미달했습니다. 아래 기준으로 요청한 페이지 전체를 다시 작성하세요. 최소 기준을 낮추거나 누락 항목을 생략하지 마세요.'];
  let value;
  try { value = JSON.parse(text); } catch { feedback.push('문법이 올바른 JSON 객체 하나를 출력하세요. 코드블록을 쓰지 마세요.'); }
  if (value && Array.isArray(value.sections)) {
    if (value.sections.length !== context.sections.length) feedback.push('요청한 section 개수와 순서를 정확히 맞추세요.');
    value.sections.slice(0, 5).forEach((section, sectionIndex) => {
      if (!section || !Array.isArray(section.items)) return;
      if (section.items.length < 3) feedback.push(`sections[${sectionIndex}].items: 항목이 ${section.items.length}개입니다. 서로 다른 구체 항목이 최소 3개 필요합니다.`);
      section.items.slice(0, 8).forEach((item, itemIndex) => {
        if (!item || typeof item !== 'object') return;
        for (const [field, minimum, target, role] of [['detail', 150, '180~260', '준비할 개념과 사용할 자료의 범위'], ['reason', 60, '70~100', '선택된 학습 근거 또는 앞 단계 전략에 비추어 이 준비를 선택할 이유']]) {
          const length = typeof item[field] === 'string' ? compact(item[field]).length : 0;
          if (length < minimum) feedback.push(`sections[${sectionIndex}].items[${itemIndex}].${field}: 공백 제외 ${length}자로 최소 ${minimum}자에 미달합니다. ${role}를 ${target}자, 2문장 중심으로 구체화하세요. 다른 항목의 설명이나 실행 절차를 복사하지 마세요.`);
        }
        if (!Array.isArray(item.steps) || item.steps.length < 2 || item.steps.some(step => typeof step !== 'string' || compact(step).length < 20)) feedback.push(`sections[${sectionIndex}].items[${itemIndex}].steps: 실행할 행동·남길 결과물·확인 기준을 담아 각각 공백 제외 30자 이상인 수행 방법을 최소 2개 제시하세요. detail이나 reason의 문장을 반복하지 마세요.`);
      });
    });
  }
  if (error.code === 'STRATEGY_REPETITION') feedback.push('같은 문단이 반복되었습니다. 각 항목이 다른 개념·자료·판단을 다루고 detail·reason·steps가 서로 다른 역할을 맡도록 다시 작성하세요. 같은 문장을 복사하거나 표현만 바꾸어 반복하지 마세요.');
  feedback.push('모든 detail은 공백 제외 180~260자, 모든 reason은 70~100자를 목표로 2문장 중심으로 작성하세요. detail은 개념·자료 범위, reason은 근거에 따른 선택 이유, steps는 실행 행동·결과물·확인 기준으로 구분하고 같은 설명을 반복하지 마세요. 실제 수행하지 않은 학생 활동이나 공식 자료에 없는 대학 요건은 만들지 마세요. evidence_refs에는 허용된 코드만 넣으세요.');
  let draft = '';
  if (value && text.length <= 24000 && Array.isArray(value.sections)) {
    const picked = (object, keys) => Object.fromEntries(keys.filter(key => typeof object?.[key] === 'string').map(key => [key, object[key]]));
    const safe = { ...picked(value, ['title', 'summary']), sections: value.sections.slice(0, 5).map((section, index) => ({
      id: context.sections[index]?.id || '', ...picked(section, ['title', 'overview']),
      items: (Array.isArray(section?.items) ? section.items : []).slice(0, 8).map(item => ({
        ...picked(item, ['title', 'detail', 'reason']),
        steps: (Array.isArray(item?.steps) ? item.steps : []).filter(step => typeof step === 'string').slice(0, 8),
        evidence_refs: (Array.isArray(item?.evidence_refs) ? item.evidence_refs : []).filter(ref => context.allowedRefs.includes(ref)).slice(0, 12),
      })),
    })) };
    try { draft = outputString(JSON.stringify(safe), 1, 24000); } catch { /* Omit unsafe generated text. */ }
  }
  const repair = structuredClone(payload);
  repair.contents[0].parts.push({ text: '\n품질 보완 지시:\n' + feedback.slice(0, 28).join('\n') + (draft ? '\n앞서 생성된 공개 자료 기반 초안(JSON; 수정 대상):\n' + draft : '') });
  return repair;
}
module.exports = { taxonomy, catalogue, StrategyError, validateRequest, makeContext, buildPayload, normalizeModelResponse, buildRepairPayload };
