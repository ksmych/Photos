// 공통 도우미: 응답, 인증(Cloudflare Access), 부서 비밀번호

const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status, message) {
  return json({ error: message }, status);
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/* ── Cloudflare Access 로그인 확인 ── */

let certCache = { at: 0, keys: [] };

async function accessKeys(team) {
  if (Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Access 인증서를 불러오지 못했습니다');
  const { keys } = await res.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

// 확인에 실패하면 이유를 lastAuthIssue 에 남깁니다 (관리 화면에 보여 줘서 설정 실수를 찾기 쉽게).
async function verifyAccessJwt(token, env, why) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) { why.reason = '로그인 표시(토큰) 모양이 잘못됨'; return null; }
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  let keys;
  try { keys = await accessKeys(env.ACCESS_TEAM_DOMAIN); }
  catch { why.reason = `팀 도메인(${env.ACCESS_TEAM_DOMAIN})에서 인증서를 못 받음: ACCESS_TEAM_DOMAIN 값을 확인`; return null; }
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { why.reason = `토큰을 만든 곳(${payload.iss || '?'})과 ACCESS_TEAM_DOMAIN(${env.ACCESS_TEAM_DOMAIN})이 다름`; return null; }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), enc.encode(`${h}.${p}`));
  if (!ok) { why.reason = '토큰 서명이 맞지 않음'; return null; }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) { why.reason = 'ACCESS_AUD 값이 로그인 앱의 AUD 와 다름'; return null; }
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) { why.reason = `팀 도메인이 다름: 토큰은 ${payload.iss}, 설정은 ${env.ACCESS_TEAM_DOMAIN}`; return null; }
  if (!payload.exp || payload.exp * 1000 < Date.now()) { why.reason = '로그인 기간이 지남: 다시 로그인 필요'; return null; }
  if (!payload.email) { why.reason = '토큰에 이메일이 없음'; return null; }
  return payload.email;
}

// 요청마다 로그인 실패 이유 (관리 화면 안내용, 비밀 값은 담지 않음)
export const authIssue = new WeakMap();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// 로그인한 사람과 권한을 돌려줍니다. 로그인하지 않았으면 null.
export async function getUser(request, env) {
  let email = null;
  const host = new URL(request.url).hostname;
  if (env.DEV_USER_EMAIL && LOCAL_HOSTS.has(host)) {
    const dev = request.headers.get('x-dev-user');
    email = dev === 'none' ? null : (dev || env.DEV_USER_EMAIL);
  } else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get('cf-access-jwt-assertion') || getCookie(request, 'CF_Authorization');
    if (token) {
      const why = {};
      try { email = await verifyAccessJwt(token, env, why); } catch { email = null; why.reason ||= '토큰을 읽지 못함'; }
      if (!email) authIssue.set(request, why.reason);
    } else {
      authIssue.set(request, '로그인 표시(CF_Authorization)가 없음: 아직 로그인 전');
    }
  } else {
    authIssue.set(request, 'ACCESS_TEAM_DOMAIN 또는 ACCESS_AUD 설정이 비어 있음');
  }
  if (!email) return null;
  email = email.toLowerCase();

  // 쉼표·세미콜론·띄어쓰기 어느 것으로 나눠도, 따옴표나 <> 로 감싸도 되게
  const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).map(s => s.replace(/^["'<]+|["'>]+$/g, '')).filter(Boolean);
  if (admins.includes(email)) return { email, role: 'admin', name: '관리자' };

  const row = await env.DB.prepare('SELECT name, role FROM users WHERE email = ?').bind(email).first();
  if (row) return { email, role: row.role, name: row.name };
  return { email, role: null, name: null };
}

export const isStaff = u => u && (u.role === 'admin' || u.role === 'uploader');
export const isAdmin = u => u && u.role === 'admin';

/* ── 부서 비밀번호 ── */

export async function hashPassword(password, saltHex) {
  const salt = saltHex || bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return { hash: bytesToHex(bits), salt };
}

async function hmac(env, text) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET 이 설정되지 않았습니다');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// 비밀번호가 바뀌면 pw_hash 가 바뀌므로 예전 쿠키는 자동으로 무효가 됩니다.
export async function deptToken(env, dept) {
  return hmac(env, `dept:${dept.id}:${dept.pw_hash}`);
}

export const deptCookieName = id => `dept_${id.replace(/[^a-z0-9-]/gi, '')}`;

// dept 에는 id, access, pw_hash 가 있어야 합니다.
export async function canViewDept(request, env, dept, user) {
  if (dept.access === 'public') return true;
  if (isStaff(user)) return true;
  if (dept.access === 'password') {
    if (!dept.pw_hash) return false;
    const c = getCookie(request, deptCookieName(dept.id));
    return !!c && c === await deptToken(env, dept);
  }
  if (!user) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM dept_viewers WHERE dept_id = ? AND email = ? AND status = 'approved'"
  ).bind(dept.id, user.email).first();
  return !!row;
}

export function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
