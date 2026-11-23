-- 경산목양교회 사진첩 데이터베이스 (Cloudflare D1)

CREATE TABLE IF NOT EXISTS depts (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  pw_hash  TEXT,          -- 비밀번호 보호 부서만 값이 있음
  pw_salt  TEXT
);

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'uploader')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS albums (
  id          TEXT PRIMARY KEY,
  dept_id     TEXT NOT NULL REFERENCES depts(id),
  title       TEXT NOT NULL,
  event_date  TEXT,                               -- YYYY-MM-DD
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS albums_dept ON albums (dept_id, status);
CREATE INDEX IF NOT EXISTS albums_reviewed ON albums (status, reviewed_at);

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  album_id   TEXT NOT NULL REFERENCES albums(id),
  orig_key   TEXT NOT NULL,
  orig_name  TEXT,
  orig_type  TEXT,
  orig_size  INTEGER,
  width      INTEGER,
  height     INTEGER,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 자동 선별 (GitHub Actions)
  qc_status  TEXT NOT NULL DEFAULT 'pending',     -- pending / done
  qc_flags   TEXT,                                -- 예: ["blurry","duplicate"]
  qc_score   REAL,                                -- 선명도
  hidden     INTEGER NOT NULL DEFAULT 0,          -- 1 이면 사이트에 안 보임
  hidden_by  TEXT                                 -- 'qc'(자동) 또는 'admin'(직접)
);
CREATE INDEX IF NOT EXISTS photos_album ON photos (album_id, sort);
CREATE INDEX IF NOT EXISTS photos_qc ON photos (qc_status);

INSERT OR IGNORE INTO depts (id, name, sort) VALUES
  ('church-events', '교회행사', 1),
  ('newcomers',     '새가족',   2),
  ('mens',          '남전도회', 3),
  ('womens1',       '1여전도회', 4),
  ('womens2',       '2여전도회', 5),
  ('youth',         '청년부',   6),
  ('teens',         '중고등부', 7),
  ('kids',          '유초등부', 8);
