/**
 * 원본 lib/export/handoff.ts 대신 쓰는 파일. 대륜고에는 문서작성 AI(/docai)가 없다.
 * /evalplan/·/record/ 포트의 저장 묶음은 넘기기 단추를 보이지 않으므로 이 함수는 불리지 않는다.
 * 그래도 불리면 새 탭을 열지 않고 내려받기를 안내한다.
 */
import type { ExportFile, ExportIntent } from '@/lib/export/types'

export async function sendToDocAi(
  _intent: ExportIntent,
  _source: string,
  _makeFiles: () => Promise<ExportFile[]> | ExportFile[],
): Promise<boolean> {
  throw new Error('이 사이트에서는 문서작성 AI로 넘기지 않습니다. MD 저장이나 한글 파일 받기로 내려받으세요.')
}

export function textFile(name: string, text: string): ExportFile {
  return { name, bytes: new TextEncoder().encode(text) }
}
