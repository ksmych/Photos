// 모든 화면이 함께 쓰는 도우미
const $ = sel => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.method = init.method || 'POST';
    init.body = JSON.stringify(opts.json);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `오류가 발생했습니다 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const img = (kind, id) => `/img/${kind}/${encodeURIComponent(id)}`;

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

function param(name) {
  return new URLSearchParams(location.search).get(name);
}

function albumCard(a) {
  return h('a', { class: 'album-card', href: `/album.html?id=${encodeURIComponent(a.id)}` },
    a.cover ? h('img', { src: img('thumb', a.cover), alt: '', loading: 'lazy' }) : h('div', { class: 'noimg' }),
    h('div', { class: 'info' },
      h('div', { class: 'name' }, a.title),
      h('div', { class: 'meta' }, [a.event_date ? fmtDate(a.event_date) : null, `사진 ${a.count}장`].filter(Boolean).join(' · '))));
}

/* 크게 보기 (화면 가득, 큰 버튼, 손가락으로 밀어서 넘기기) */
const lightbox = (() => {
  let photos = [];
  let idx = 0;
  let root;

  function build() {
    root = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': '사진 크게 보기' },
      h('div', { class: 'lb-top' },
        h('span', { id: 'lb-count' }),
        h('button', { class: 'btn small close', onclick: close }, '닫기 ✕')),
      h('div', { class: 'lb-img' }, h('img', { id: 'lb-img', alt: '' })),
      h('div', { class: 'lb-bottom' },
        h('button', { class: 'btn', onclick: () => go(-1) }, '◀ 이전'),
        h('button', { class: 'btn', onclick: () => go(1) }, '다음 ▶')));
    document.body.append(root);
    let sx = 0;
    root.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    document.addEventListener('keydown', e => {
      if (!root.classList.contains('open')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'Escape') close();
    });
  }

  function show() {
    root.querySelector('#lb-img').src = img('web', photos[idx].id);
    root.querySelector('#lb-count').textContent = `${idx + 1} / ${photos.length}`;
    const next = photos[(idx + 1) % photos.length];
    if (next) new Image().src = img('web', next.id);
  }
  function go(d) { idx = (idx + d + photos.length) % photos.length; show(); }
  function open(list, i) {
    if (!root) build();
    photos = list; idx = i;
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    show();
  }
  function close() {
    root.classList.remove('open');
    document.body.style.overflow = '';
  }
  return { open, close };
})();

// 홈 화면 설치와 "공유 → 사진첩" 을 위한 서비스 워커
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
