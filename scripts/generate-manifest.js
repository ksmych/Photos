const fs = require('fs');
const path = require('path');

const REPO = 'ksmych/Photos';
const BRANCH = 'main';
const PHOTOS_DIR = path.join(__dirname, '..', 'photos');
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

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

function isImage(filename) {
  return IMAGE_EXTS.includes(path.extname(filename).toLowerCase());
}

function rawUrl(...parts) {
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${parts.join('/')}`;
}

const manifest = { updated: new Date().toISOString(), departments: [] };

for (const dept of DEPARTMENTS) {
  const deptPath = path.join(PHOTOS_DIR, dept.id);
  const deptEntry = { id: dept.id, name: dept.name, albums: [], directPhotos: [] };

  if (fs.existsSync(deptPath)) {
    const entries = fs.readdirSync(deptPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        const albumPath = path.join(deptPath, entry.name);
        const photos = fs.readdirSync(albumPath)
          .filter(f => !f.startsWith('.') && isImage(f))
          .sort()
          .map(f => ({ name: f, url: rawUrl('photos', dept.id, entry.name, f) }));
        deptEntry.albums.push({ name: entry.name, photos });
      } else if (isImage(entry.name)) {
        deptEntry.directPhotos.push({
          name: entry.name,
          url: rawUrl('photos', dept.id, entry.name)
        });
      }
    }
  }

  manifest.departments.push(deptEntry);
}

const outPath = path.join(__dirname, '..', 'manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`manifest.json 생성 완료 (부서 ${manifest.departments.length}개)`);
