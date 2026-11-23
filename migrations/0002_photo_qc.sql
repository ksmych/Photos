-- 처음 schema.sql 을 자동 선별 추가 전에 실행했다면 이것을 한 번 실행합니다.
ALTER TABLE photos ADD COLUMN qc_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE photos ADD COLUMN qc_flags TEXT;
ALTER TABLE photos ADD COLUMN qc_score REAL;
ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN hidden_by TEXT;
CREATE INDEX IF NOT EXISTS photos_qc ON photos (qc_status);
