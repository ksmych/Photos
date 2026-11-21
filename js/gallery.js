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

async function loadManifest() {
  try {
    const res = await fetch('manifest.json?t=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getDept(manifest, id) {
  return manifest?.departments?.find(d => d.id === id);
}

function getThumb(deptData) {
  if (!deptData) return null;
  const direct = deptData.directPhotos?.[0];
  if (direct) return direct.url;
  for (const album of (deptData.albums || [])) {
    if (album.photos?.[0]) return album.photos[0].url;
  }
  return null;
}

function getAllPhotos(deptData) {
  if (!deptData) return [];
  const photos = [...(deptData.directPhotos || [])];
  for (const album of (deptData.albums || [])) {
    photos.push(...(album.photos || []));
  }
  return photos;
}

/* ── 메인 페이지 ── */
async function initMain() {
  const slideshowEl = document.getElementById('slideshow');
  const dotsEl = document.getElementById('dots');
  const deptGridEl = document.getElementById('dept-grid');

  const manifest = await loadManifest();

  // 슬라이드쇼 — 각 부서 최신 사진 최대 3장
  const allSlides = [];
  for (const dept of DEPARTMENTS) {
    const deptData = getDept(manifest, dept.id);
    const photos = getAllPhotos(deptData).slice(0, 3);
    photos.forEach(p => allSlides.push({ dept: dept.name, ...p }));
  }

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
    const deptData = getDept(manifest, dept.id);
    const thumb = getThumb(deptData);

    const a = document.createElement('a');
    a.className = 'dept-card';
    a.href = `dept.html?id=${dept.id}`;
    a.innerHTML = `
      <div class="dept-card-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="${dept.name}" loading="lazy">`
          : `<div class="thumb-placeholder">사진 없음</div>`}
      </div>
      <div class="dept-card-info">
        <h3>${dept.name}</h3>
      </div>`;
    deptGridEl.appendChild(a);
  });
}

/* ── 부서 페이지 ── */
async function initDept() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const albumName = params.get('album');
  const dept = DEPARTMENTS.find(d => d.id === id);
  if (!dept) { location.href = 'index.html'; return; }

  const manifest = await loadManifest();
  const deptData = getDept(manifest, id);

  if (albumName) {
    await initAlbum(dept, id, albumName, deptData);
  } else {
    await initDeptMain(dept, id, deptData);
  }
}

// 부서 메인 — 앨범 목록
async function initDeptMain(dept, id, deptData) {
  document.title = `${dept.name} | 우리들의 이야기`;
  document.getElementById('dept-name').textContent = dept.name;
  document.getElementById('dept-desc').textContent = `${dept.name} 앨범 목록`;
  document.getElementById('back-btn').style.display = 'none';

  const grid = document.getElementById('photo-grid');
  const albums = deptData?.albums || [];
  const directPhotos = deptData?.directPhotos || [];

  if (albums.length === 0 && directPhotos.length === 0) {
    grid.innerHTML = '<div class="empty-state">아직 사진이 없습니다</div>';
    return;
  }

  // 최신순 (이름 역순)
  [...albums].reverse().forEach(album => {
    const a = document.createElement('a');
    a.className = 'album-card';
    a.href = `dept.html?id=${id}&album=${encodeURIComponent(album.name)}`;
    const thumb = album.photos?.[0];
    a.innerHTML = `
      <div class="album-thumb">
        ${thumb
          ? `<img src="${thumb.url}" alt="${album.name}" loading="lazy">`
          : `<div class="thumb-placeholder">사진 없음</div>`}
      </div>
      <div class="album-info">
        <span class="album-name">${album.name}</span>
        <span class="album-count">${album.photos.length}장</span>
      </div>`;
    grid.appendChild(a);
  });

  if (directPhotos.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.textContent = '기타 사진';
    grid.appendChild(divider);
    directPhotos.forEach(p => appendPhotoItem(grid, p));
  }
}

// 앨범 내 사진 목록
async function initAlbum(dept, id, albumName, deptData) {
  document.title = `${albumName} | ${dept.name}`;
  document.getElementById('dept-name').textContent = albumName;
  document.getElementById('dept-desc').textContent = dept.name;

  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = 'inline-flex';
  backBtn.href = `dept.html?id=${id}`;

  const grid = document.getElementById('photo-grid');
  const album = deptData?.albums?.find(a => a.name === albumName);
  const photos = album?.photos || [];

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

  document.getElementById('lightbox-close').onclick = () => lightbox.classList.remove('open');
  lightbox.onclick = e => { if (e.target === lightbox) lightbox.classList.remove('open'); };
}
