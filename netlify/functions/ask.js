// RAG 챗봇 프록시 — 브라우저가 보낸 질문 + 근거(청크)를 받아 Google LLM에 질의.
// API 키는 서버(환경변수)에만 보관하여 클라이언트에 노출하지 않는다.
//
// 필요한 Netlify 환경변수:
//   GEMINI_API_KEY  : Google AI Studio API 키 (필수)
//   LLM_MODEL       : 사용할 모델 ID (선택, 기본 gemini-2.5-flash)
//                     예) gemini-2.5-flash, gemini-2.0-flash, gemma-3-27b-it
//   (Gemini·Gemma 모두 generativelanguage.googleapis.com generateContent로 호출 가능)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API 키가 설정되지 않았습니다(GEMINI_API_KEY).' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const question = (body.question || '').toString().trim();
  let contexts = Array.isArray(body.contexts) ? body.contexts : [];
  if (!question) {
    return { statusCode: 400, body: JSON.stringify({ error: '질문이 비어 있습니다.' }) };
  }

  // 컨텍스트 크기 제한(과도한 토큰/비용 방지): 최대 8개, 각 1200자
  contexts = contexts.slice(0, 8).map((c) => ({
    label: (c.label || '').toString().slice(0, 120),
    ref: (c.ref || '').toString().slice(0, 80),
    text: (c.text || '').toString().slice(0, 1200)
  }));

  const evidence = contexts.length
    ? contexts.map((c, i) => `(${i + 1}) [${c.label}]${c.ref ? ' ' + c.ref : ''}\n${c.text}`).join('\n\n')
    : '(관련 근거를 찾지 못했습니다.)';

  const prompt =
    '당신은 대륜고등학교 교사의 업무를 돕는 RAG 챗봇입니다. 아래 [근거]는 학교 업무 참고자료' +
    '(법령·지침·교육과정 등)에서 발췌한 내용입니다.\n\n' +
    '⭐ 가장 중요한 규칙: 당신은 검색기가 아니라 답변 생성기입니다. ' +
    '질문에 대해 반드시 "완결된 한국어 문장"으로 실제 답변을 작성하세요. ' +
    '근거를 그대로 나열하거나, 주의 문구만 단독으로 출력하거나, 빈 답변을 내는 것은 절대 금지입니다. ' +
    '어떤 질문이든 당신이 아는 최선의 내용을 문장으로 설명해야 합니다.\n\n' +
    '【답변 방법】\n' +
    '1) [근거]에 질문의 답이 있으면 → 근거 내용을 바탕으로 문장으로 설명하고, ' +
    '답변 끝에 "📎 출처: [문서명] 위치" 형식으로 출처를 표기합니다.\n' +
    '2) [근거]에 답이 없거나 부족하면 → 그래도 멈추지 말고 당신의 일반 지식으로 ' +
    '끝까지 문장으로 답변을 작성합니다. 단, 이 경우 답변 "맨 앞 한 줄"에 다음 주의 문구를 넣습니다:\n' +
    '   "⚠️ 아래는 학교 제공 자료(원문)에 없어 AI의 일반 지식으로 답한 참고용 정보입니다. 공식 효력이 없으니 원문·담당부서에서 반드시 확인하세요."\n' +
    '   그리고 가능하면 [근거]의 관련 내용(인접 조항·유사 규정·관련 개념)과 연결지어 설명합니다.\n' +
    '3) 근거 기반 내용과 일반 지식이 섞이면, 어디까지가 자료 기반인지 구분해 표시합니다.\n' +
    '4) 핵심을 먼저 제시하고, 필요하면 항목으로 정리합니다. 확실하지 않은 부분은 단정하지 않습니다.\n\n' +
    '다시 강조: 주의 문구만 출력하고 끝내면 안 됩니다. 주의 문구 다음에 반드시 질문에 대한 실제 답변 문장이 이어져야 합니다.\n\n' +
    '[근거]\n' + evidence + '\n\n[질문]\n' + question;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${API_KEY}`;

  // 출력 토큰을 넉넉히. Gemini 2.5 계열은 'thinking'이 출력 토큰을 잠식하므로
  // RAG 단순 응답에서는 thinking을 끈다(Gemma 등에는 해당 옵션을 보내지 않음).
  const generationConfig = { temperature: 0.2, maxOutputTokens: 2048 };
  if (/gemini-2\.5/.test(MODEL)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: generationConfig
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('LLM 오류 (HTTP ' + resp.status + ')');
      return { statusCode: 502, body: JSON.stringify({ error: msg }) };
    }

    const cand = data.candidates && data.candidates[0];
    let answer = '';
    if (cand && cand.content && cand.content.parts) {
      answer = cand.content.parts.map((p) => p.text || '').join('').trim();
    }
    if (!answer) {
      const blocked = cand && cand.finishReason ? (' (' + cand.finishReason + ')') : '';
      answer = '답변을 생성하지 못했습니다.' + blocked;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer, model: MODEL })
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: '모델 호출 실패: ' + (e && e.message ? e.message : 'unknown') }) };
  }
};
