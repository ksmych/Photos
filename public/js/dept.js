// 부서 화면: 앨범 목록 (비밀번호 부서는 먼저 비밀번호 입력)
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

    if (!data.unlocked) {
      const input = h('input', { type: 'password', inputmode: 'text', autocomplete: 'current-password', id: 'pw' });
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
      return;
    }

    if (!data.albums.length) {
      content.append(h('div', { class: 'notice' }, '아직 올라온 사진이 없습니다.'));
      return;
    }
    content.append(h('div', { class: 'album-grid' }, data.albums.map(albumCard)));
  }
  load();
})();
