-- 저장 공간 사용량 표시와 알림. 예전 schema.sql 로 표를 만들었다면 한 번 실행합니다.
ALTER TABLE photos ADD COLUMN web_size INTEGER;
ALTER TABLE photos ADD COLUMN thumb_size INTEGER;
-- 작은 설정값 (예: 용량 알림을 마지막으로 보낸 때)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
