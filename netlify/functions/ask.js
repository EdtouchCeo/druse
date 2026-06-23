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
    '당신은 대륜고등학교 교사의 업무를 돕는 도우미입니다. 아래 [근거]는 학교 업무 참고자료' +
    '(법령·지침·교육과정 등)에서 발췌한 내용입니다. 질문의 맥락을 살펴 한국어로 답하되, 다음 규칙을 지키세요.\n\n' +
    '【답변 원칙】\n' +
    '1) 먼저 [근거]에서 질문과 관련된 내용을 찾습니다.\n' +
    '2) [근거]에 답이 있으면 → 그 내용에 충실히 근거하여 답하고, 답변 끝에 ' +
    '"📎 출처: [문서명] 위치" 형식으로 출처를 표기합니다.\n' +
    '3) [근거]에 답이 없거나 부족하면 → 당신의 일반 지식으로 답하되, 반드시 아래 두 가지를 지킵니다.\n' +
    '   (a) 답변의 맨 앞에 다음 주의 문구를 한 줄로 넣습니다:\n' +
    '       "⚠️ 아래는 학교 제공 자료(원문)에 없어 AI의 일반 지식으로 답한 참고용 정보입니다. 공식 효력이 없으니 원문·담당부서에서 반드시 확인하세요."\n' +
    '   (b) 가능하면 [근거]의 관련 내용(인접 조항·유사 규정·관련 개념)과 연결지어 설명하여, 학교 자료와 어떻게 이어지는지 함께 안내합니다.\n' +
    '4) [근거] 일부 + 일반 지식이 섞이면, 어디까지가 자료 기반이고 어디부터가 일반 지식인지 구분해서 표시합니다.\n' +
    '5) 답변은 핵심을 먼저 제시하고, 필요하면 항목으로 정리합니다. 확실하지 않은 내용은 단정하지 않습니다.\n\n' +
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
