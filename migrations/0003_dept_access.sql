-- 부서 공개 방식(공개/비밀번호/허락받은 사람만)과 열람 요청. 예전 schema.sql 로 표를 만들었다면 한 번 실행합니다.
ALTER TABLE depts ADD COLUMN access TEXT NOT NULL DEFAULT 'public';
UPDATE depts SET access = 'password' WHERE pw_hash IS NOT NULL;
UPDATE depts SET access = 'members' WHERE id IN ('teens', 'kids') AND pw_hash IS NULL;
CREATE TABLE IF NOT EXISTS dept_viewers (
  dept_id    TEXT NOT NULL REFERENCES depts(id),
  email      TEXT NOT NULL,
  name       TEXT,
  status     TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dept_id, email)
);
