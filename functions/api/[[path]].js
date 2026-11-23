// 사진첩 API. 공개(/api/...)와 관리(/api/manage/...)로 나뉩니다.
import {
  json, fail, getUser, isStaff, isAdmin, hashPassword, deptToken, deptCookieName,
  canViewDept, timingSafeEqualHex,
} from '../_lib/util.js';

const MAX_ORIGINAL = 60 * 1024 * 1024;   // 원본 한 장 최대 60MB
const MAX_WEB = 8 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REJECT_KEEP_DAYS = 7;   // 자동으로 걸러진 사진을 되살릴 수 있는 기간
const FREE_BYTES = 10 * 1024 ** 3;          // R2 무료 10GB
const ALERT_BYTES = 8 * 1024 ** 3;          // 8GB 넘으면 알림
const ALERT_EVERY_DAYS = 7;                 // 알림 메일은 일주일에 한 번까지

// 저장 공간 사용량 (원본 + 화면용 + 목록용). 예전 사진처럼 크기 기록이 없으면 원본의 10%로 어림합니다.
async function storageUsage(env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS photos,
       COALESCE(SUM(COALESCE(orig_size, 0) + COALESCE(web_size, orig_size * 0.08, 0) + COALESCE(thumb_size, orig_size * 0.02, 0)), 0) AS bytes
     FROM photos`
  ).first();
  const bytes = Math.round(row.bytes);
  return { photos: row.photos, bytes, free_bytes: FREE_BYTES, alert_bytes: ALERT_BYTES, over_alert: bytes >= ALERT_BYTES };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = (params.path || []).map(decodeURIComponent);
  const method = request.method;
  try {
    const user = await getUser(request, env);
    if (parts[0] === 'manage') return await manage(parts.slice(1), method, request, env, user);
    if (parts[0] === 'qc') return await qcApi(parts.slice(1), method, request, env);
    return await publicApi(parts, method, request, env, user);
  } catch (err) {
    console.error(err);
    return fail(500, '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/* ───────────── 공통 조회 ───────────── */

// 사이트에 보이는 사진: 선별이 끝났고 빠지지 않은 사진
const SHOWN = "p.hidden = 0 AND p.qc_status = 'done'";
// 사이트에 보이는 앨범: 내리지 않은 앨범 (approved 는 예전 값, pending 과 같음)
const VISIBLE = "a.status IN ('pending', 'approved')";

// count/cover 는 사이트에 보이는 사진 기준, total 은 숨긴 사진 포함
const ALBUM_COLS = `a.id, a.dept_id, a.title, a.event_date, a.status, a.created_by, a.created_at, a.reviewed_at,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND ${SHOWN}) AS count,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS total,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.qc_status = 'pending') AS qc_pending,
  (SELECT p.id FROM photos p WHERE p.album_id = a.id AND ${SHOWN} ORDER BY p.sort, p.created_at LIMIT 1) AS cover`;

async function listDepts(env) {
  const { results } = await env.DB.prepare('SELECT id, name, sort, access, pw_hash FROM depts ORDER BY sort').all();
  return results;
}

async function getDept(env, id) {
  return env.DB.prepare('SELECT id, name, access, pw_hash FROM depts WHERE id = ?').bind(id).first();
}

async function getAlbum(env, id) {
  return env.DB.prepare(`SELECT ${ALBUM_COLS} FROM albums a WHERE a.id = ?`).bind(id).first();
}

async function albumPhotos(env, albumId, { all = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, width, height, orig_name, orig_size, qc_status, qc_flags, qc_score, qc_done_at, hidden, hidden_by
     FROM photos p WHERE album_id = ? ${all ? '' : 'AND ' + SHOWN} ORDER BY sort, created_at`
  ).bind(albumId).all();
  return results.map(p => ({ ...p, qc_flags: p.qc_flags ? JSON.parse(p.qc_flags) : [] }));
}

