// 첫 화면: 최근 승인 앨범 슬라이드쇼 + 부서 버튼 + 최근 앨범
(async function () {
  let data;
  try {
    data = await api('/api/home');
  } catch (e) {
    $('#featured').append(h('div', { class: 'notice' }, '사진첩을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
    return;
  }

  $('#depts').append(...data.depts.map(d =>
    h('a', { class: 'dept-btn', href: `/dept.html?id=${encodeURIComponent(d.id)}` }, d.name, d.locked ? ' 🔒' : '')));

  if (data.featured) renderSlideshow(data.featured);
  else $('#featured').append(h('div', { class: 'notice' }, '아직 올라온 사진이 없습니다.'));

  const others = data.recent.filter(a => !data.featured || a.id !== data.featured.album.id);
  if (others.length) {
    $('#recent').append(...others.map(albumCard));
    $('#recent-wrap').hidden = false;
  }

  function renderSlideshow({ album, photos }) {
    const dept = data.depts.find(d => d.id === album.dept_id);
    let i = 0;
    let timer = null;
    const pic = h('img', { alt: `${album.title} 사진`, src: img('web', photos[0].id) });
    const counter = h('span', { class: 'count' });
    const show = n => {
      i = (n + photos.length) % photos.length;
      pic.src = img('web', photos[i].id);
      counter.textContent = `${i + 1} / ${photos.length}`;
      new Image().src = img('web', photos[(i + 1) % photos.length].id);
    };
    const restart = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 5000); };
    const stage = h('div', { class: 'stage', onclick: () => lightbox.open(photos, i) }, pic);
    const box = h('div', { class: 'slideshow' }, stage);
    if (photos.length > 1) {
      box.append(
        h('button', { class: 'nav prev', 'aria-label': '이전 사진', onclick: () => { show(i - 1); restart(); } }, '‹'),
        h('button', { class: 'nav next', 'aria-label': '다음 사진', onclick: () => { show(i + 1); restart(); } }, '›'));
      restart();
    }
    $('#featured').append(
      box,
      h('div', { class: 'slide-caption' },
        h('div', {},
          h('div', { class: 'title' }, `${dept ? dept.name + ' · ' : ''}${album.title}`),
          counter),
        h('a', { class: 'btn', href: `/album.html?id=${encodeURIComponent(album.id)}` }, '이 앨범 모두 보기')));
    show(0);
  }
})();
