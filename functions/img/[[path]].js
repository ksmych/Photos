// 사진 파일 내보내기: /img/thumb/<id>, /img/web/<id>, /img/orig/<id>
// 원본은 관리자만, 나머지는 승인된 앨범 + 부서 공개 여부에 따라.
import { getUser, isStaff, isAdmin, canViewDept } from '../_lib/util.js';

export async function onRequestGet({ request, env, params }) {
  const [kind, id] = params.path || [];
  if (!['thumb', 'web', 'orig'].includes(kind) || !id) return new Response('Not found', { status: 404 });

  const photo = await env.DB.prepare(
    `SELECT p.id, p.album_id, p.orig_key, p.orig_name, a.status, a.created_by, d.id AS dept_id, d.pw_hash
     FROM photos p JOIN albums a ON a.id = p.album_id JOIN depts d ON d.id = a.dept_id WHERE p.id = ?`
  ).bind(id).first();
  if (!photo) return new Response('Not found', { status: 404 });

  const user = await getUser(request, env);
  if (kind === 'orig') {
    if (!isAdmin(user)) return new Response('관리자만 원본을 받을 수 있습니다', { status: 403 });
  } else {
    const staffCanSee = isAdmin(user) || (isStaff(user) && photo.created_by === user.email);
    if (photo.status !== 'approved' && !staffCanSee) return new Response('Not found', { status: 404 });
    if (!(await canViewDept(request, env, { id: photo.dept_id, pw_hash: photo.pw_hash }, user))) {
      return new Response('비밀번호가 필요합니다', { status: 403 });
    }
  }

  const key = kind === 'orig' ? photo.orig_key : `${kind}/${photo.album_id}/${photo.id}.jpg`;
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  const isPublic = kind !== 'orig' && photo.status === 'approved' && !photo.pw_hash;
  headers.set('cache-control', isPublic ? 'public, max-age=86400' : 'private, max-age=3600');
  if (kind === 'orig') {
    const name = photo.orig_name || `${photo.id}.jpg`;
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(obj.body, { headers });
}
