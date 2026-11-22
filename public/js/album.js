// 앨범 화면: 사진 모아보기 → 누르면 크게 보기
(async function () {
  const id = param('id');
  if (!id) { location.href = '/'; return; }
  let data;
  try {
    data = await api(`/api/albums/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e.status === 403 && e.data && e.data.dept) {
      location.href = `/dept.html?id=${encodeURIComponent(e.data.dept.id)}`;
      return;
    }
    $('#title').textContent = '앨범을 찾을 수 없습니다';
    return;
  }
  const { album, dept, photos } = data;
  document.title = `${album.title} | 경산목양교회`;
  $('#title').textContent = album.title;
  $('#meta').textContent = [dept.name, album.event_date ? fmtDate(album.event_date) : null, `사진 ${photos.length}장`]
    .filter(Boolean).join(' · ');
  $('#back').href = `/dept.html?id=${encodeURIComponent(dept.id)}`;
  $('#back').textContent = `◀ ${dept.name} 앨범 목록`;
  $('#grid').append(...photos.map((p, i) =>
    h('button', { 'aria-label': `${i + 1}번째 사진 크게 보기`, onclick: () => lightbox.open(photos, i) },
      h('img', { src: img('thumb', p.id), alt: '', loading: 'lazy' }))));
})();
