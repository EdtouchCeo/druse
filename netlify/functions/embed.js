// 임베딩 프록시 — 키는 서버(환경변수)에만 보관.
//  · 질문(단건):  { text }                 → RETRIEVAL_QUERY    → { embedding:[...] }
//  · 문서(배치):  { texts:[...], doc:true } → RETRIEVAL_DOCUMENT → { embeddings:[[...],...] }
// 배치 모드는 build-emb.html(브라우저 임베딩 생성기)이 .bin 만들 때 사용.
//
// 환경변수: GEMINI_API_KEY(ask.js 공용), EMBED_MODEL(기본 gemini-embedding-001), EMBED_DIM(기본 768)
// ※ build_embeddings.py / 프론트 EMB_DIM 과 모델·차원이 동일해야 함.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.EMBED_MODEL || 'gemini-embedding-001';
  const DIM = parseInt(process.env.EMBED_DIM || '768', 10);
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API 키가 설정되지 않았습니다(GEMINI_API_KEY).' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedContent?key=${API_KEY}`;

  async function embedOne(text, taskType) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text: (text || ' ').toString().slice(0, 2000) }] },
        taskType: taskType,
        outputDimensionality: DIM
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const err = new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
      err.status = resp.status;
      throw err;
    }
    const values = data.embedding && data.embedding.values;
    if (!values || !values.length) throw new Error('임베딩 응답 형식 오류');
    return values;
  }

  try {
    // ── 배치(문서 청크) 모드 ──
    if (Array.isArray(body.texts)) {
      const texts = body.texts.slice(0, 8); // 함수 타임아웃 보호(한 번에 최대 8개)
      const taskType = body.doc ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY';
      const embeddings = [];
      for (let i = 0; i < texts.length; i++) embeddings.push(await embedOne(texts[i], taskType));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeddings: embeddings }) };
    }

    // ── 단건(질문) 모드 ──
    const text = (body.text || '').toString().trim();
    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'text가 비어 있습니다.' }) };
    }
    const values = await embedOne(text, 'RETRIEVAL_QUERY');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embedding: values }) };

  } catch (e) {
    const status = (e && e.status === 429) ? 429 : 502;
    return { statusCode: status, body: JSON.stringify({ error: '임베딩 호출 실패: ' + (e && e.message ? e.message : 'unknown') }) };
  }
};
