// 교사 화면과 학생 화면을 잇는 통로.
// 1단계는 같은 브라우저의 탭끼리만 통하는 BroadcastChannel로 흐름을 확인한다.
// 교실에서 쓰려면 서버 통로(Supabase 실시간)로 바꾼다. 화면 코드는 이 파일의 함수만 쓰므로 그대로 둔다.
//
// 메시지 종류
//   교사 → 학생: state { lesson, mode, slide, page, lock, preview, seq } · closed · reset-name
//   학생 → 교사: hello { pid } · ping { pid, slide, following } · bye { pid }

export const TRANSPORT = 'local';

export function openRoom(code) {
  const channel = new BroadcastChannel(`ait-room-${code}`);
  const handlers = new Set();
  channel.onmessage = (e) => handlers.forEach((fn) => fn(e.data));
  return {
    send(message) { channel.postMessage(message); },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { channel.close(); handlers.clear(); },
  };
}