// 걸린 때(UTC 문자열) 다음에 오는 첫 월요일 0시(한국 시간)를 UTC 밀리초로
function nextMondayKst(since) {
  const KST = 9 * 3600000;
  const k = new Date(Date.parse(since.replace(' ', 'T') + 'Z') + KST);
  const days = ((8 - k.getUTCDay()) % 7) || 7;
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days) - KST;
}

// 지금 메인 슬라이드쇼에 걸 앨범. 걸린 뒤 첫 월요일 0시(주일 밤 자정)까지는 그대로 두고,
// 그때가 지났거나 걸린 앨범이 내려졌으면 공개 부서의 가장 최근 앨범으로 바꿉니다.
async function currentFeatured(env) {
  const depts = await listDepts(env);
  const open = depts.filter(d => d.access === 'public').map(d => d.id);
  const cur = await env.DB.prepare(
    'SELECT album_id, since, chosen_by FROM featured ORDER BY id DESC LIMIT 1'
  ).first();
  const curAlbum = cur ? await getAlbum(env, cur.album_id) : null;
  const valid = !!curAlbum && curAlbum.status !== 'rejected' && curAlbum.count > 0 && open.includes(curAlbum.dept_id);
  const pack = (album, row) => ({
    album, since: row.since, chosen_by: row.chosen_by,
    until: new Date(nextMondayKst(row.since)).toISOString(),
  });
  if (valid && Date.now() < nextMondayKst(cur.since)) return pack(curAlbum, cur);
  if (!open.length) return null;
  const marks = open.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT ${ALBUM_COLS} FROM albums a WHERE ${VISIBLE} AND a.dept_id IN (${marks}) ORDER BY a.created_at DESC LIMIT 10`
  ).bind(...open).all();
  const newest = results.find(a => a.count > 0);
  if (!newest) return valid ? pack(curAlbum, cur) : null;
  await env.DB.prepare("INSERT INTO featured (album_id, chosen_by) VALUES (?, 'auto')").bind(newest.id).run();
  const row = await env.DB.prepare('SELECT since, chosen_by FROM featured ORDER BY id DESC LIMIT 1').first();
  return pack(newest, row);
}

const publicDept = d => ({ id: d.id, name: d.name, access: d.access, locked: d.access !== 'public' });

/* ───────────── 공개 API ───────────── */

async function publicApi(parts, method, request, env, user) {
  const [res, id, action] = parts;

  if (res === 'me' && method === 'GET') {
    return json({ user });
  }

  // 첫 화면: 부서 목록 + 메인에 건 최근 앨범(슬라이드쇼) + 새로 올라온 앨범들 (공개 부서만)
  if (res === 'home' && method === 'GET') {
    const depts = await listDepts(env);
    const open = depts.filter(d => d.access === 'public').map(d => d.id);
    let featured = null;
    let recent = [];
    const cur = await currentFeatured(env);
    if (cur) featured = { album: cur.album, photos: await albumPhotos(env, cur.album.id) };
    if (open.length) {
      const marks = open.map(() => '?').join(',');
      const { results: rec } = await env.DB.prepare(
        `SELECT ${ALBUM_COLS} FROM albums a WHERE ${VISIBLE} AND a.dept_id IN (${marks})
         ORDER BY a.created_at DESC LIMIT 12`
      ).bind(...open).all();
      recent = rec.filter(a => a.count > 0).slice(0, 6);
    }
    return json({ depts: depts.map(publicDept), featured, recent });
  }

  if (res === 'depts' && id && !action && method === 'GET') {
    const dept = await getDept(env, id);
    if (!dept) return fail(404, '없는 부서입니다');
    const unlocked = await canViewDept(request, env, dept, user);
    if (!unlocked) {
      let request_status = null;
      if (dept.access === 'members' && user) {
        const row = await env.DB.prepare('SELECT status FROM dept_viewers WHERE dept_id = ? AND email = ?')
          .bind(id, user.email).first();
        request_status = row ? row.status : 'none';
      }
      return json({ dept: publicDept(dept), unlocked: false, albums: [], logged_in: !!user, request_status });
    }
    const { results } = await env.DB.prepare(
      `SELECT ${ALBUM_COLS} FROM albums a WHERE a.dept_id = ? AND ${VISIBLE}
       ORDER BY COALESCE(a.event_date, substr(a.created_at, 1, 10)) DESC, a.created_at DESC`
    ).bind(id).all();
    return json({ dept: publicDept(dept), unlocked: true, albums: results.filter(a => a.count > 0) });
  }

  // 허락받은 사람만 보는 부서: 로그인한 사람이 열람 요청
  if (res === 'depts' && id && action === 'request' && method === 'POST') {
    if (!user) return fail(401, '먼저 로그인해 주세요');
    const dept = await getDept(env, id);
    if (!dept || dept.access !== 'members') return fail(400, '요청할 수 없는 부서입니다');
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return fail(400, '이름을 적어 주세요 (예: 홍길동, 김철수 학생 엄마)');
    await env.DB.prepare(
      `INSERT INTO dept_viewers (dept_id, email, name) VALUES (?, ?, ?)
       ON CONFLICT(dept_id, email) DO UPDATE SET name = excluded.name`
    ).bind(id, user.email, name).run();
    return json({ ok: true });
  }

  if (res === 'depts' && id && action === 'unlock' && method === 'POST') {
    const dept = await getDept(env, id);
    if (!dept) return fail(404, '없는 부서입니다');
    if (dept.access !== 'password' || !dept.pw_hash) return fail(400, '비밀번호 부서가 아닙니다');
    const body = await request.json().catch(() => ({}));
    const pw = String(body.password || '');
    const full = await env.DB.prepare('SELECT pw_salt FROM depts WHERE id = ?').bind(id).first();
    const { hash } = await hashPassword(pw, full.pw_salt);
    if (!timingSafeEqualHex(hash, dept.pw_hash)) return fail(403, '비밀번호가 맞지 않습니다');
    const token = await deptToken(env, dept);
    const cookie = `${deptCookieName(id)}=${token}; Path=/; Max-Age=${60 * 60 * 24 * 180}; HttpOnly; Secure; SameSite=Lax`;
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (res === 'albums' && id && method === 'GET') {
    const album = await getAlbum(env, id);
    if (!album) return fail(404, '없는 앨범입니다');
    const dept = await getDept(env, album.dept_id);
    const staff = isStaff(user);
    if (album.status === 'rejected' && !staff) return fail(404, '없는 앨범입니다');
    if (!(await canViewDept(request, env, dept, user))) {
      return json({ locked: true, dept: publicDept(dept) }, 403);
    }
    return json({ album, dept: publicDept(dept), photos: await albumPhotos(env, id) });
  }

  return fail(404, '없는 주소입니다');
}

/* ───────────── 관리 API (로그인 필요) ───────────── */

async function manage(parts, method, request, env, user) {
  if (!user) return fail(401, '로그인이 필요합니다');
  if (!isStaff(user)) return fail(403, '사진 올리기 권한이 없습니다. 관리자에게 등록을 요청해 주세요.');
  const [res, id, action] = parts;

  if (res === 'depts' && !id && method === 'GET') {
    const depts = await listDepts(env);
    return json({ depts: depts.map(publicDept) });
  }

  // 앨범 만들기 (올리는 사람)
  if (res === 'albums' && !id && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || '').trim().slice(0, 80);
    const deptId = String(body.dept_id || '');
    const eventDate = body.event_date ? String(body.event_date) : null;
    if (!title) return fail(400, '앨범 이름을 적어 주세요');
    if (eventDate && !DATE_RE.test(eventDate)) return fail(400, '날짜 형식이 맞지 않습니다');
    if (!(await getDept(env, deptId))) return fail(400, '부서를 골라 주세요');
    const albumId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO albums (id, dept_id, title, event_date, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(albumId, deptId, title, eventDate, user.email).run();
    return json({ album: await getAlbum(env, albumId) }, 201);
  }

  // 내가 올린 앨범 (관리자는 전체)
  if (res === 'albums' && !id && method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const where = [];
    const binds = [];
    if (!isAdmin(user)) { where.push('a.created_by = ?'); binds.push(user.email); }
    if (status === 'visible') where.push(VISIBLE);
    else if (status) { where.push('a.status = ?'); binds.push(status); }
    const { results } = await env.DB.prepare(
      `SELECT ${ALBUM_COLS}, d.name AS dept_name FROM albums a JOIN depts d ON d.id = a.dept_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC LIMIT 200`
    ).bind(...binds).all();
    return json({ albums: results });
  }

  if (res === 'albums' && id) {
    const album = await getAlbum(env, id);
    if (!album) return fail(404, '없는 앨범입니다');
    const mine = album.created_by === user.email;
    const canEdit = isAdmin(user) || (mine && album.status === 'pending');

    if (!action && method === 'GET') {
      if (!isAdmin(user) && !mine) return fail(403, '권한이 없습니다');
      return json({ album, photos: await albumPhotos(env, id, { all: true }) });
    }

    // 올리기를 마쳤을 때: 자동 선별(GitHub Actions)을 깨웁니다
    if (action === 'done' && method === 'POST') {
      if (!isAdmin(user) && !mine) return fail(403, '권한이 없습니다');
      const triggered = await triggerQc(env);
      return json({ ok: true, triggered });
    }

    // 사진 한 장 올리기: 원본 + 웹용 + 썸네일
    if (action === 'photos' && method === 'POST') {
      if (!canEdit) return fail(403, '이 앨범에는 사진을 더할 수 없습니다');
      const form = await request.formData();
      const orig = form.get('original');
      const web = form.get('web');
      const thumb = form.get('thumb');
      if (!(orig instanceof File) || !(web instanceof File) || !(thumb instanceof File)) {
        return fail(400, '사진 파일이 빠졌습니다');
      }
      if (orig.size > MAX_ORIGINAL) return fail(413, '사진 한 장이 너무 큽니다 (60MB 이하)');
      if (web.size > MAX_WEB || thumb.size > MAX_WEB) return fail(413, '변환된 사진이 너무 큽니다');
      if (!/^image\//.test(orig.type || 'image/')) return fail(400, '사진 파일만 올릴 수 있습니다');

      const photoId = crypto.randomUUID();
      const ext = (orig.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'jpg').toLowerCase();
      const origKey = `orig/${id}/${photoId}.${ext}`;
      await env.PHOTOS.put(origKey, orig.stream(), { httpMetadata: { contentType: orig.type || 'application/octet-stream' } });
      await env.PHOTOS.put(`web/${id}/${photoId}.jpg`, web.stream(), { httpMetadata: { contentType: 'image/jpeg' } });
      await env.PHOTOS.put(`thumb/${id}/${photoId}.jpg`, thumb.stream(), { httpMetadata: { contentType: 'image/jpeg' } });

      const sort = Number(form.get('sort')) || 0;
      await env.DB.prepare(
        `INSERT INTO photos (id, album_id, orig_key, orig_name, orig_type, orig_size, web_size, thumb_size, width, height, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(photoId, id, origKey, orig.name.slice(0, 200), orig.type, orig.size, web.size, thumb.size,
        Number(form.get('width')) || null, Number(form.get('height')) || null, sort).run();
      return json({ photo: { id: photoId } }, 201);
    }

    if (!isAdmin(user)) {
      // 올린 사람은 승인 전 자기 앨범을 지울 수 있음
      if (!action && method === 'DELETE' && mine && album.status === 'pending') {
        await deleteAlbum(env, id);
        return json({ ok: true });
      }
      return fail(403, '관리자만 할 수 있습니다');
    }

    // 아래는 관리자 전용
    // 메인에 걸기: 이 앨범을 지금부터 다음 월요일 0시까지 메인 슬라이드쇼에
    if (action === 'feature' && method === 'POST') {
      const dept = await getDept(env, album.dept_id);
      if (album.status === 'rejected') return fail(400, '내린 앨범은 메인에 걸 수 없습니다');
      if (dept.access !== 'public') return fail(400, '전체 공개 부서의 앨범만 메인에 걸 수 있습니다');
      if (!album.count) return fail(400, '보이는 사진이 없는 앨범입니다');
      await env.DB.prepare('INSERT INTO featured (album_id, chosen_by) VALUES (?, ?)').bind(id, user.email).run();
      return json({ featured: await currentFeatured(env) });
    }

    // restore: 다시 올리기 / reject: 사이트에서 내리기
    if (['restore', 'reject'].includes(action) && method === 'POST') {
      const status = { restore: 'pending', reject: 'rejected' }[action];
      await env.DB.prepare(
        "UPDATE albums SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?"
      ).bind(status, user.email, id).run();
      return json({ album: await getAlbum(env, id) });
    }

    if (!action && method === 'PATCH') {
      const body = await request.json().catch(() => ({}));
      const title = body.title != null ? String(body.title).trim().slice(0, 80) : album.title;
      const eventDate = body.event_date !== undefined ? (body.event_date || null) : album.event_date;
      const deptId = body.dept_id || album.dept_id;
      if (!title) return fail(400, '앨범 이름을 적어 주세요');
      if (eventDate && !DATE_RE.test(eventDate)) return fail(400, '날짜 형식이 맞지 않습니다');
      if (!(await getDept(env, deptId))) return fail(400, '없는 부서입니다');
      await env.DB.prepare('UPDATE albums SET title = ?, event_date = ?, dept_id = ? WHERE id = ?')
        .bind(title, eventDate, deptId, id).run();
      return json({ album: await getAlbum(env, id) });
    }

    if (!action && method === 'DELETE') {
      await deleteAlbum(env, id);
      return json({ ok: true });
    }
  }

  // 저장 공간 사용량 (관리자 화면 위쪽에 표시)
  if (res === 'usage' && method === 'GET') {
    if (!isAdmin(user)) return fail(403, '관리자만 할 수 있습니다');
    return json(await storageUsage(env));
  }

  // 지금 메인 슬라이드쇼 (관리자 화면용) / 자동으로 되돌리기
  if (res === 'featured' && !id && method === 'GET') {
    return json({ featured: await currentFeatured(env) });
  }
  if (res === 'featured' && id === 'auto' && method === 'POST') {
    if (!isAdmin(user)) return fail(403, '관리자만 할 수 있습니다');
    await env.DB.prepare('DELETE FROM featured').run();
    return json({ featured: await currentFeatured(env) });
  }

  // 사진 보이기/빼기 (관리자): 자동 선별 결과를 직접 바꿈
  if (res === 'photos' && id && action === 'visibility' && method === 'POST') {
    if (!isAdmin(user)) return fail(403, '관리자만 할 수 있습니다');
    const body = await request.json().catch(() => ({}));
    await env.DB.prepare("UPDATE photos SET hidden = ?, hidden_by = 'admin' WHERE id = ?")
      .bind(body.hidden ? 1 : 0, id).run();
    return json({ ok: true });
  }

  if (res === 'photos' && id && method === 'DELETE') {
    const photo = await env.DB.prepare(
      'SELECT p.*, a.created_by, a.status FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.id = ?'
    ).bind(id).first();
    if (!photo) return fail(404, '없는 사진입니다');
    const allowed = isAdmin(user) || (photo.created_by === user.email && photo.status === 'pending');
    if (!allowed) return fail(403, '권한이 없습니다');
    await deletePhotoObjects(env, photo);
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  if (!isAdmin(user)) return fail(403, '관리자만 할 수 있습니다');

  // 사진 올리는 사람 관리
  if (res === 'users' && !id && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT email, name, role, created_at FROM users ORDER BY created_at').all();
    return json({ users: results });
  }
  if (res === 'users' && !id && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 40);
    const role = body.role === 'admin' ? 'admin' : 'uploader';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, '이메일 주소가 맞지 않습니다');
    await env.DB.prepare(
      'INSERT INTO users (email, name, role) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role'
    ).bind(email, name, role).run();
    return json({ ok: true }, 201);
  }
  if (res === 'users' && id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(id.toLowerCase()).run();
    return json({ ok: true });
  }

  // 부서 공개 방식: public / password(비밀번호 함께) / members
  if (res === 'depts' && id && action === 'access' && method === 'POST') {
    if (!(await getDept(env, id))) return fail(404, '없는 부서입니다');
    const body = await request.json().catch(() => ({}));
    const access = String(body.access || '');
    if (access === 'password') {
      const pw = String(body.password || '');
      if (pw.length < 4) return fail(400, '비밀번호는 4자 이상으로 정해 주세요');
      const { hash, salt } = await hashPassword(pw);
      await env.DB.prepare("UPDATE depts SET access = 'password', pw_hash = ?, pw_salt = ? WHERE id = ?")
        .bind(hash, salt, id).run();
    } else if (access === 'public' || access === 'members') {
      await env.DB.prepare('UPDATE depts SET access = ?, pw_hash = NULL, pw_salt = NULL WHERE id = ?')
        .bind(access, id).run();
    } else {
      return fail(400, '공개 방식을 골라 주세요');
    }
    return json({ ok: true });
  }

  // 열람 요청과 허락한 사람
  if (res === 'viewers' && !id && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT v.dept_id, d.name AS dept_name, v.email, v.name, v.status, v.created_at
       FROM dept_viewers v JOIN depts d ON d.id = v.dept_id ORDER BY v.status DESC, v.created_at DESC`
    ).all();
    return json({ viewers: results });
  }
  if (res === 'viewers' && !id && method === 'POST') {
    // 허락하기 (요청 승인 또는 직접 추가)
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const deptId = String(body.dept_id || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, '이메일 주소가 맞지 않습니다');
    if (!(await getDept(env, deptId))) return fail(400, '부서를 골라 주세요');
    await env.DB.prepare(
      `INSERT INTO dept_viewers (dept_id, email, name, status) VALUES (?, ?, ?, 'approved')
       ON CONFLICT(dept_id, email) DO UPDATE SET status = 'approved', name = COALESCE(NULLIF(excluded.name, ''), dept_viewers.name)`
    ).bind(deptId, email, String(body.name || '').trim().slice(0, 40)).run();
    return json({ ok: true });
  }
  if (res === 'viewers' && id === 'remove' && method === 'POST') {
    // 거절하기 / 허락 취소
    const body = await request.json().catch(() => ({}));
    await env.DB.prepare('DELETE FROM dept_viewers WHERE dept_id = ? AND email = ?')
      .bind(String(body.dept_id || ''), String(body.email || '').toLowerCase()).run();
    return json({ ok: true });
  }

  // 원본 백업 목록 (연도별)
  if (res === 'export' && method === 'GET') {
    const year = new URL(request.url).searchParams.get('year') || '';
    if (!/^\d{4}$/.test(year)) return fail(400, '연도를 골라 주세요');
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.orig_name, p.orig_size, a.id AS album_id, a.title, a.event_date, d.name AS dept_name
       FROM photos p JOIN albums a ON a.id = p.album_id JOIN depts d ON d.id = a.dept_id
       WHERE a.status != 'rejected' AND p.hidden = 0 AND substr(COALESCE(a.event_date, a.created_at), 1, 4) = ?
       ORDER BY d.sort, a.event_date, a.title, p.sort, p.created_at`
    ).bind(year).all();
    return json({ photos: results });
  }

  return fail(404, '없는 주소입니다');
}

