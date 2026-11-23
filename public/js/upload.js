// 사진 올리기: 부서/앨범을 정하고 사진을 고르면, 휴대폰에서 웹용·작은 사진을 만들어 원본과 함께 보냅니다.
const WEB_MAX = 1920;   // 화면용 긴 변
const THUMB_MAX = 480;  // 목록용 긴 변

(async function () {
  const content = $('#content');
  let me;
  try { me = (await api('/api/me')).user; } catch { me = null; }
  if (!me) {
    content.replaceChildren(h('div', { class: 'notice' }, '로그인이 필요합니다. 이 화면을 다시 열어 주세요.'));
    return;
  }
  if (!me.role) {
    content.replaceChildren(h('div', { class: 'notice' },
      `${me.email} 은(는) 아직 사진 올리기에 등록되지 않았습니다. 목사님께 등록을 부탁해 주세요.`));
    return;
  }
  const { depts } = await api('/api/manage/depts');
  // 카카오톡 등에서 "공유 → 사진첩" 으로 넘어온 사진
  let shared = [];
  const sharedFlag = param('shared');
  if (sharedFlag === '1') shared = await takeSharedFiles();
  if (sharedFlag) history.replaceState(null, '', '/upload.html');
  showStart(sharedFlag === 'fail' || (sharedFlag === '1' && !shared.length)
    ? '공유한 사진을 받지 못했습니다. 아래에서 앨범을 만든 뒤 "사진 고르기"로 올려 주세요.' : null);

  async function showStart(warn) {
    const deptSel = h('select', { required: true },
      h('option', { value: '' }, '부서를 고르세요'),
      depts.map(d => h('option', { value: d.id }, d.name)));
    const title = h('input', { type: 'text', maxlength: 80, placeholder: '예: 추수감사주일 성례식', required: true, style: 'flex:1;min-width:0' });
    const date = h('input', { type: 'date', value: new Date().toLocaleDateString('sv-SE'), required: true });
    // 앨범 이름 앞에 날짜가 자동으로 붙습니다: 20261115_추수감사주일 성례식
    const prefix = h('span', { style: 'font-weight:700;white-space:nowrap' });
    const preview = h('div', { class: 'meta', style: 'font-weight:400;color:var(--muted)' });
    const refresh = () => {
      const d = (date.value || '').replace(/-/g, '');
      prefix.textContent = d ? `${d}_` : '';
      const name = title.value.trim().replace(/^\d{8}_\s*/, '');
      preview.textContent = name ? `앨범 이름: ${d}_${name}` : '날짜는 자동으로 앞에 붙습니다.';
    };
    date.addEventListener('input', refresh);
    title.addEventListener('input', refresh);
    refresh();
    const msg = h('div', { class: 'error', role: 'alert' });
    const form = h('form', { class: 'form' },
      shared.length
        ? h('p', { style: 'font-weight:700;color:var(--ok)' }, `공유한 사진 ${shared.length}장을 받았습니다. 새 앨범을 만들거나, 아래 "내가 올린 앨범"에서 고르세요.`)
        : h('p', {}, `${me.name || me.email} 님, 새 앨범을 만들어 사진을 올립니다.`),
      warn ? h('p', { class: 'error' }, warn) : null,
      h('label', {}, '① 부서', deptSel),
      h('label', {}, '② 행사 날짜', date),
      h('label', {}, '③ 행사 이름', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, prefix, title), preview),
      msg,
      h('button', { class: 'btn', type: 'submit' }, shared.length ? `이 앨범에 ${shared.length}장 올리기` : '다음: 사진 고르기'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      msg.textContent = '';
      try {
        const { album } = await api('/api/manage/albums', {
          json: { dept_id: deptSel.value, title: title.value, event_date: date.value || null } });
        useAlbum(album);
      } catch (err) { msg.textContent = err.message; }
    });
    content.replaceChildren(form, h('h2', {}, '내가 올린 앨범'), await myAlbums());
    if (!shared.length) content.append(installHint());
  }

  function useAlbum(album) {
    if (shared.length) {
      const files = shared;
      shared = [];
      runUpload(album, files);
    } else {
      showPick(album);
    }
  }

  async function myAlbums() {
    const { albums } = await api('/api/manage/albums');
    if (!albums.length) return h('div', { class: 'notice' }, '아직 올린 앨범이 없습니다.');
    const label = { pending: '부서 사진첩에 올라감', approved: '부서 사진첩에 올라감', rejected: '사이트에서 내려짐' };
    return h('div', { class: 'panel list' }, albums.map(a =>
      h('div', { class: 'item' },
        h('div', {},
          h('strong', {}, a.title), ' ', h('span', { class: `badge ${a.status}` }, label[a.status]),
          h('div', { class: 'meta' }, `${a.dept_name} · 사진 ${a.count}장`)),
        a.status === 'pending' ? h('button', { class: 'btn secondary small', onclick: () => useAlbum(a) },
          shared.length ? `여기에 ${shared.length}장 올리기` : '사진 더 올리기') : null)));
  }

  function showPick(album) {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    const picked = h('p', {}, '아직 고른 사진이 없습니다.');
    const go = h('button', { class: 'btn ok', disabled: true }, '올리기 시작');
    let files = [];
    input.addEventListener('change', () => {
      files = [...input.files];
      picked.textContent = files.length ? `사진 ${files.length}장을 골랐습니다.` : '아직 고른 사진이 없습니다.';
      go.disabled = !files.length;
    });
    go.addEventListener('click', () => runUpload(album, files));
    content.replaceChildren(h('div', { class: 'form' },
      h('p', {}, h('strong', {}, album.title), ` 앨범에 올릴 사진을 골라 주세요. 지금 사진 ${album.count || 0}장이 있습니다.`),
      h('p', { style: 'color:var(--muted);font-size:0.9rem' },
        '카카오톡으로 받은 사진보다 휴대폰 갤러리의 원래 사진을 고르시면 인쇄용 원본이 좋은 화질로 남습니다.'),
      h('button', { class: 'btn secondary', onclick: () => input.click() }, '📷 사진 고르기'),
      input, picked, go,
      h('button', { class: 'btn secondary small', onclick: showStart }, '처음으로')));
  }

  async function runUpload(album, files) {
    const bar = h('div');
    const status = h('p', {}, '준비 중…');
    const errors = h('div', { class: 'error' });
    content.replaceChildren(h('div', { class: 'form' },
      h('p', {}, h('strong', {}, album.title), ' 앨범에 올리는 중입니다. 다 될 때까지 화면을 닫지 마세요.'),
      h('div', { class: 'progress' }, bar), status, errors));
    const base = album.count || 0;
    let done = 0;
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      status.textContent = `${files.length}장 중 ${i + 1}번째 올리는 중…`;
      try {
        await uploadOne(album.id, files[i], base + i);
        done++;
      } catch (err) {
        failed.push(`${files[i].name}: ${err.message}`);
      }
      bar.style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;
    }
    if (done) api(`/api/manage/albums/${encodeURIComponent(album.id)}/done`, { method: 'POST' }).catch(() => {});
    status.textContent = `${done}장을 올렸습니다.` + (done ? ' 몇 분 안에 흔들린 사진 등이 자동으로 걸러지고, 좋은 사진이 부서 사진첩에 올라갑니다.' : '');
    if (failed.length) errors.replaceChildren(h('p', {}, `올리지 못한 사진 ${failed.length}장:`), ...failed.map(f => h('div', {}, f)));
    content.querySelector('.form').append(
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => showPick({ ...album, count: base + done }) }, '사진 더 올리기'),
        h('button', { class: 'btn secondary', onclick: showStart }, '처음으로')));
  }
})();

