const REPO = 'ksmych/photos';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO}/contents/photos`;

const DEPARTMENTS = [
  { id: 'church-events', name: '교회행사' },
  { id: 'newcomers',     name: '새가족' },
  { id: 'mens',          name: '남전도회' },
  { id: 'womens1',       name: '1여전도회' },
  { id: 'womens2',       name: '2여전도회' },
  { id: 'youth',         name: '청년부' },
  { id: 'teens',         name: '중고등부' },
  { id: 'kids',          name: '유초등부' },
];

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function isImage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
}

async function fetchPhotos(deptId) {
  try {
    const res = await fetch(`${API}/${deptId}`);
    if (!res.ok) return [];
    const files = await res.json();
    return files
      .filter(f => f.type === 'file' && isImage(f.name))
      .map(f => ({ name: f.name, url: rawUrl(f.path) }))
      .reverse();
  } catch {
    return [];
  }
}

/* ── 메인 페이지 ── */
async function initMain() {
  const slideshowEl = document.getElementById('slideshow');
  const dotsEl = document.getElementById('dots');
  const deptGridEl = document.getElementById('dept-grid');

  // 부서 카드 + 슬라이드 데이터 수집
  const allSlides = [];
  const cards = [];

  await Promise.all(DEPARTMENTS.map(async (dept) => {
    const photos = await fetchPhotos(dept.id);
    const latest = photos.slice(0, 3);
    latest.forEach(p => allSlides.push({ dept: dept.name, ...p }));

    const thumb = photos[0];
    cards.push({ dept, thumb, count: photos.length });
  }));

  // 슬라이드쇼
  if (allSlides.length === 0) {
    slideshowEl.innerHTML = '<div class="no-photos-msg">아직 사진이 없습니다</div>';
  } else {
    // 순서 섞기
    allSlides.sort(() => Math.random() - 0.5);

    allSlides.forEach((s, i) => {
      const slide = document.createElement('div');
      slide.className = 'slide' + (i === 0 ? ' active' : '');
      slide.innerHTML = `
        <img src="${s.url}" alt="${s.name}" loading="lazy">
        <div class="slide-caption">
          <div class="dept">${s.dept}</div>
        </div>`;
      slideshowEl.appendChild(slide);

      const dot = document.createElement('div');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(dot);
    });

    let current = 0;
    const slides = slideshowEl.querySelectorAll('.slide');
    const dots = dotsEl.querySelectorAll('.dot');

    function goTo(n) {
      slides[current].classList.remove('active');
      dots[current].classList.remove('active');
      current = (n + slides.length) % slides.length;
      slides[current].classList.add('active');
      dots[current].classList.add('active');
    }

    setInterval(() => goTo(current + 1), 4000);
  }

  // 부서 카드 렌더링 (입력 순서 유지)
  DEPARTMENTS.forEach(dept => {
    const card = cards.find(c => c.dept.id === dept.id);
    if (!card) return;

    const a = document.createElement('a');
    a.className = 'dept-card';
    a.href = `dept.html?id=${card.dept.id}`;
    a.innerHTML = `
      <div class="dept-card-thumb">
        ${card.thumb
          ? `<img src="${card.thumb.url}" alt="${card.dept.name}" loading="lazy">`
          : `<div class="thumb-placeholder">사진 없음</div>`}
      </div>
      <div class="dept-card-info">
        <h3>${card.dept.name}</h3>
        <span class="count">${card.count}장</span>
      </div>`;
    deptGridEl.appendChild(a);
  });
}

/* ── 부서 페이지 ── */
async function initDept() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const dept = DEPARTMENTS.find(d => d.id === id);
  if (!dept) { location.href = 'index.html'; return; }

  document.title = `${dept.name} | 우리들의 이야기`;
  document.getElementById('dept-name').textContent = dept.name;
  document.getElementById('dept-desc').textContent = `${dept.name} 사진 모음`;

  const grid = document.getElementById('photo-grid');
  const photos = await fetchPhotos(id);

  if (photos.length === 0) {
    grid.innerHTML = '<div class="empty-state">아직 사진이 없습니다</div>';
    return;
  }

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');

  photos.forEach(p => {
    const div = document.createElement('div');
    div.className = 'photo-item';
    div.innerHTML = `<img src="${p.url}" alt="${p.name}" loading="lazy">`;
    div.addEventListener('click', () => {
      lightboxImg.src = p.url;
      lightbox.classList.add('open');
    });
    grid.appendChild(div);
  });

  document.getElementById('lightbox-close').addEventListener('click', () => {
    lightbox.classList.remove('open');
  });
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) lightbox.classList.remove('open');
  });
}
