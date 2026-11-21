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

  // 전체 사진 수집 (부서 + 앨범 메타 포함)
  const allSlides = [];
  for (const dept of DEPARTMENTS) {
    const deptData = getDept(manifest, dept.id);
    if (!deptData) continue;
    for (const album of (deptData.albums || [])) {
      for (const photo of (album.photos || [])) {
        allSlides.push({ dept: dept.name, album: album.name, deptId: dept.id, ...photo });
      }
    }
    for (const photo of (deptData.directPhotos || [])) {
      allSlides.push({ dept: dept.name, album: null, deptId: dept.id, ...photo });
    }
  }

  // 대표 사진 (히어로) — church-events 첫 사진 우선
  const heroImg = document.getElementById('hero-img');
  const heroFirst = allSlides.find(s => s.deptId === 'church-events') || allSlides[0];
  if (heroFirst) {
    heroImg.src = heroFirst.url;
    heroImg.alt = heroFirst.name;
    heroImg.style.display = '';
  }

  // 액자 슬라이드쇼
  const frameInner = document.getElementById('frame-inner');
  const frameDots = document.getElementById('frame-dots');
  const frameMeta = document.getElementById('frame-meta');

  if (allSlides.length > 0) {
    frameInner.innerHTML = '';
    let current = 0;
    const imgs = [];

    allSlides.forEach((s, i) => {
      const img = document.createElement('img');
      img.src = s.url;
      img.alt = s.name;
      img.loading = 'lazy';
      img.className = 'frame-img' + (i === 0 ? ' active' : '');
      frameInner.appendChild(img);
      imgs.push(img);

      const dot = document.createElement('span');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => goTo(i));
      frameDots.appendChild(dot);
    });

    function updateMeta() {
      const s = allSlides[current];
      frameMeta.textContent = s.album ? `${s.dept} · ${s.album}` : s.dept;
    }

    function goTo(n) {
      imgs[current].classList.remove('active');
      frameDots.children[current].classList.remove('active');
      current = (n + allSlides.length) % allSlides.length;
      imgs[current].classList.add('active');
      frameDots.children[current].classList.add('active');
      updateMeta();
    }

    document.getElementById('frame-prev').addEventListener('click', () => goTo(current - 1));
    document.getElementById('frame-next').addEventListener('click', () => goTo(current + 1));
    setInterval(() => goTo(current + 1), 4500);
    updateMeta();
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
    if (totalPhotos > 0) {
      const count = document.createElement('span');
      count.className = 'tree-count';
      count.textContent = `${totalPhotos}장`;
      deptLink.appendChild(count);
    }
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
        a.innerHTML = `<span class="tree-line">${isLast ? '└──' : '├──'}</span> ${album.name} <span class="tree-album-count">${album.photos.length}장</span>`;
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
