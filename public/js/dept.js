// 부서 화면: 앨범 목록 (비밀번호 부서는 비밀번호, 허락받은 사람만 보는 부서는 로그인 + 열람 요청)
(async function () {
  const id = param('id');
  const content = $('#content');
  if (!id) { location.href = '/'; return; }

  async function load() {
    content.replaceChildren();
    let data;
    try {
      data = await api(`/api/depts/${encodeURIComponent(id)}`);
    } catch (e) {
      $('#title').textContent = '부서를 찾을 수 없습니다';
      return;
    }
    $('#title').textContent = data.dept.name;
    document.title = `${data.dept.name} | 경산목양교회`;

    if (!data.unlocked && data.dept.access === 'members') return showMembers(data);
    if (!data.unlocked) return showPassword();

    if (!data.albums.length) {
      content.append(h('div', { class: 'notice' }, '아직 올라온 사진이 없습니다.'));
      return;
    }
    content.append(h('div', { class: 'album-grid' }, data.albums.map(albumCard)));
  }

  function showPassword() {
    const input = h('input', { type: 'password', autocomplete: 'current-password', id: 'pw' });
    const msg = h('div', { class: 'error', role: 'alert' });
    const form = h('form', { class: 'form' },
      h('p', {}, '이 부서 사진은 비밀번호를 넣어야 볼 수 있습니다. 비밀번호는 부서 담당자에게 물어보세요.'),
      h('label', {}, '비밀번호', input),
      msg,
      h('button', { class: 'btn', type: 'submit' }, '사진 보기'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      msg.textContent = '';
      try {
        await api(`/api/depts/${encodeURIComponent(id)}/unlock`, { json: { password: input.value } });
        load();
      } catch (err) { msg.textContent = err.message; }
    });
    content.append(form);
    input.focus();
  }

  function showMembers(data) {
    const intro = h('p', {}, '🔒 이 부서 사진은 학생 보호를 위해 목사님께 허락받은 분만 볼 수 있습니다.');
    if (!data.logged_in) {
      const next = encodeURIComponent(location.pathname + location.search);
      content.append(h('div', { class: 'form' }, intro,
        h('p', {}, '먼저 이메일로 로그인한 뒤 열람 요청을 보내 주세요. 이메일로 받은 확인 번호를 넣으면 로그인됩니다.'),
        h('a', { class: 'btn', href: `/login.html?next=${next}` }, '이메일로 로그인하기')));
      return;
    }
    if (data.request_status === 'requested') {
      content.append(h('div', { class: 'form' }, intro,
        h('p', { style: 'font-weight:700;color:var(--ok)' }, '열람 요청을 보냈습니다. 목사님이 허락하시면 이 화면에서 바로 볼 수 있습니다.')));
      return;
    }
    const name = h('input', { type: 'text', maxlength: 40, placeholder: '예: 김철수 학생 엄마' });
    const msg = h('div', { class: 'error', role: 'alert' });
    const form = h('form', { class: 'form' }, intro,
      h('label', {}, '누구신지 적어 주세요', name), msg,
      h('button', { class: 'btn', type: 'submit' }, '열람 요청 보내기'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      msg.textContent = '';
      try {
        await api(`/api/depts/${encodeURIComponent(id)}/request`, { json: { name: name.value } });
        load();
      } catch (err) { msg.textContent = err.message; }
    });
    content.append(form);
  }

  load();
})();
