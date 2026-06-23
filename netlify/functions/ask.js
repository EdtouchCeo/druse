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
    '(법령·지침·교육과정 등)에서 발췌한 내용입니다. 다음 규칙을 지켜 한국어로 답하세요.\n' +
    '1) 반드시 [근거]에 있는 내용에만 기반해 답합니다.\n' +
    '2) 근거에서 찾을 수 없으면 추측하지 말고 "제공된 자료에서 관련 내용을 찾지 못했습니다."라고 답합니다.\n' +
    '3) 답변은 핵심을 먼저, 필요한 경우 항목으로 정리합니다.\n' +
    '4) 답변 끝에 사용한 근거의 출처를 "📎 출처: [문서명] 위치" 형식으로 표기합니다.\n\n' +
    '[근거]\n' + evidence + '\n\n[질문]\n' + question;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
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
