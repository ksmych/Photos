const REPO = 'ksmych/Photos';
const BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;

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
  return IMAGE_EXTS.includes(filename.split('.').pop().toLowerCase());
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
}

async function fetchContents(path) {
  try {
    const res = await fetch(`${API_BASE}/${path}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// 부서 폴더에서 앨범(하위폴더) 목록과 직접 사진 모두 가져오기
async function fetchDeptContents(deptId) {
  const items = await fetchContents(`photos/${deptId}`);
  const albums = [];
  const directPhotos = [];

  for (const item of items) {
    if (item.type === 'dir') {
      // 앨범(하위폴더) — 썸네일용 첫 사진 가져오기
      const albumItems = await fetchContents(item.path);
      const photos = albumItems
        .filter(f => f.type === 'file' && isImage(f.name))
        .map(f => ({ name: f.name, url: rawUrl(f.path) }));
      albums.push({ name: item.name, photos, thumb: photos[0] || null });
    } else if (item.type === 'file' && isImage(item.name)) {
      directPhotos.push({ name: item.name, url: rawUrl(item.path) });
    }
  }

  return { albums, directPhotos };
}

// 메인 슬라이드쇼용 — 부서별 최신 사진 (앨범 포함)
async function fetchLatestPhotos(deptId) {
  const items = await fetchContents(`photos/${deptId}`);
  const photos = [];

  for (const item of items) {
    if (item.type === 'dir') {
      const albumItems = await fetchContents(item.path);
      albumItems
        .filter(f => f.type === 'file' && isImage(f.name))
        .slice(0, 3)
        .forEach(f => photos.push({ name: f.name, url: rawUrl(f.path) }));
    } else if (item.type === 'file' && isImage(item.name)) {
      photos.push({ name: item.name, url: rawUrl(item.path) });
    }
  }

  return photos.slice(0, 5);
}

/* ── 메인 페이지 ── */
async function initMain() {
  const slideshowEl = document.getElementById('slideshow');
  const dotsEl = document.getElementById('dots');
  const deptGridEl = document.getElementById('dept-grid');

  const allSlides = [];
  const cards = [];

  await Promise.all(DEPARTMENTS.map(async (dept) => {
    const photos = await fetchLatestPhotos(dept.id);
    photos.forEach(p => allSlides.push({ dept: dept.name, ...p }));

    const items = await fetchContents(`photos/${dept.id}`);
    // 썸네일: 직접 사진 또는 첫 앨범의 첫 사진
    let thumb = null;
    for (const item of items) {
      if (item.type === 'file' && isImage(item.name)) {
        thumb = { url: rawUrl(item.path) };
        break;
      } else if (item.type === 'dir' && !thumb) {
        const albumItems = await fetchContents(item.path);
        const img = albumItems.find(f => f.type === 'file' && isImage(f.name));
        if (img) thumb = { url: rawUrl(img.path) };
      }
    }
    cards.push({ dept, thumb });
  }));

  // 슬라이드쇼
  if (allSlides.length === 0) {
    slideshowEl.innerHTML = '<div class="no-photos-msg">아직 사진이 없습니다</div>';
  } else {
    allSlides.sort(() => Math.random() - 0.5);

    allSlides.forEach((s, i) => {
      const slide = document.createElement('div');
      slide.className = 'slide' + (i === 0 ? ' active' : '');
      slide.innerHTML = `
        <img src="${s.url}" alt="${s.name}" loading="lazy">
        <div class="slide-caption"><div class="dept">${s.dept}</div></div>`;
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

  // 부서 카드
  DEPARTMENTS.forEach(dept => {
    const card = cards.find(c => c.dept.id === dept.id);
    if (!card) return;
    const a = document.createElement('a');
    a.className = 'dept-card';
    a.href = `dept.html?id=${dept.id}`;
    a.innerHTML = `
      <div class="dept-card-thumb">
        ${card.thumb
          ? `<img src="${card.thumb.url}" alt="${dept.name}" loading="lazy">`
          : `<div class="thumb-placeholder">사진 없음</div>`}
      </div>
      <div class="dept-card-info">
        <h3>${dept.name}</h3>
      </div>`;
    deptGridEl.appendChild(a);
  });
}

/* ── 부서 페이지 (앨범 목록) ── */
async function initDept() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const albumName = params.get('album');
  const dept = DEPARTMENTS.find(d => d.id === id);
  if (!dept) { location.href = 'index.html'; return; }

  if (albumName) {
    await initAlbum(dept, id, albumName);
  } else {
    await initDeptMain(dept, id);
  }
}

// 부서 메인 — 앨범 목록
async function initDeptMain(dept, id) {
  document.title = `${dept.name} | 우리들의 이야기`;
  document.getElementById('dept-name').textContent = dept.name;
  document.getElementById('dept-desc').textContent = `${dept.name} 앨범 목록`;
  document.getElementById('back-btn').style.display = 'none';

  const grid = document.getElementById('photo-grid');
  const { albums, directPhotos } = await fetchDeptContents(id);

  if (albums.length === 0 && directPhotos.length === 0) {
    grid.innerHTML = '<div class="empty-state">아직 사진이 없습니다</div>';
    return;
  }

  // 앨범 카드
  albums.forEach(album => {
    const a = document.createElement('a');
    a.className = 'album-card';
    a.href = `dept.html?id=${id}&album=${encodeURIComponent(album.name)}`;
    a.innerHTML = `
      <div class="album-thumb">
        ${album.thumb
          ? `<img src="${album.thumb.url}" alt="${album.name}" loading="lazy">`
          : `<div class="thumb-placeholder">사진 없음</div>`}
      </div>
      <div class="album-info">
        <span class="album-name">${album.name}</span>
        <span class="album-count">${album.photos.length}장</span>
      </div>`;
    grid.appendChild(a);
  });

  // 부서 폴더 직접 사진 (앨범 미분류)
  if (directPhotos.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.textContent = '기타 사진';
    grid.appendChild(divider);

    directPhotos.forEach(p => appendPhotoItem(grid, p));
  }
}

// 앨범 내부 — 사진 목록
async function initAlbum(dept, id, albumName) {
  document.title = `${albumName} | ${dept.name}`;
  document.getElementById('dept-name').textContent = albumName;
  document.getElementById('dept-desc').textContent = dept.name;

  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = 'inline-flex';
  backBtn.href = `dept.html?id=${id}`;

  const grid = document.getElementById('photo-grid');
  const items = await fetchContents(`photos/${id}/${albumName}`);
  const photos = items
    .filter(f => f.type === 'file' && isImage(f.name))
    .map(f => ({ name: f.name, url: rawUrl(f.path) }));

  if (photos.length === 0) {
    grid.innerHTML = '<div class="empty-state">아직 사진이 없습니다</div>';
    return;
  }

  photos.forEach(p => appendPhotoItem(grid, p));
}

function appendPhotoItem(grid, photo) {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');

  const div = document.createElement('div');
  div.className = 'photo-item';
  div.innerHTML = `<img src="${photo.url}" alt="${photo.name}" loading="lazy">`;
  div.addEventListener('click', () => {
    lightboxImg.src = photo.url;
    lightbox.classList.add('open');
  });
  grid.appendChild(div);

  document.getElementById('lightbox-close').addEventListener('click', () => {
    lightbox.classList.remove('open');
  });
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) lightbox.classList.remove('open');
  });
}
