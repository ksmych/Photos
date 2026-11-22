// 관리 화면 (목사님 전용): 승인, 올리는 사람, 부서 비밀번호, 원본 백업
(async function () {
  const content = $('#content');
  let me;
  try { me = (await api('/api/me')).user; } catch { me = null; }
  if (!me || me.role !== 'admin') {
    content.replaceChildren(h('div', { class: 'notice' }, '관리자만 볼 수 있는 화면입니다.'));
    return;
  }
  const { depts } = await api('/api/manage/depts');
  const deptName = id => (depts.find(d => d.id === id) || {}).name || id;

  const tabs = [
    ['pending', '승인 대기', showPending],
    ['approved', '올라간 앨범', showApproved],
    ['users', '올리는 사람', showUsers],
    ['depts', '부서 비밀번호', showDepts],
    ['backup', '원본 백업', showBackup],
  ];
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  content.replaceChildren(tabBar, body);
  function select(key) {
    tabBar.replaceChildren(...tabs.map(([k, label]) =>
      h('button', { class: 'btn small', role: 'tab', 'aria-selected': String(k === key), onclick: () => select(k) }, label)));
    body.replaceChildren(h('div', { class: 'notice' }, '불러오는 중…'));
    tabs.find(t => t[0] === key)[2]().catch(err => body.replaceChildren(h('div', { class: 'error' }, err.message)));
  }
  select('pending');

  async function albumPanel(a, { review }) {
    const { photos } = await api(`/api/manage/albums/${a.id}`);
    const thumbs = h('div', { class: 'thumbs' }, photos.map(p => {
      const t = h('div', { class: 't' },
        h('img', { src: img('thumb', p.id), alt: '', loading: 'lazy', onclick: () => lightbox.open(photos, photos.indexOf(p)) }),
        h('button', { title: '이 사진 빼기', onclick: async () => {
          if (!confirm('이 사진을 지울까요? 원본도 함께 지워집니다.')) return;
          await api(`/api/manage/photos/${p.id}`, { method: 'DELETE' });
          t.remove();
        } }, '✕'));
      return t;
    }));
    const act = async (path, opts, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      await api(`/api/manage/albums/${a.id}${path}`, opts);
      panel.remove();
    };
    const panel = h('div', { class: 'panel' },
      h('h3', {}, a.title, ' ', h('span', { class: `badge ${a.status}` }, { pending: '승인 대기', approved: '올라감', rejected: '반려' }[a.status])),
      h('div', { class: 'meta' }, [deptName(a.dept_id), a.event_date && fmtDate(a.event_date), `사진 ${photos.length}장`, `올린 사람 ${a.created_by}`].filter(Boolean).join(' · ')),
      thumbs,
      h('div', { class: 'row' },
        review ? h('button', { class: 'btn ok', onclick: () => act('/approve', { method: 'POST' }) }, '✔ 승인') : null,
        review ? h('button', { class: 'btn danger', onclick: () => act('/reject', { method: 'POST' }, '이 앨범을 반려할까요? 사이트에 보이지 않습니다.') }, '반려')
               : h('a', { class: 'btn secondary small', href: `/album.html?id=${a.id}`, target: '_blank' }, '사이트에서 보기'),
        h('button', { class: 'btn secondary small', onclick: async () => {
          const title = prompt('앨범 이름', a.title);
          if (title == null) return;
          const date = prompt('행사 날짜 (예: 2026-11-15, 비워도 됨)', a.event_date || '');
          if (date == null) return;
          await api(`/api/manage/albums/${a.id}`, { method: 'PATCH', json: { title, event_date: date } });
          select(review ? 'pending' : 'approved');
        } }, '이름·날짜 고치기'),
        h('button', { class: 'btn secondary small', onclick: e => downloadZip(e.target, `${deptName(a.dept_id)}_${a.title}`,
          photos.map(p => ({ url: img('orig', p.id), path: p.orig_name || `${p.id}.jpg` }))) }, '원본 모두 받기'),
        !review ? h('button', { class: 'btn secondary small', onclick: () => act('/reject', { method: 'POST' }, '사이트에서 내릴까요? 사진은 지워지지 않습니다.') }, '사이트에서 내리기') : null,
        h('button', { class: 'btn danger small', onclick: () => act('', { method: 'DELETE' }, '앨범과 원본 사진을 모두 지울까요? 되돌릴 수 없습니다.') }, '완전히 지우기')));
    return panel;
  }

  async function showPending() {
    const { albums } = await api('/api/manage/albums?status=pending');
    if (!albums.length) return body.replaceChildren(h('div', { class: 'notice' }, '승인을 기다리는 앨범이 없습니다.'));
    body.replaceChildren(...await Promise.all(albums.map(a => albumPanel(a, { review: true }))));
  }

  async function showApproved() {
    const { albums } = await api('/api/manage/albums?status=approved');
    const { albums: rejected } = await api('/api/manage/albums?status=rejected');
    const all = [...albums, ...rejected];
    if (!all.length) return body.replaceChildren(h('div', { class: 'notice' }, '아직 올라간 앨범이 없습니다.'));
    body.replaceChildren(...await Promise.all(all.map(a => albumPanel(a, { review: a.status !== 'approved' }))));
  }

  async function showUsers() {
    const { users } = await api('/api/manage/users');
    const name = h('input', { type: 'text', placeholder: '예: 홍길동 (청년부)' });
    const email = h('input', { type: 'email', placeholder: 'example@gmail.com' });
    const msg = h('div', { class: 'error' });
    const form = h('form', { class: 'form' },
      h('p', {}, '사진을 올릴 분의 이메일을 등록하면, 그분은 그 이메일로 받은 확인 번호로 로그인해서 사진을 올릴 수 있습니다.'),
      h('label', {}, '이름', name), h('label', {}, '이메일', email), msg,
      h('button', { class: 'btn', type: 'submit' }, '등록하기'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('/api/manage/users', { json: { name: name.value, email: email.value } }); showUsers(); }
      catch (err) { msg.textContent = err.message; }
    });
    body.replaceChildren(
      h('div', { class: 'panel list' }, users.length ? users.map(u => h('div', { class: 'item' },
        h('div', {}, h('strong', {}, u.name || '(이름 없음)'), h('div', { class: 'meta' }, u.email)),
        h('button', { class: 'btn danger small', onclick: async () => {
          if (!confirm(`${u.email} 의 올리기 권한을 없앨까요?`)) return;
          await api(`/api/manage/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' });
          showUsers();
        } }, '권한 없애기'))) : h('p', {}, '등록된 사람이 없습니다.')),
      form);
  }

  async function showDepts() {
    const { depts: list } = await api('/api/manage/depts');
    body.replaceChildren(h('div', { class: 'panel list' },
      h('p', {}, '비밀번호를 정한 부서는 비밀번호를 아는 분만 사진을 볼 수 있습니다. 비밀번호 부서의 사진은 첫 화면 슬라이드쇼에 나오지 않습니다.'),
      list.map(d => h('div', { class: 'item' },
        h('div', {}, h('strong', {}, d.name), ' ', d.locked ? '🔒 비밀번호 있음' : '전체 공개'),
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary small', onclick: async () => {
            const pw = prompt(`${d.name} 비밀번호를 정해 주세요 (4자 이상)`);
            if (!pw) return;
            try { await api(`/api/manage/depts/${d.id}/password`, { json: { password: pw } }); showDepts(); }
            catch (err) { alert(err.message); }
          } }, d.locked ? '비밀번호 바꾸기' : '비밀번호 정하기'),
          d.locked ? h('button', { class: 'btn secondary small', onclick: async () => {
            if (!confirm(`${d.name} 을(를) 전체 공개로 바꿀까요?`)) return;
            await api(`/api/manage/depts/${d.id}/password`, { json: { password: '' } });
            showDepts();
          } }, '전체 공개로') : null)))));
  }

  async function showBackup() {
    const thisYear = new Date().getFullYear();
    const year = h('select', {}, Array.from({ length: 6 }, (_, i) => h('option', { value: thisYear - i }, `${thisYear - i}년`)));
    const out = h('div');
    const look = async () => {
      const { photos } = await api(`/api/manage/export?year=${year.value}`);
      if (!photos.length) return out.replaceChildren(h('p', {}, '그해 사진이 없습니다.'));
      const size = photos.reduce((s, p) => s + (p.orig_size || 0), 0);
      const gb = size / 1024 / 1024 / 1024;
      out.replaceChildren(
        h('p', {}, `사진 ${photos.length}장, 약 ${(size / 1024 / 1024).toFixed(0)}MB`),
        gb > 1.5 ? h('p', { class: 'error' }, '용량이 커서 한 번에 받으면 컴퓨터가 버거울 수 있습니다. "올라간 앨범"에서 앨범별로 받으시는 걸 권합니다.') : null,
        h('button', { class: 'btn', onclick: e => downloadZip(e.target, `경산목양교회_사진원본_${year.value}`,
          photos.map(p => ({ url: img('orig', p.id), path: `${safe(p.dept_name)}/${safe((p.event_date || '') + ' ' + p.title)}/${safe(p.orig_name || p.id + '.jpg')}` }))) },
          '원본 한꺼번에 받기 (zip)'));
    };
    body.replaceChildren(h('div', { class: 'form' },
      h('p', {}, '해마다 원본을 컴퓨터나 구글 드라이브에 한 번씩 보관해 두시면 안전합니다. 받은 zip 파일을 구글 드라이브에 올려 두세요.'),
      h('label', {}, '연도', year), h('button', { class: 'btn secondary', onclick: look }, '사진 수 확인'), out));
  }
})();

const safe = s => String(s).trim().replace(/[\\/:*?"<>|]+/g, '_') || '_';

async function downloadZip(button, name, files) {
  if (!window.JSZip) return alert('압축 기능을 불러오지 못했습니다. 화면을 새로 고쳐 주세요.');
  const label = button.textContent;
  button.disabled = true;
  try {
    const zip = new JSZip();
    const used = new Set();
    for (let i = 0; i < files.length; i++) {
      button.textContent = `받는 중 ${i + 1}/${files.length}`;
      const res = await fetch(files[i].url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`사진을 받지 못했습니다 (${res.status})`);
      let path = files[i].path;
      for (let n = 2; used.has(path); n++) path = files[i].path.replace(/(\.[^.]+)?$/, `_${n}$1`);
      used.add(path);
      zip.file(path, await res.blob(), { binary: true });
    }
    button.textContent = '파일 만드는 중…';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${safe(name)}.zip` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
