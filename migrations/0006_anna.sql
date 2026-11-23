-- 안나회(여성 어르신 부서)를 남전도회와 1여전도회 사이에 추가. 예전 schema.sql 로 표를 만들었다면 한 번 실행합니다.
INSERT OR IGNORE INTO depts (id, name, sort, access) VALUES ('anna', '안나회', 4, 'public');
UPDATE depts SET sort = 5 WHERE id = 'womens1';
UPDATE depts SET sort = 6 WHERE id = 'womens2';
UPDATE depts SET sort = 7 WHERE id = 'youth';
UPDATE depts SET sort = 8 WHERE id = 'teens';
UPDATE depts SET sort = 9 WHERE id = 'kids';
