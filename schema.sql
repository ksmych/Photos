-- 경산목양교회 사진첩 데이터베이스 (Cloudflare D1)

CREATE TABLE IF NOT EXISTS depts (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  access   TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'password', 'members')),
           -- public: 누구나 / password: 비밀번호 아는 사람 / members: 관리자가 허락한 사람만
  pw_hash  TEXT,
  pw_salt  TEXT
);

-- 'members' 부서를 볼 수 있는 사람 (열람 요청 → 관리자 허락)
CREATE TABLE IF NOT EXISTS dept_viewers (
  dept_id    TEXT NOT NULL REFERENCES depts(id),
  email      TEXT NOT NULL,
  name       TEXT,
  status     TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dept_id, email)
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
  -- pending, approved: 부서 사진첩에 보임 / rejected: 사이트에서 내림 (메인 슬라이드쇼는 featured 표)
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
  web_size   INTEGER,                             -- 화면용 사진 크기 (저장 공간 계산용)
  thumb_size INTEGER,
  width      INTEGER,
  height     INTEGER,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 자동 선별 (GitHub Actions)
  qc_status  TEXT NOT NULL DEFAULT 'pending',     -- pending / done
  qc_flags   TEXT,                                -- 예: ["blurry","duplicate"]
  qc_score   REAL,                                -- 선명도
  qc_done_at TEXT,                                -- 선별 끝난 때. 걸러진 사진은 7일 뒤 자동 삭제
  hidden     INTEGER NOT NULL DEFAULT 0,          -- 1 이면 사이트에 안 보임
  hidden_by  TEXT                                 -- 'qc'(자동) 또는 'admin'(직접)
);
-- 메인 슬라이드쇼 기록. 가장 최근 줄이 지금 걸린 앨범이며 최소 7일 유지됩니다.
CREATE TABLE IF NOT EXISTS featured (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   TEXT NOT NULL,
  since      TEXT NOT NULL DEFAULT (datetime('now')),
  chosen_by  TEXT NOT NULL            -- 'auto' 또는 관리자 이메일
);

-- 작은 설정값 (예: 용량 알림을 마지막으로 보낸 때)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS photos_album ON photos (album_id, sort);
CREATE INDEX IF NOT EXISTS photos_qc ON photos (qc_status);

INSERT OR IGNORE INTO depts (id, name, sort, access) VALUES
  ('church-events', '교회행사', 1, 'public'),
  ('newcomers',     '새가족',   2, 'public'),
  ('mens',          '남전도회', 3, 'public'),
  ('womens1',       '1여전도회', 4, 'public'),
  ('womens2',       '2여전도회', 5, 'public'),
  ('youth',         '청년부',   6, 'public'),
  ('teens',         '중고등부', 7, 'members'),
  ('kids',          '유초등부', 8, 'members');
