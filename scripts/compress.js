const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PHOTOS_DIR = path.join(__dirname, '..', 'photos');
const MAX_WIDTH = 1920;
const QUALITY = 85;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) return;

  const stat = fs.statSync(filePath);
  const sizeMB = stat.size / 1024 / 1024;

  // 이미 500KB 이하면 건너뜀
  if (stat.size < 500 * 1024) {
    console.log(`건너뜀 (이미 작음): ${filePath}`);
    return;
  }

  try {
    const image = sharp(filePath);
    const meta = await image.metadata();

    const needsResize = meta.width > MAX_WIDTH;

    let pipeline = image;
    if (needsResize) {
      pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }

    // 임시 파일로 저장 후 교체
    const tmpPath = filePath + '.tmp';
    await pipeline
      .jpeg({ quality: QUALITY, progressive: true })
      .toFile(tmpPath);

    const newStat = fs.statSync(tmpPath);
    const newSizeMB = newStat.size / 1024 / 1024;

    fs.renameSync(tmpPath, filePath);

    console.log(`압축 완료: ${path.basename(filePath)} | ${sizeMB.toFixed(1)}MB → ${newSizeMB.toFixed(1)}MB`);
  } catch (err) {
    console.error(`오류: ${filePath}`, err.message);
    const tmpPath = filePath + '.tmp';
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

async function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath);
    } else {
      await compressImage(fullPath);
    }
  }
}

walkDir(PHOTOS_DIR).then(() => console.log('압축 완료'));
