// 비속어 거르기: 대화명과 댓글에 쓴다. 띄어 쓰거나 기호·숫자를 끼운 변형도 정리한 뒤 견준다.
// 목록으로 못 거른 표현은 교사가 대화명 초기화나 댓글 삭제로 처리한다.
const WORDS = [
  '씨발', '시발', '씨바', '시바', '씹', '쌍년', '썅', '병신', '븅신', '빙신', '개새', '개색', '새끼', '색끼', '좆', '존나', '졸라', '좃',
  '지랄', '염병', '미친놈', '미친년', '미친새', '닥쳐', '꺼져', '엿먹', '등신', '애미', '애비', '느금', '니미', '니애미', '느그', '호로',
  '년아', '놈아', '창녀', '걸레', '섹스', '야동', '변태', '찐따', '장애인새', '김치녀', '틀딱', '일베',
  'fuck', 'shit', 'bitch', 'damn', 'asshole', 'dick', 'pussy', 'sex', 'porn', 'nigger', 'slut',
];
// '보지 마', '자지 마', '한남동'처럼 평범한 말과 겹치는 낱말은 넣지 않았다.
// 자음만으로 쓴 욕설. 자음으로만 이루어진 입력에만 견주어 '사방' 같은 낱말을 잘못 거르지 않는다.
const JAMO_WORDS = ['ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㅁㅊ', 'ㄲㅈ', 'ㅈㄴ', 'ㅗ', 'ㅅㄲ', 'ㄴㄱㅁ', 'ㅆㄹㄱ'];

function normalize(text) {
  return String(text || '').normalize('NFC').toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

export function checkText(text) {
  const n = normalize(text);
  const hit = WORDS.find((w) => n.includes(w));
  if (hit) return { ok: false, reason: 'word' };
  const jamo = n.replace(/[^ㄱ-ㅎㅏ-ㅣ]/g, '');
  if (jamo && JAMO_WORDS.some((w) => jamo.includes(w))) return { ok: false, reason: 'jamo' };
  return { ok: true };
}

export function autoName(no) {
  return `대륜이 ${no}`;
}

export function validName(raw) {
  const name = String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 12);
  if (!name) return { ok: true, name: '' };
  if (!checkText(name).ok) return { ok: false, message: '다른 대화명을 정해 주세요. 바른 말로 된 이름만 쓸 수 있습니다.' };
  return { ok: true, name };
}
