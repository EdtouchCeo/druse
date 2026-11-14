/**
 * 원본 lib/export/crossWindowHandoff.ts 대신 쓰는 파일. 대륜고에는 문서작성 AI가 없고,
 * 대륜고 주소는 edtouch.ai 문서작성 AI가 받는 주소도 아니다.
 * 대륜고판 묶음은 MD 저장만 보이므로 이 함수는 불리지 않는다. 그래도 불리면 새 탭을 열지 않고 거절로 끝낸다.
 */
import type { ExportFile, ExportIntent } from '../lib/export/types';

export type HandoffOutcome =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string }
  | { status: 'blocked' }
  | { status: 'ready-timeout' }
  | { status: 'ack-timeout' }
  | { status: 'closed'; sent: boolean }
  | { status: 'cancelled' };

export type HandoffPhase = 'waiting-ready' | 'waiting-ack';

export interface HandoffHandle {
  result: Promise<HandoffOutcome>;
  cancel: () => void;
  dispose: () => void;
}

export interface HandoffOptions {
  intent: ExportIntent;
  source: string;
  files: ExportFile[];
  onPhase?: (phase: HandoffPhase) => void;
}

export function startDocAiHandoff(_options: HandoffOptions): HandoffHandle {
  return {
    result: Promise.resolve({ status: 'rejected', reason: '이 사이트에서는 쓰지 않는 기능입니다. MD 저장으로 내려받으세요.' }),
    cancel: () => {},
    dispose: () => {},
  };
}