async function deletePhotoObjects(env, photo) {
  await env.PHOTOS.delete([
    photo.orig_key,
    `web/${photo.album_id}/${photo.id}.jpg`,
    `thumb/${photo.album_id}/${photo.id}.jpg`,
  ]);
}

async function deleteAlbum(env, albumId) {
  const { results } = await env.DB.prepare('SELECT id, album_id, orig_key FROM photos WHERE album_id = ?').bind(albumId).all();
  for (const p of results) await deletePhotoObjects(env, p);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photos WHERE album_id = ?').bind(albumId),
    env.DB.prepare('DELETE FROM featured WHERE album_id = ?').bind(albumId),
    env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(albumId),
  ]);
}

/* ───────────── 자동 선별 API (GitHub Actions 전용) ───────────── */

async function triggerQc(env) {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/photo-qc.yml/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'church-photo-album',
      },
      body: JSON.stringify({ ref: env.GH_BRANCH || 'main' }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

async function qcApi(parts, method, request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!env.QC_TOKEN || !timingSafeEqualHex(auth, `Bearer ${env.QC_TOKEN}`)) return fail(401, 'unauthorized');
  const [res, id, action] = parts;

  if (res === 'pending' && method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT album_id FROM photos WHERE qc_status = 'pending' LIMIT 50"
    ).all();
    return json({ albums: results.map(r => r.album_id) });
  }

  if (res === 'albums' && id && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id FROM photos WHERE album_id = ? ORDER BY sort, created_at'
    ).bind(id).all();
    return json({ photos: results });
  }

  if (res === 'photos' && id && action === 'web' && method === 'GET') {
    const photo = await env.DB.prepare('SELECT id, album_id FROM photos WHERE id = ?').bind(id).first();
    if (!photo) return fail(404, 'not found');
    const obj = await env.PHOTOS.get(`web/${photo.album_id}/${photo.id}.jpg`);
    if (!obj) return fail(404, 'not found');
    return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  }

  // 결과 적기. 관리자가 직접 보이기/빼기 한 사진은 건드리지 않음
  if (res === 'albums' && id && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const stmts = [];
    for (const [photoId, r] of Object.entries(body.results || {})) {
      const hidden = r.recommended ? 0 : 1;
      stmts.push(env.DB.prepare(
        `UPDATE photos SET qc_status = 'done', qc_flags = ?, qc_score = ?, qc_done_at = datetime('now'),
           hidden = CASE WHEN hidden_by = 'admin' THEN hidden ELSE ? END,
           hidden_by = CASE WHEN hidden_by = 'admin' THEN hidden_by ELSE 'qc' END
         WHERE id = ? AND album_id = ?`
      ).bind(JSON.stringify(r.flags || []), r.score ?? null, hidden, photoId, id));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, updated: stmts.length });
  }

  // 저장 공간 확인 (GitHub Actions 가 6시간마다). 8GB 넘었고 최근 일주일 안에 알리지 않았으면 send_alert
  if (res === 'usage' && !id && method === 'GET') {
    const usage = await storageUsage(env);
    const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'usage_alert_at'").first();
    const recent = last && Date.now() - Date.parse(last.value) < ALERT_EVERY_DAYS * 86400000;
    return json({ ...usage, send_alert: usage.over_alert && !recent });
  }
  if (res === 'usage' && id === 'alerted' && method === 'POST') {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('usage_alert_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(new Date().toISOString()).run();
    return json({ ok: true });
  }

  // 걸러진 지 7일 지난 사진 지우기 (관리자가 되살리지 않은 것만)
  if (res === 'cleanup' && method === 'POST') {
    const { results } = await env.DB.prepare(
      `SELECT id, album_id, orig_key FROM photos
       WHERE hidden = 1 AND hidden_by = 'qc' AND qc_done_at < datetime('now', ?) LIMIT 500`
    ).bind(`-${REJECT_KEEP_DAYS} days`).all();
    for (const p of results) {
      await deletePhotoObjects(env, p);
      await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(p.id).run();
    }
    return json({ ok: true, deleted: results.length });
  }

  return fail(404, 'not found');
}
