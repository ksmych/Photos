// 관리 화면 (목사님 전용): 앨범(메인에 걸기/내리기), 열람 요청, 부서 공개 설정, 올리는 사람·관리자, 원본 백업
(async function () {
  const content = $('#content');
  let me, issue = null;
  try { const r = await api('/api/me'); me = r.user; issue = r.auth_issue; } catch { me = null; }
  if (!me || me.role !== 'admin') {
    const why = me
      ? `${me.email} 으로 로그인되어 있지만 관리자 명단에 없습니다. (Cloudflare 의 ADMIN_EMAILS 값을 확인하세요)`
      : `로그인이 확인되지 않았습니다.${issue ? ` 이유: ${issue}` : ''}`;
    content.replaceChildren(h('div', { class: 'notice' },
      h('p', {}, '관리자만 볼 수 있는 화면입니다.'),
      h('p', { class: 'error' }, why),
      h('a', { class: 'btn', href: '/login?next=' + encodeURIComponent('/admin') }, '이메일로 로그인하기')));
    return;
  }
  const { depts } = await api('/api/manage/depts');
  const deptName = id => (depts.find(d => d.id === id) || {}).name || id;

  const STATUS = { pending: '부서 사진첩', approved: '부서 사진첩', rejected: '내림' };
  let featured = null;
  const tabs = [
    ['visible', '앨범', () => showAlbums('visible', '아직 올라온 앨범이 없습니다.')],
    ['rejected', '내린 앨범', () => showAlbums('rejected', '내린 앨범이 없습니다.')],
    ['viewers', '열람 요청', showViewers],
    ['depts', '부서 공개 설정', showDepts],
    ['users', '올리는 사람·관리자', showUsers],
    ['backup', '원본 백업', showBackup],
  ];
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const usageBox = h('div');
  content.replaceChildren(usageBox, tabBar, body);
  showUsage();

  // 저장 공간: 무료 10GB 중 얼마나 썼는지, 8GB 넘으면 빨간 경고
  async function showUsage() {
    try {
      const u = await api('/api/manage/usage');
      const gb = n => (n / 1024 ** 3).toFixed(n < 1024 ** 3 ? 2 : 1);
      const pct = Math.min(100, (u.bytes / u.free_bytes) * 100);
      usageBox.replaceChildren(h('div', { class: 'panel' + (u.over_alert ? ' warn' : '') },
        h('div', { class: 'row', style: 'justify-content:space-between' },
          h('strong', {}, '사진 저장 공간'),
          h('span', {}, `${gb(u.bytes)}GB / 무료 ${Math.round(u.free_bytes / 1024 ** 3)}GB · 사진 ${u.photos.toLocaleString()}장`)),
        h('div', { class: 'progress', style: 'margin-top:0.5rem' },
          h('div', { style: `width:${pct}%;${u.over_alert ? 'background:var(--accent)' : ''}` })),
        u.over_alert ? h('p', { class: 'error' },
          `${Math.round(u.alert_bytes / 1024 ** 3)}GB를 넘었습니다. 10GB를 넘으면 1GB당 한 달 약 20원이 나옵니다. "원본 백업"으로 오래된 원본을 받아 두신 뒤 정리를 검토해 주세요.`) : null));
    } catch { usageBox.replaceChildren(); }
  }
  function select(key) {
    tabBar.replaceChildren(...tabs.map(([k, label]) =>
      h('button', { class: 'btn small', role: 'tab', 'aria-selected': String(k === key), onclick: () => select(k) }, label)));
    body.replaceChildren(h('div', { class: 'notice' }, '불러오는 중…'));
    tabs.find(t => t[0] === key)[2]().catch(err => body.replaceChildren(h('div', { class: 'error' }, err.message)));
  }
  select('visible');

  async function albumPanel(a) {
    const { photos } = await api(`/api/manage/albums/${a.id}`);
    const FLAG = { blurry: '흔들림', dark: '어두움', bright: '너무 밝음', duplicate: '비슷한 사진', eyes_closed: '눈 감음', error: '검사 실패' };
    const shown = () => photos.filter(p => !p.hidden).length;
    const summary = h('div', { class: 'meta' });
    const updateSummary = () => {
      const waiting = photos.filter(p => p.qc_status === 'pending').length;
      summary.textContent = waiting
        ? `자동 선별 중… (${waiting}장 남음). 몇 분 뒤 새로 고쳐 주세요.`
        : `사이트에 보일 사진 ${shown()}장 / 뺀 사진 ${photos.length - shown()}장. 사진을 누르면 넣고 뺄 수 있습니다. 자동으로 빠진 사진은 7일 뒤 지워집니다.`;
    };
    const thumbs = h('div', { class: 'thumbs' }, photos.map(p => {
      const label = h('div', { class: 'qc' });
      const pic = h('img', { src: img('thumb', p.id), alt: '', loading: 'lazy' });
      const t = h('div', { class: 't' }, pic, label,
        h('button', { title: '사진 지우기', onclick: async e => {
          e.stopPropagation();
          if (!confirm('이 사진을 완전히 지울까요? 원본도 함께 지워집니다.')) return;
          await api(`/api/manage/photos/${p.id}`, { method: 'DELETE' });
          photos.splice(photos.indexOf(p), 1);
          t.remove();
          updateSummary();
        } }, '✕'));
      const paint = () => {
        t.classList.toggle('off', !!p.hidden);
        const why = (p.qc_flags || []).map(f => FLAG[f] || f).join(', ');
        let left = '';
        if (p.hidden && p.hidden_by === 'qc' && p.qc_done_at) {
          const days = 7 - Math.floor((Date.now() - Date.parse(p.qc_done_at.replace(' ', 'T') + 'Z')) / 86400000);
          left = ` · ${Math.max(days, 0)}일 뒤 삭제`;
        }
        label.textContent = p.hidden ? `빠짐${why ? ' · ' + why : ''}${left}` : (p.qc_status === 'pending' ? '검사 중' : '');
      };
      // 누르면 보이기/빼기 전환
      pic.addEventListener('click', async () => {
        const hidden = !p.hidden;
        await api(`/api/manage/photos/${p.id}/visibility`, { json: { hidden } });
        p.hidden = hidden ? 1 : 0;
        paint();
        updateSummary();
      });
      paint();
      return t;
    }));
    updateSummary();
    const act = async (path, opts, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      await api(`/api/manage/albums/${a.id}${path}`, opts);
      panel.remove();
    };
    const panel = h('div', { class: 'panel' },
      h('h3', {}, a.title, ' ', h('span', { class: `badge ${a.status}` }, STATUS[a.status]),
        featured && featured.album.id === a.id ? h('span', { class: 'badge approved', style: 'margin-left:0.3rem' }, '★ 지금 메인') : null),
      h('div', { class: 'meta' }, [deptName(a.dept_id), a.event_date && fmtDate(a.event_date), `사진 ${photos.length}장`, `올린 사람 ${a.created_by}`].filter(Boolean).join(' · ')),
      summary,
      thumbs,
      h('div', { class: 'row' },
        h('button', { class: 'btn secondary small', onclick: () => lightbox.open(photos.filter(p => !p.hidden), 0) }, '크게 보기'),
        a.status !== 'rejected' && !(featured && featured.album.id === a.id) && deptPublic(a.dept_id)
          ? h('button', { class: 'btn ok', onclick: async () => {
              try { await api(`/api/manage/albums/${a.id}/feature`, { method: 'POST' }); select('visible'); }
              catch (err) { alert(err.message); }
            } }, '★ 메인에 걸기') : null,
        a.status === 'rejected' ? h('button', { class: 'btn ok', onclick: () => act('/restore', { method: 'POST' }) }, '다시 올리기') : null,
        a.status !== 'rejected' ? h('a', { class: 'btn secondary small', href: `/album.html?id=${a.id}`, target: '_blank' }, '사이트에서 보기') : null,
        h('button', { class: 'btn secondary small', onclick: async () => {
          const title = prompt('앨범 이름', a.title);
          if (title == null) return;
          const date = prompt('행사 날짜 (예: 2026-11-15, 비워도 됨)', a.event_date || '');
          if (date == null) return;
          await api(`/api/manage/albums/${a.id}`, { method: 'PATCH', json: { title, event_date: date } });
          select(a.status);
        } }, '이름·날짜 고치기'),
        h('button', { class: 'btn secondary small', onclick: e => downloadZip(e.target, `${deptName(a.dept_id)}_${a.title}`,
          photos.map(p => ({ url: img('orig', p.id), path: p.orig_name || `${p.id}.jpg` }))) }, '원본 모두 받기'),
        a.status !== 'rejected' ? h('button', { class: 'btn danger small', onclick: () => act('/reject', { method: 'POST' }, '사이트에서 내릴까요? 사진은 지워지지 않고 "내린 앨범"에 남습니다.') }, '사이트에서 내리기') : null,
        h('button', { class: 'btn danger small', onclick: () => act('', { method: 'DELETE' }, '앨범과 원본 사진을 모두 지울까요? 되돌릴 수 없습니다.') }, '완전히 지우기')));
    return panel;
  }

  function deptPublic(id) { return (depts.find(d => d.id === id) || {}).access === 'public'; }

  function featuredBox() {
    if (!featured) return h('div', { class: 'panel' }, h('h3', {}, '메인 슬라이드쇼'), h('p', {}, '아직 걸린 앨범이 없습니다. 전체 공개 부서에 앨범이 올라오면 자동으로 걸립니다.'));
    const until = new Date(featured.until);
    const left = until > new Date();
    return h('div', { class: 'panel' },
      h('h3', {}, '★ 지금 메인 슬라이드쇼'),
      h('p', {}, h('strong', {}, `${deptName(featured.album.dept_id)} · ${featured.album.title}`)),
      h('p', { class: 'meta' }, `${featured.chosen_by === 'auto' ? '가장 최근 앨범이라 자동으로' : '목사님이 직접'} 걸렸습니다. `,
        left ? `${new Date(until - 1).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' })} 밤 자정까지 걸려 있고, 그때 한 주 동안 올라온 가장 최근 앨범으로 바뀝니다.`
             : ''),
      h('p', { class: 'meta' }, '지금 바꾸시려면 아래 앨범에서 "★ 메인에 걸기"를 누르세요. 그 앨범이 다음 주일 밤 자정까지 걸립니다.'),
      featured.chosen_by !== 'auto' ? h('button', { class: 'btn secondary small', onclick: async () => {
        if (!confirm('직접 고른 것을 취소하고, 가장 최근 앨범이 자동으로 걸리게 할까요?')) return;
        await api('/api/manage/featured/auto', { method: 'POST' });
        select('visible');
      } }, '자동 선택으로 되돌리기') : null);
  }

  async function showAlbums(status, empty) {
    featured = (await api('/api/manage/featured')).featured;
    const { albums } = await api(`/api/manage/albums?status=${status}`);
    const top = status === 'visible' ? [featuredBox()] : [];
    if (!albums.length) return body.replaceChildren(...top, h('div', { class: 'notice' }, empty));
    body.replaceChildren(...top, ...await Promise.all(albums.map(a => albumPanel(a))));
  }

  async function showViewers() {
    const { viewers } = await api('/api/manage/viewers');
    const members = depts.filter(d => d.access === 'members');
    const call = async (path, payload) => { await api(`/api/manage/viewers${path}`, { json: payload }); showViewers(); };
    const row = (v, buttons) => h('div', { class: 'item' },
      h('div', {}, h('strong', {}, v.name || '(이름 없음)'), ` · ${v.dept_name}`, h('div', { class: 'meta' }, v.email)),
      h('div', { class: 'row' }, buttons));
    const requested = viewers.filter(v => v.status === 'requested');
    const approved = viewers.filter(v => v.status === 'approved');
    const email = h('input', { type: 'email', placeholder: 'example@gmail.com' });
    const name = h('input', { type: 'text', placeholder: '예: 김철수 학생 엄마' });
    const dept = h('select', {}, members.map(d => h('option', { value: d.id }, d.name)));
    const msg = h('div', { class: 'error' });
    const form = h('form', { class: 'form' },
      h('p', {}, '요청 없이 직접 허락할 수도 있습니다.'),
      h('label', {}, '부서', dept), h('label', {}, '이름', name), h('label', {}, '이메일', email), msg,
      h('button', { class: 'btn', type: 'submit' }, '허락하기'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try { await call('', { dept_id: dept.value, email: email.value, name: name.value }); }
      catch (err) { msg.textContent = err.message; }
    });
    body.replaceChildren(
      h('p', { class: 'meta', style: 'margin-bottom:0.6rem' },
        `허락받은 사람만 보는 부서: ${members.map(d => d.name).join(', ') || '없음'} ("부서 공개 설정"에서 바꿀 수 있습니다)`),
      h('div', { class: 'panel list' }, h('h3', {}, `새 열람 요청 ${requested.length}건`),
        requested.length ? requested.map(v => row(v, [
          h('button', { class: 'btn ok small', onclick: () => call('', { dept_id: v.dept_id, email: v.email }) }, '허락'),
          h('button', { class: 'btn danger small', onclick: () => call('/remove', { dept_id: v.dept_id, email: v.email }) }, '거절'),
        ])) : h('p', {}, '새 요청이 없습니다.')),
      h('div', { class: 'panel list' }, h('h3', {}, `허락한 사람 ${approved.length}명`),
        approved.map(v => row(v, [
          h('button', { class: 'btn secondary small', onclick: () => {
            if (confirm(`${v.name || v.email} 님의 ${v.dept_name} 열람 허락을 취소할까요?`)) call('/remove', { dept_id: v.dept_id, email: v.email });
          } }, '허락 취소'),
        ]))),
      members.length ? form : '');
  }

  async function showUsers() {
    const { users } = await api('/api/manage/users');
    const ROLE = { uploader: '올리는 사람', admin: '관리자' };
    const name = h('input', { type: 'text', placeholder: '예: 홍길동 (청년부)' });
    const email = h('input', { type: 'email', placeholder: 'example@gmail.com' });
    const role = h('select', {},
      h('option', { value: 'uploader' }, '올리는 사람 (사진 올리기만)'),
      h('option', { value: 'admin' }, '관리자 (관리 화면 모두 사용)'));
    const msg = h('div', { class: 'error' });
    const form = h('form', { class: 'form' },
      h('p', {}, '이메일을 등록하면 그분은 그 이메일로 받은 확인 번호로 로그인합니다. 관리자로 등록하면 이 관리 화면도 쓸 수 있습니다.'),
      h('label', {}, '이름', name), h('label', {}, '이메일', email), h('label', {}, '권한', role), msg,
      h('button', { class: 'btn', type: 'submit' }, '등록하기'));
    const save = async (u, r) => {
      await api('/api/manage/users', { json: { name: u.name, email: u.email, role: r } });
      showUsers();
    };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try { await save({ name: name.value, email: email.value }, role.value); }
      catch (err) { msg.textContent = err.message; }
    });
    const other = r => (r === 'admin' ? 'uploader' : 'admin');
    body.replaceChildren(
      h('div', { class: 'panel list' }, users.length ? users.map(u => h('div', { class: 'item' },
        h('div', {}, h('strong', {}, u.name || '(이름 없음)'), ' ',
          h('span', { class: `badge${u.role === 'admin' ? ' approved' : ''}` }, ROLE[u.role] || u.role),
          h('div', { class: 'meta' }, u.email)),
        u.email === me.email ? h('span', { class: 'meta' }, '나') : h('div', { class: 'row' },
          h('button', { class: 'btn secondary small', onclick: async () => {
            if (!confirm(`${u.email} 을(를) ${ROLE[other(u.role)]}(으)로 바꿀까요?`)) return;
            try { await save(u, other(u.role)); } catch (err) { alert(err.message); }
          } }, `${ROLE[other(u.role)]}(으)로 바꾸기`),
          h('button', { class: 'btn danger small', onclick: async () => {
            if (!confirm(`${u.email} 의 권한을 모두 없앨까요?`)) return;
            try { await api(`/api/manage/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }); showUsers(); }
            catch (err) { alert(err.message); }
          } }, '권한 없애기')))) : h('p', {}, '등록된 사람이 없습니다.')),
      form);
  }

  async function showDepts() {
    const { depts: list } = await api('/api/manage/depts');
    depts.splice(0, depts.length, ...list);
    const LABEL = { public: '전체 공개', password: '🔒 비밀번호', members: '🔒 허락받은 사람만' };
    const setAccess = async (d, access) => {
      let password;
      if (access === 'password') {
        password = prompt(`${d.name} 비밀번호를 정해 주세요 (4자 이상)`);
        if (!password) return;
      }
      try { await api(`/api/manage/depts/${d.id}/access`, { json: { access, password } }); showDepts(); }
      catch (err) { alert(err.message); }
    };
    body.replaceChildren(h('div', { class: 'panel list' },
      h('p', {}, '전체 공개가 아닌 부서의 사진은 첫 화면에 나오지 않습니다. "허락받은 사람만"은 이메일로 로그인해 열람 요청을 보낸 분 중 목사님이 허락한 분만 볼 수 있습니다.'),
      list.map(d => h('div', { class: 'item' },
        h('div', {}, h('strong', {}, d.name), ' ', LABEL[d.access]),
        h('div', { class: 'row' },
          d.access !== 'public' ? h('button', { class: 'btn secondary small', onclick: () => setAccess(d, 'public') }, '전체 공개로') : null,
          h('button', { class: 'btn secondary small', onclick: () => setAccess(d, 'password') }, d.access === 'password' ? '비밀번호 바꾸기' : '비밀번호로'),
          d.access !== 'members' ? h('button', { class: 'btn secondary small', onclick: () => setAccess(d, 'members') }, '허락받은 사람만') : null)))));
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
