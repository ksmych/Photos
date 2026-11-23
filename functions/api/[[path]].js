// 사진첩 API. 공개(/api/...)와 관리(/api/manage/...)로 나뉩니다.
import {
  json, fail, getUser, isStaff, isAdmin, hashPassword, deptToken, deptCookieName,
  canViewDept, timingSafeEqualHex,
} from '../_lib/util.js';

const MAX_ORIGINAL = 60 * 1024 * 1024;   // 원본 한 장 최대 60MB
const MAX_WEB = 8 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REJECT_KEEP_DAYS = 7;   // 자동으로 걸러진 사진을 되살릴 수 있는 기간

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

// count/cover 는 사이트에 보이는 사진 기준, total 은 숨긴 사진 포함
const ALBUM_COLS = `a.id, a.dept_id, a.title, a.event_date, a.status, a.created_by, a.created_at, a.reviewed_at,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.hidden = 0) AS count,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS total,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.qc_status = 'pending') AS qc_pending,
  (SELECT p.id FROM photos p WHERE p.album_id = a.id AND p.hidden = 0 ORDER BY p.sort, p.created_at LIMIT 1) AS cover`;

async function listDepts(env) {
  const { results } = await env.DB.prepare('SELECT id, name, sort, pw_hash FROM depts ORDER BY sort').all();
  return results;
}

async function getDept(env, id) {
  return env.DB.prepare('SELECT id, name, pw_hash FROM depts WHERE id = ?').bind(id).first();
}

async function getAlbum(env, id) {
  return env.DB.prepare(`SELECT ${ALBUM_COLS} FROM albums a WHERE a.id = ?`).bind(id).first();
}

async function albumPhotos(env, albumId, { all = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, width, height, orig_name, orig_size, qc_status, qc_flags, qc_score, qc_done_at, hidden, hidden_by
     FROM photos WHERE album_id = ? ${all ? '' : 'AND hidden = 0'} ORDER BY sort, created_at`
  ).bind(albumId).all();
  return results.map(p => ({ ...p, qc_flags: p.qc_flags ? JSON.parse(p.qc_flags) : [] }));
}

const publicDept = d => ({ id: d.id, name: d.name, locked: !!d.pw_hash });

/* ───────────── 공개 API ───────────── */

async function publicApi(parts, method, request, env, user) {
  const [res, id, action] = parts;

  if (res === 'me' && method === 'GET') {
    return json({ user });
  }

  // 첫 화면: 부서 목록 + 최근 승인 앨범(슬라이드쇼) + 최근 앨범들
  if (res === 'home' && method === 'GET') {
    const depts = await listDepts(env);
    const open = depts.filter(d => !d.pw_hash).map(d => d.id);
    let featured = null;
    let recent = [];
    if (open.length) {
      const marks = open.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT ${ALBUM_COLS} FROM albums a WHERE a.status = 'approved' AND a.dept_id IN (${marks})
         ORDER BY a.reviewed_at DESC LIMIT 7`
      ).bind(...open).all();
      const withPhotos = results.filter(a => a.count > 0);
      if (withPhotos[0]) featured = { album: withPhotos[0], photos: await albumPhotos(env, withPhotos[0].id) };
      recent = withPhotos.slice(0, 6);
    }
    return json({ depts: depts.map(publicDept), featured, recent });
  }

  if (res === 'depts' && id && !action && method === 'GET') {
    const dept = await getDept(env, id);
    if (!dept) return fail(404, '없는 부서입니다');
    const unlocked = await canViewDept(request, env, dept, user);
    if (!unlocked) return json({ dept: publicDept(dept), unlocked: false, albums: [] });
    const { results } = await env.DB.prepare(
      `SELECT ${ALBUM_COLS} FROM albums a WHERE a.dept_id = ? AND a.status = 'approved'
       ORDER BY COALESCE(a.event_date, substr(a.reviewed_at, 1, 10)) DESC, a.reviewed_at DESC`
    ).bind(id).all();
    return json({ dept: publicDept(dept), unlocked: true, albums: results.filter(a => a.count > 0) });
  }

  if (res === 'depts' && id && action === 'unlock' && method === 'POST') {
    const dept = await getDept(env, id);
    if (!dept) return fail(404, '없는 부서입니다');
    if (!dept.pw_hash) return json({ ok: true });
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
    if (album.status !== 'approved' && !staff) return fail(404, '없는 앨범입니다');
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
    if (status) { where.push('a.status = ?'); binds.push(status); }
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
        `INSERT INTO photos (id, album_id, orig_key, orig_name, orig_type, orig_size, width, height, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(photoId, id, origKey, orig.name.slice(0, 200), orig.type, orig.size,
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
    if ((action === 'approve' || action === 'reject') && method === 'POST') {
      const status = action === 'approve' ? 'approved' : 'rejected';
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

  // 부서 비밀번호 설정/해제
  if (res === 'depts' && id && action === 'password' && method === 'POST') {
    if (!(await getDept(env, id))) return fail(404, '없는 부서입니다');
    const body = await request.json().catch(() => ({}));
    const pw = body.password ? String(body.password) : '';
    if (!pw) {
      await env.DB.prepare('UPDATE depts SET pw_hash = NULL, pw_salt = NULL WHERE id = ?').bind(id).run();
    } else {
      if (pw.length < 4) return fail(400, '비밀번호는 4자 이상으로 정해 주세요');
      const { hash, salt } = await hashPassword(pw);
      await env.DB.prepare('UPDATE depts SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, id).run();
    }
    return json({ ok: true });
  }

  // 원본 백업 목록 (연도별)
  if (res === 'export' && method === 'GET') {
    const year = new URL(request.url).searchParams.get('year') || '';
    if (!/^\d{4}$/.test(year)) return fail(400, '연도를 골라 주세요');
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.orig_name, p.orig_size, a.id AS album_id, a.title, a.event_date, d.name AS dept_name
       FROM photos p JOIN albums a ON a.id = p.album_id JOIN depts d ON d.id = a.dept_id
       WHERE a.status = 'approved' AND substr(COALESCE(a.event_date, a.created_at), 1, 4) = ?
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
