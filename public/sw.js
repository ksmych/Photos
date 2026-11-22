// 서비스 워커: 카카오톡 등에서 "공유 → 사진첩" 으로 보낸 사진을 받아 올리기 화면으로 넘깁니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shared-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveShared(files) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(files, 'pending');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const files = form.getAll('photos').filter(f => f && typeof f !== 'string' && f.size > 0);
      await saveShared(files);
      return Response.redirect('/upload.html?shared=1', 303);
    } catch {
      return Response.redirect('/upload.html?shared=fail', 303);
    }
  })());
});
