// 사진첩 API. 공개(/api/...)와 관리(/api/manage/...)로 나뉩니다.
import {
  json, fail, getUser, isStaff, isAdmin, hashPassword, deptToken, deptCookieName,
  canViewDept, timingSafeEqualHex,
} from '../_lib/util.js';

const MAX_ORIGINAL = 60 * 1024 * 1024;   // 원본 한 장 최대 60MB
const MAX_WEB = 8 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = (params.path || []).map(decodeURIComponent);
  const method = request.method;
  try {
    const user = await getUser(request, env);
    if (parts[0] === 'manage') return await manage(parts.slice(1), method, request, env, user);
    return await publicApi(parts, method, request, env, user);
  } catch (err) {
    console.error(err);
    return fail(500, '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/* ───────────── 공통 조회 ───────────── */

const ALBUM_COLS = `a.id, a.dept_id, a.title, a.event_date, a.status, a.created_by, a.created_at, a.reviewed_at,
  (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS count,
  (SELECT p.id FROM photos p WHERE p.album_id = a.id ORDER BY p.sort, p.created_at LIMIT 1) AS cover`;

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

async function albumPhotos(env, albumId) {
  const { results } = await env.DB.prepare(
    'SELECT id, width, height, orig_name, orig_size FROM photos WHERE album_id = ? ORDER BY sort, created_at'
  ).bind(albumId).all();
  return results;
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
      return json({ album, photos: await albumPhotos(env, id) });
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
