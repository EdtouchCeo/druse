-- ============================================================
-- 교육활동 사진 게시판 — Supabase 초기 설정 (1회 실행)
-- 실행 위치: Supabase 대시보드 → SQL Editor → 붙여넣기 → Run
-- 프로젝트: aafpkfcxzdrguuctdwth (daeryun.life)
-- ============================================================

-- 게시물 테이블
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,                          -- 행사명
  event_date date not null,                     -- 일자
  description text default '',                  -- 주요 내용
  photos jsonb not null default '[]'::jsonb,    -- 사진 경로 배열 (Storage activity-photos 버킷)
  created_by text,                              -- 작성자 (users.id)
  created_by_name text,                         -- 작성자 이름 (표시용)
  created_at timestamptz not null default now()
);

-- RLS 활성화 + 정책 미부여 = anon 키 직접 접근 차단
-- (모든 읽기/쓰기는 Netlify 함수의 service key 경유로만 — 함수에서 교사 승인 여부 검증)
alter table public.activities enable row level security;

-- 조회 성능용 인덱스
create index if not exists activities_event_date_idx
  on public.activities (event_date desc, created_at desc);

-- 참고: Storage 버킷(activity-photos, 비공개)은 함수가 첫 업로드 시 자동 생성합니다.
