// 첫 화면: 큰 대표 사진 + 액자 슬라이드쇼(이번 주 앨범) + 오른쪽 부서·앨범 목록 + 최근 앨범
(async function () {
  let data;
  try {
    data = await api('/api/home');
  } catch (e) {
    $('#featured').append(h('div', { class: 'notice' }, '사진첩을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
    $('#tree').replaceChildren();
    return;
  }
  try { sessionStorage.setItem('depts', JSON.stringify(data.depts.map(d => ({ id: d.id, name: d.name })))); } catch { /* 저장 안 됨 */ }

  renderTree();
  if (data.featured && data.featured.photos.length) renderFrame(data.featured);
  else $('#featured').append(h('div', { class: 'frame' }, h('div', { class: 'frame-inner empty' }, '사진이 올라오면 여기에 보입니다')));

  const others = data.recent.filter(a => !data.featured || a.id !== data.featured.album.id);
  if (others.length) {
    $('#recent').append(...others.map(albumCard));
    $('#recent-wrap').hidden = false;
  }

  // 오른쪽: 📁 부서 └ 앨범
  function renderTree() {
    $('#tree').replaceChildren(...data.depts.map(d => {
      const albums = (data.tree && data.tree[d.id]) || [];
      return h('div', { class: 'tree-dept' },
        h('a', { class: 'tree-name', href: `/dept.html?id=${encodeURIComponent(d.id)}` },
          h('span', { 'aria-hidden': 'true' }, d.locked ? '🔒' : '📁'), d.name),
        albums.length ? h('ul', {}, albums.map(a => h('li', {},
          h('a', { href: `/album.html?id=${encodeURIComponent(a.id)}` },
            h('span', { class: 'line', 'aria-hidden': 'true' }, '└'), h('span', { class: 't' }, a.title))))) : null);
    }));
  }

  // 가운데: 액자 슬라이드쇼. 양옆에 앞뒤 사진을 흐리게 보여 줍니다.
  function renderFrame({ album, photos }) {
    const dept = data.depts.find(d => d.id === album.dept_id);
    const hero = $('#hero-img');
    hero.src = img('web', photos[0].id);
    hero.hidden = false;

    let i = 0;
    let timer = null;
    const left = h('img', { class: 'side', alt: '' });
    const right = h('img', { class: 'side', alt: '' });
    const center = h('img', { class: 'center', alt: `${album.title} 사진` });
    const dots = h('div', { class: 'dots' }, photos.length > 1 ? photos.map((_, n) =>
      h('button', { class: 'dot', 'aria-label': `${n + 1}번째 사진`, onclick: () => { show(n); restart(); } })) : []);
    const at = n => photos[(n + photos.length) % photos.length];
    const show = n => {
      i = (n + photos.length) % photos.length;
      center.src = img('web', at(i).id);
      left.src = img('thumb', at(i - 1).id);
      right.src = img('thumb', at(i + 1).id);
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      new Image().src = img('web', at(i + 1).id);
    };
    const restart = () => {
      clearInterval(timer);
      if (photos.length > 1) timer = setInterval(() => show(i + 1), 5000);
    };
    const frame = h('div', { class: 'frame' },
      h('div', { class: 'frame-inner', onclick: () => lightbox.open(photos, i) }, left, center, right));
    if (photos.length > 1) {
      frame.append(
        h('button', { class: 'arrow prev', 'aria-label': '이전 사진', onclick: () => { show(i - 1); restart(); } }, '‹'),
        h('button', { class: 'arrow next', 'aria-label': '다음 사진', onclick: () => { show(i + 1); restart(); } }, '›'));
    }
    $('#featured').append(frame,
      h('div', { class: 'frame-meta' }, `${dept ? dept.name + ' · ' : ''}${album.title}`),
      dots,
      h('a', { class: 'btn secondary small', href: `/album.html?id=${encodeURIComponent(album.id)}` }, '이 앨범 모두 보기'));
    show(0);
    restart();
  }
})();
