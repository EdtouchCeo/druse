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
  const dataset = (body.dataset || '').toString();
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
    ? contexts.map((c, i) => `[${i + 1}] (${c.label}${c.ref ? ' ' + c.ref : ''})\n${c.text}`).join('\n\n')
    : '(관련 근거를 찾지 못했습니다.)';

  // 데이터셋별 특화 규칙 — 클라이언트가 body.dataset으로 전달 (현재 curr=교육과정만)
  const DATASET_RULES = {
    curr:
      '【교육과정 답변 특별 규칙 — 수업·평가 설계 지원】\n' +
      '이 챗봇의 사용자는 교수학습 및 평가 운영 계획을 수립하는 교사입니다. 교육과정 원문 정보를 설계에 바로 쓸 수 있게 명확히 제시하세요.\n' +
      'a) 성취기준을 인용·제시할 때는 반드시 성취기준 번호를 원문 그대로 붙입니다. 예: "[12문학01-02] 문학의 여러 갈래…". 번호 없이 성취기준 문장만 쓰는 것은 금지입니다.\n' +
      'b) 성취기준 번호는 [근거] 원문에 있는 것만 사용합니다. 근거에서 번호가 확인되지 않으면 절대 번호를 지어내지 말고 "(성취기준 번호는 원문 확인 필요)"라고 표기합니다.\n' +
      'c) 영역별 핵심 아이디어를 물으면 「영역명 → 핵심 아이디어」 구조로 구분해 명확히 제시합니다.\n' +
      'd) 내용 체계를 제시할 때는 지식·이해 / 과정·기능 / 가치·태도 구분을 유지합니다.\n' +
      'e) 수업·평가 설계 관련 질문이면 관련 성취기준(번호 포함)과 해당 영역의 핵심 아이디어를 연결해 제시하고, 성취기준 해설·적용 시 고려사항이 근거에 있으면 구분해 덧붙입니다.\n' +
      'f) 질문한 과목·학교급의 표만 사용합니다. [근거]에 여러 과목의 내용 체계 표가 섞여 있어도 질문한 과목의 표만 골라 쓰고, 다른 과목(예: 다른 교과·유사 이름 과목)의 영역명·핵심 아이디어·내용 요소·성취기준을 혼입하는 것은 절대 금지입니다.\n' +
      'g) 핵심 아이디어·내용 요소·성취기준은 [근거] 원문에서 한 글자도 바꾸지 말고 그대로 옮겨 적습니다. 요약·의역·어순 변경·두 문장 병합 금지, 원문 1문장 = 답변 1불릿(항목 수도 원문과 동일). 영역별 구조로 정리하되 「영역명 → 핵심 아이디어(불릿) → (요청 시) 내용 요소 지식·이해/과정·기능/가치·태도 → 성취기준 [코드] 전문」 순서를 지킵니다.\n' +
      'i) 인용하는 핵심 아이디어·내용 요소·성취기준 문장은 원문의 평서형 종결어미("~한다.", "~된다.", "~준다." 등)를 그대로 유지합니다. 인용문을 존댓말("~합니다", "~됩니다")로 바꾸는 것은 금지입니다. 인용문 밖의 안내·설명 문장에만 존댓말을 씁니다.\n' +
      'h) 질문한 과목의 내용 체계 표가 [근거]에 없으면 "자료에서 해당 과목의 내용 체계를 찾지 못했습니다"라고 답합니다. 이름이 비슷하거나 관련 있어 보이는 다른 과목의 표로 대체해서 답하지 마세요.\n\n',
  };
  const datasetRules = DATASET_RULES[dataset] || '';

  const prompt =
    '당신은 대륜고등학교 교사의 업무를 돕는 RAG 챗봇입니다. 아래 [근거]는 학교 업무 참고자료' +
    '(법령·지침·교육과정 등)에서 발췌한 내용입니다.\n\n' +
    '⭐ 가장 중요한 규칙: 당신은 검색기가 아니라 답변 생성기입니다. ' +
    '질문에 대해 반드시 "완결된 한국어 문장"으로 실제 답변을 작성하세요. ' +
    '근거를 그대로 나열하거나, 주의 문구만 단독으로 출력하거나, 빈 답변을 내는 것은 절대 금지입니다. ' +
    '어떤 질문이든 당신이 아는 최선의 내용을 문장으로 설명해야 합니다.\n\n' +
    '【답변 방법】\n' +
    '1) [근거]에 질문의 답이 있으면 → 근거 내용을 바탕으로 문장으로 설명하고, ' +
    '출처는 해당 문장 끝 또는 답변 끝에 "📎 출처: [1], [3]" 처럼 번호로만 표기합니다. ' +
    '이 번호는 [근거] 앞의 번호이며, 화면 하단 "참고한 자료" 목록의 번호와 일치합니다. ' +
    '가독성을 위해 본문에는 문서명·페이지를 길게 쓰지 말고 번호만 적습니다.\n' +
    '2) [근거]에 답이 없거나 부족하면 → 그래도 멈추지 말고 당신의 일반 지식으로 ' +
    '끝까지 문장으로 답변을 작성합니다. 단, 이 경우 답변 "맨 앞 한 줄"에 다음 주의 문구를 넣습니다:\n' +
    '   "⚠️ 아래는 학교 제공 자료(원문)에 없어 AI의 일반 지식으로 답한 참고용 정보입니다. 공식 효력이 없으니 원문·담당부서에서 반드시 확인하세요."\n' +
    '   그리고 가능하면 [근거]의 관련 내용(인접 조항·유사 규정·관련 개념)과 연결지어 설명합니다.\n' +
    '3) 근거 기반 내용과 일반 지식이 섞이면, 어디까지가 자료 기반인지 구분해 표시합니다.\n' +
    '4) 핵심을 먼저 제시하고, 필요하면 항목으로 정리합니다. 확실하지 않은 부분은 단정하지 않습니다.\n' +
    '5) 장황하게 늘어놓지 말고 핵심부터 간결히 쓰되, 답변은 반드시 문장을 완결해 마무리합니다. ' +
    '절대 문장 중간에서 끊지 마세요. 분량이 많아질 것 같으면 덜 중요한 내용을 줄여서라도 끝맺음을 완성합니다.\n\n' +
    '다시 강조: 주의 문구만 출력하고 끝내면 안 됩니다. 주의 문구 다음에 반드시 질문에 대한 실제 답변 문장이 이어져야 합니다.\n\n' +
    datasetRules +
    '[근거]\n' + evidence + '\n\n[질문]\n' + question;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${API_KEY}`;

  // 출력 토큰을 넉넉히. Gemini 2.5 계열은 'thinking'이 출력 토큰을 잠식하므로
  // RAG 단순 응답에서는 thinking을 끈다(Gemma 등에는 해당 옵션을 보내지 않음).
  const generationConfig = { temperature: 0.2, maxOutputTokens: 8192 };
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
