// 질문 임베딩 프록시 — 브라우저가 보낸 질문 텍스트를 임베딩 벡터로 변환해 반환.
// 클라이언트는 이 벡터로 사전 생성된 청크 임베딩(.bin)과 코사인 유사도를 계산해 RAG 근거를 고른다.
//
// 환경변수:
//   GEMINI_API_KEY : Google AI Studio API 키 (ask.js와 공용)
//   EMBED_MODEL    : 임베딩 모델 (선택, 기본 text-embedding-004 / 768차원)
//                    ※ build_embeddings.py와 반드시 동일한 모델을 사용해야 함

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.EMBED_MODEL || 'text-embedding-004';
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API 키가 설정되지 않았습니다(GEMINI_API_KEY).' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const text = (body.text || '').toString().trim();
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'text가 비어 있습니다.' }) };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedContent?key=${API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${MODEL}`, content: { parts: [{ text: text.slice(0, 2000) }] } })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('임베딩 오류 (HTTP ' + resp.status + ')');
      return { statusCode: 502, body: JSON.stringify({ error: msg }) };
    }
    const values = data.embedding && data.embedding.values;
    if (!values || !values.length) {
      return { statusCode: 502, body: JSON.stringify({ error: '임베딩 응답 형식 오류' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding: values })
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: '임베딩 호출 실패: ' + (e && e.message ? e.message : 'unknown') }) };
  }
};
