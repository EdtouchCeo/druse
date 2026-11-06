// 입력 검사와 금칙어. 사이트 함수와 처리 프로그램이 함께 쓴다.
// 금칙어는 어느 맥락에서도 기획서에 쓸 일이 없는 말만 둔다.
// 학교 폭력 예방, 자살 예방, 성평등처럼 지속가능발전목표의 정당한 주제에 나오는 말은 넣지 않고 모델이 맥락으로 판단한다.

const MIN_TEXT = 200;
const MAX_TEXT = 6000;
const MIN_HEADINGS = 3;
const MIN_PROMPT = 50;
const PLAN_HEADINGS = ['서비스명', '기획 의도', '서비스 목적', '대상 사용자', '핵심 기능', '해결 방향', '차별성'];

// 띄어쓰기나 기호를 끼워 피해도 잡는 말. 이어 붙여도 다른 낱말이 되지 않는다.
const BANNED_STRICT = [
  '씨발', '씨바', '씨팔', '시바새끼', '개새끼', '개색기', '개세끼', '븅신', '좆', '지랄',
  '느금마', '니애미', '니애비', '창녀', '걸레년', '썅년', '미친년', '미친놈',
  '포르노', '자위행위', '노모자이크', 'ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅈㄹ', 'porn', 'fuck',
];
// 띄어쓰기를 지우면 "식사 시 발생", "질병 신호"처럼 정상 문장이 걸리는 말. 붙어 있을 때만 찾고 정상 낱말은 뺀다.
const BANNED_EXACT = [
  /시발(?!점|역|생|전|동)/, /병신(?!경|호|약|장|체)/, /존나/, /야동/, /(?<!유니)섹스/, /성인물/,
];

/** 금칙어가 있으면 그 낱말을, 없으면 null을 돌려준다. */
function findBanned(text) {
  const raw = String(text).toLowerCase();
  const joined = raw.replace(/[\s\p{P}\p{S}\d_]+/gu, '');
  const strict = BANNED_STRICT.find((word) => joined.includes(word));
  if (strict) return strict;
  const compact = raw.replace(/[\p{P}\p{S}\d_]+/gu, '');
  const exact = BANNED_EXACT.find((re) => re.test(compact));
  return exact ? compact.match(exact)[0] : null;
}

/** 기획서 내용을 검사한다. 통과하면 {text}, 아니면 {error}. banned가 true면 거절 횟수에 넣는다. */
function validatePlan(raw) {
  if (typeof raw !== 'string') return { error: '기획서를 입력해 주세요.' };
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_TEXT) return { error: `기획서가 너무 짧습니다. ${MIN_TEXT}자 이상 붙여 넣어 주세요. (현재 ${text.length}자)` };
  if (text.length > MAX_TEXT) return { error: `기획서가 너무 깁니다. ${MAX_TEXT}자 이내로 줄여 주세요. (현재 ${text.length}자)` };
  const hits = PLAN_HEADINGS.filter((h) => text.includes(h)).length;
  if (hits < MIN_HEADINGS) return { error: '기획서 양식의 항목명(서비스명, 기획 의도, 서비스 목적, 대상 사용자 등)이 포함되도록 기획서 전체를 붙여 넣어 주세요.' };
  if (findBanned(text)) return { error: '부적절한 표현이 있어 처리하지 않았습니다. 내용을 고쳐 다시 시도해 주세요.', banned: true };
  return { text };
}

/** 2차 구현 프롬프트를 검사한다. 항목 일부가 비어 있어도 되며 빠진 부분은 생성 단계에서 채운다. */
function validatePrompt(raw) {
  if (typeof raw !== 'string') return { error: '구현 프롬프트를 입력해 주세요.' };
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_PROMPT) return { error: `프롬프트가 너무 짧습니다. 만들 화면과 기능을 ${MIN_PROMPT}자 이상 적어 주세요. (현재 ${text.length}자)` };
  if (text.length > MAX_TEXT) return { error: `프롬프트가 너무 깁니다. ${MAX_TEXT}자 이내로 줄여 주세요. (현재 ${text.length}자)` };
  if (findBanned(text)) return { error: '부적절한 표현이 있어 처리하지 않았습니다. 내용을 고쳐 다시 시도해 주세요.', banned: true };
  return { text };
}

// 학번: 1학년(1) + 반(01~12) + 번호(01~40)
const validStudentId = (id) => /^1(0[1-9]|1[0-2])(0[1-9]|[1-3]\d|40)$/.test(String(id || ''));
const validName = (name) => /^[가-힣a-zA-Z ]{2,20}$/.test(String(name || '').trim());

module.exports = { MIN_TEXT, MAX_TEXT, MIN_PROMPT, findBanned, validatePlan, validatePrompt, validStudentId, validName };
