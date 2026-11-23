-- 메인 슬라이드쇼 자동 선택(최소 7일 유지). 예전 schema.sql 로 표를 만들었다면 한 번 실행합니다.
-- 메인 슬라이드쇼 기록. 가장 최근 줄이 지금 걸린 앨범이며 최소 7일 유지됩니다.
CREATE TABLE IF NOT EXISTS featured (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   TEXT NOT NULL,
  since      TEXT NOT NULL DEFAULT (datetime('now')),
  chosen_by  TEXT NOT NULL            -- 'auto' 또는 관리자 이메일
);