// 서비스 워커(sw.js)가 보관해 둔 공유 사진을 꺼내고 지웁니다.
async function takeSharedFiles() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('shared-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const files = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const get = store.get('pending');
      get.onsuccess = () => { store.delete('pending'); };
      tx.oncomplete = () => resolve(get.result || []);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return files;
  } catch {
    return [];
  }
}

// 홈 화면에 설치하면 카카오톡 "공유" 목록에 사진첩이 나타납니다 (안드로이드).
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });

function installHint() {
  if (window.matchMedia('(display-mode: standalone)').matches) return '';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return h('div', { class: 'panel', style: 'margin-top:1rem' },
    h('h3', {}, '카카오톡에서 바로 올리기'),
    isIOS
      ? h('p', {}, '아이폰은 카카오톡 사진을 먼저 "사진 앱에 저장"한 뒤 이 화면에서 골라 올려 주세요.')
      : h('div', {},
          h('p', {}, '이 화면을 휴대폰에 설치해 두면, 카카오톡에서 사진을 길게 눌러 공유 → "사진첩"을 골라 바로 올릴 수 있습니다.'),
          h('button', { class: 'btn secondary', style: 'margin-top:0.6rem', onclick: async () => {
            if (installEvent) { installEvent.prompt(); installEvent = null; }
            else alert('크롬이나 삼성 인터넷 메뉴(⋮ 또는 ≡)에서 "홈 화면에 추가" 또는 "앱 설치"를 눌러 주세요.');
          } }, '📲 휴대폰에 설치하기')));
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 방법으로 */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이 사진 형식은 열 수 없습니다')); };
    im.src = url;
  });
}

function resize(src, max, quality) {
  const w = src.width || src.naturalWidth;
  const hgt = src.height || src.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('사진 변환에 실패했습니다'))), 'image/jpeg', quality));
}

async function uploadOne(albumId, file, sort) {
  const bmp = await decode(file);
  const web = await resize(bmp, WEB_MAX, 0.85);
  const thumb = await resize(bmp, THUMB_MAX, 0.8);
  const width = bmp.width || bmp.naturalWidth;
  const height = bmp.height || bmp.naturalHeight;
  if (bmp.close) bmp.close();
  for (let attempt = 0; ; attempt++) {
    const fd = new FormData();
    fd.append('original', file, file.name);
    fd.append('web', web, 'web.jpg');
    fd.append('thumb', thumb, 'thumb.jpg');
    fd.append('width', width);
    fd.append('height', height);
    fd.append('sort', sort);
    try {
      return await api(`/api/manage/albums/${encodeURIComponent(albumId)}/photos`, { method: 'POST', body: fd });
    } catch (err) {
      if (attempt >= 1 || (err.status && err.status < 500)) throw err;
    }
  }
}
