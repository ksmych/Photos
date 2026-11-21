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
  const manifest = await loadManifest();

  // 가장 최근 앨범 찾기 (앨범 이름 내림차순 → 알파벳/날짜 기준 최신)
  const allAlbums = [];
  for (const dept of DEPARTMENTS) {
    const deptData = getDept(manifest, dept.id);
    if (!deptData) continue;
    for (const album of (deptData.albums || [])) {
      if (album.photos?.length > 0) {
        allAlbums.push({ deptName: dept.name, deptId: dept.id, album });
      }
    }
  }
  allAlbums.sort((a, b) => b.album.name.localeCompare(a.album.name, 'ko'));
  const latest = allAlbums[0];

  const allSlides = latest
    ? latest.album.photos.map(p => ({
        dept: latest.deptName, album: latest.album.name, deptId: latest.deptId, ...p
      }))
    : [];

  // 대표 사진 (히어로) — 가로(landscape) 사진 자동 감지, 없으면 첫 사진
  const heroImg = document.getElementById('hero-img');
  const candidates = allSlides;

  function isLandscape(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > img.naturalHeight);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  (async () => {
    let hero = candidates[0];
    for (const s of candidates) {
      if (await isLandscape(s.url)) { hero = s; break; }
    }
    if (hero) {
      heroImg.src = hero.url;
      heroImg.alt = hero.name;
      heroImg.style.display = '';
    }
  })();

  // 모바일 액자 높이 JS로 강제 적용
  function applyFrameHeight() {
    const fi = document.getElementById('frame-inner');
    if (!fi) return;
    if (window.innerWidth > 768) { fi.style.height = ''; return; }
    const portrait = window.innerHeight > window.innerWidth;
    fi.style.height = portrait
      ? Math.round(window.innerWidth * 4 / 3) + 'px'
      : Math.round(window.innerWidth * 9 / 16) + 'px';
  }
  applyFrameHeight();
  window.addEventListener('resize', applyFrameHeight);
  window.addEventListener('orientationchange', () => setTimeout(applyFrameHeight, 300));

  // 액자 슬라이드쇼
  const frameInner = document.getElementById('frame-inner');
  const frameDots = document.getElementById('frame-dots');
  const frameMeta = document.getElementById('frame-meta');

  if (allSlides.length > 0) {
    const n = allSlides.length;
    let current = 0;

    // 액자 구조: 왼쪽(흐림) | 중앙(선명) | 오른쪽(흐림)
    frameInner.innerHTML = `
      <img class="frame-side" id="frame-left" src="">
      <img class="frame-center" id="frame-center" src="">
      <img class="frame-side" id="frame-right" src="">`;

    const leftImg   = document.getElementById('frame-left');
    const centerImg = document.getElementById('frame-center');
    const rightImg  = document.getElementById('frame-right');

    // 도트 생성
    allSlides.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.addEventListener('click', () => goTo(i));
      frameDots.appendChild(dot);
    });

    function updateMeta() {
      const s = allSlides[current];
      frameMeta.textContent = s.album ? `${s.dept} · ${s.album}` : s.dept;
    }

    function goTo(idx) {
      current = (idx + n) % n;
      leftImg.src   = allSlides[(current - 1 + n) % n].url;
      centerImg.src = allSlides[current].url;
      rightImg.src  = allSlides[(current + 1) % n].url;
      [...frameDots.children].forEach((d, i) => d.classList.toggle('active', i === current));
      updateMeta();
    }

    document.getElementById('frame-prev').addEventListener('click', () => goTo(current - 1));
    document.getElementById('frame-next').addEventListener('click', () => goTo(current + 1));
    setInterval(() => goTo(current + 1), 4500);
    goTo(0);
  }

  // 트리 디렉토리
  const treeNav = document.getElementById('tree-nav');
  treeNav.innerHTML = '';

  for (const dept of DEPARTMENTS) {
    const deptData = getDept(manifest, dept.id);
    const albums = deptData?.albums || [];
    const totalPhotos = getAllPhotos(deptData).length;

    const deptEl = document.createElement('div');
    deptEl.className = 'tree-dept';

    const deptLink = document.createElement('a');
    deptLink.href = `dept.html?id=${dept.id}`;
    deptLink.className = 'tree-dept-name';
    deptLink.innerHTML = `<span class="tree-icon">📁</span> ${dept.name}`;
    deptEl.appendChild(deptLink);

    if (albums.length > 0) {
      const albumList = document.createElement('ul');
      albumList.className = 'tree-albums';
      albums.slice().reverse().forEach((album, i, arr) => {
        const isLast = i === arr.length - 1;
        const li = document.createElement('li');
        li.className = 'tree-album';
        const a = document.createElement('a');
        a.href = `dept.html?id=${dept.id}&album=${encodeURIComponent(album.name)}`;
        a.innerHTML = `<span class="tree-line">${isLast ? '└──' : '├──'}</span> ${album.name}`;
        li.appendChild(a);
        albumList.appendChild(li);
      });
      deptEl.appendChild(albumList);
    }

    treeNav.appendChild(deptEl);
  }
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

const lb = {
  photos: [],
  idx: 0,
  open(i) {
    this.idx = i;
    document.getElementById('lightbox-img').src = this.photos[i].url;
    document.getElementById('lightbox').classList.add('open');
  },
  go(dir) {
    this.idx = (this.idx + dir + this.photos.length) % this.photos.length;
    document.getElementById('lightbox-img').src = this.photos[this.idx].url;
  },
  close() {
    document.getElementById('lightbox').classList.remove('open');
  }
};

(function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;
  document.getElementById('lightbox-close').onclick = () => lb.close();
  document.getElementById('lightbox-prev').onclick = e => { e.stopPropagation(); lb.go(-1); };
  document.getElementById('lightbox-next').onclick = e => { e.stopPropagation(); lb.go(1); };
  lightbox.onclick = e => { if (e.target === lightbox) lb.close(); };
  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') lb.go(-1);
    if (e.key === 'ArrowRight') lb.go(1);
    if (e.key === 'Escape') lb.close();
  });
  // 터치 스와이프
  let tx = 0;
  lightbox.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) lb.go(dx < 0 ? 1 : -1);
  });
})();

function appendPhotoItem(grid, photo) {
  const idx = lb.photos.length;
  lb.photos.push(photo);

  const div = document.createElement('div');
  div.className = 'photo-item';
  div.innerHTML = `<img src="${photo.url}" alt="${photo.name}" loading="lazy">`;
  div.addEventListener('click', () => lb.open(idx));
  grid.appendChild(div);
}
