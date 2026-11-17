'use strict';
/* Within — an offline retreat journal. Plain JavaScript, no build step.
   Data lives in this device's IndexedDB; nothing is sent anywhere. */

const APP_VERSION = '1.1.0';
const PDFJS_VER = '3.11.174';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;

/* ───────── helpers ───────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const rafThrottle = (fn) => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };
const today = () => new Date().toISOString().slice(0, 10);
const parseKeys = (s) => String(s || '').split(/[,;\n]/).map((k) => k.trim()).filter((k) => k.length > 1);
const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

const ICONS = {
  pen: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l2 2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  spark: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  book: '<path d="M3 5.5c3-1.2 6-1 9 1 3-2 6-2.2 9-1V19c-3-1.2-6-1-9 1-3-2-6-2.2-9-1z"/><path d="M12 6.5V20"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7h14v-7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  camera: '<path d="M4 8h3l1.5-2.2h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
};
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/* ───────── storage (IndexedDB) ───────── */
let _db;
function openDB() {
  if (!_db) {
    _db = new Promise((res, rej) => {
      const r = indexedDB.open('within-journal', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return _db;
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const idb = {
  async get(st, key) { const d = await openDB(); return reqP(d.transaction(st).objectStore(st).get(key)); },
  async all(st) { const d = await openDB(); return reqP(d.transaction(st).objectStore(st).getAll()); },
  async has(st, key) { const d = await openDB(); return (await reqP(d.transaction(st).objectStore(st).count(key))) > 0; },
  async put(st, val, key) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const t = d.transaction(st, 'readwrite');
      if (key === undefined) t.objectStore(st).put(val); else t.objectStore(st).put(val, key);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  async del(st, key) {
    const d = await openDB();
    return new Promise((res, rej) => {
      const t = d.transaction(st, 'readwrite');
      t.objectStore(st).delete(key);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  },
};

/* ───────── state ───────── */
const S = {
  entries: [],
  settings: { autolink: true, theme: 'auto', installDismissed: false },
  topicEdits: {},     // builtin topic id -> { keys: [...extra], note }
  customTopics: [],   // { id, title, keys, gist, note }
  customSources: [],  // { id, name, short, aliases, by }
  fileMeta: {},       // source id -> { name, size, pages, added }
  ver: 0,
  jq: '', tq: '', topicSort: 'realm',
  prompt: null,
  navDepth: 0, curHash: '', prevHash: '',
  scroll: {},
  onLeave: null,
  sheetPick: null,
  urls: [],            // object URLs for photos/sounds shown in the current view
  viewer: null,        // open photo viewer
  preparedBackup: null,
};

async function load() {
  try {
    const [entries, settings, topicEdits, customTopics, customSources, fileMeta] = await Promise.all([
      idb.all('entries'), idb.get('kv', 'settings'), idb.get('kv', 'topicEdits'),
      idb.get('kv', 'customTopics'), idb.get('kv', 'customSources'), idb.get('kv', 'fileMeta'),
    ]);
    S.entries = entries || [];
    if (settings) Object.assign(S.settings, settings);
    if (topicEdits) S.topicEdits = topicEdits;
    if (customTopics) S.customTopics = customTopics;
    if (customSources) S.customSources = customSources;
    if (fileMeta) S.fileMeta = fileMeta;
  } catch (err) {
    console.error(err);
    setTimeout(() => toast('Storage is unavailable here, so entries may not be kept'), 600);
  }
}
const saveKV = (k) => idb.put('kv', S[k], k).catch((err) => toast('Could not save: ' + err.message));

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}
async function saveEntry(e) {
  e.updatedAt = Date.now();
  if (!S.entries.includes(e)) S.entries.push(e);
  try { await idb.put('entries', { id: e.id, title: e.title, body: e.body, createdAt: e.createdAt, updatedAt: e.updatedAt, media: e.media || [] }); askPersist(); }
  catch (err) { toast('Could not save this entry'); }
}

/* ───────── topics, sources & the keyword matcher ───────── */
let TOPIC_LIST = [];
let TOPIC_MAP = new Map();
let KW = { map: new Map(), re: null };
let REF = { map: new Map(), src: '(?!)', combo: /\[\[([^\[\]\n]{1,80})\]\]/g };

function rebuildTopics() {
  TOPIC_LIST = [];
  for (const t of TOPICS) {
    const ed = S.topicEdits[t.id] || {};
    const extra = ed.keys || [];
    TOPIC_LIST.push({ ...t, builtin: true, extraKeys: extra, allKeys: [...t.keys, ...extra], note: ed.note || '' });
  }
  for (const t of S.customTopics) {
    TOPIC_LIST.push({
      id: t.id, realm: 'mine', title: t.title, keys: t.keys || [], extraKeys: t.keys || [], allKeys: t.keys || [],
      gist: t.gist || '', note: t.note || '', prompts: [], steps: [], refs: [], related: [], builtin: false,
    });
  }
  TOPIC_MAP = new Map(TOPIC_LIST.map((t) => [t.id, t]));

  // Words you added yourself win over the built-in vocabulary.
  const map = new Map();
  const claim = (k, id) => { const kk = String(k).trim().toLowerCase(); if (kk.length >= 2 && !map.has(kk)) map.set(kk, id); };
  for (const t of TOPIC_LIST) {
    if (!t.builtin) claim(t.title, t.id);
    for (const k of t.extraKeys) claim(k, t.id);
  }
  for (const t of TOPIC_LIST) {
    if (!t.builtin) continue;
    claim(t.title, t.id);
    for (const k of t.keys) claim(k, t.id);
  }
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(reEsc);
  KW = {
    map,
    re: alts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join('|')})(?:['’]s|s|es)?(?![\\p{L}\\p{N}])`, 'giu') : null,
  };
  rebuildRefs();
  S.ver++;
}

function sourcesList() { return [...SOURCES, ...S.customSources.map((s) => ({ ...s, custom: true, toc: [] }))]; }
function sourceById(id) { return sourcesList().find((s) => s.id === id); }
function rebuildRefs() {
  const map = new Map();
  for (const s of sourcesList()) for (const a of [s.name, s.short, ...(s.aliases || [])]) if (a && a.length > 1) map.set(a.toLowerCase(), s.id);
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|');
  const src = alts ? `(?<![\\p{L}\\p{N}])(${alts}),?\\s*(?:pp?\\.|page|pg\\.?|p)\\s*(\\d{1,4})` : '(?!)';
  // One pass finds [[explicit links]] (group 1) and "Source p.N" refs (groups 2, 3).
  REF = { map, src, combo: new RegExp(`\\[\\[([^\\[\\]\\n]{1,80})\\]\\]|${src}`, 'giu') };
}
function resolveTitle(txt) {
  const k = String(txt).trim().toLowerCase();
  for (const t of TOPIC_LIST) if (t.title.toLowerCase() === k) return t.id;
  return KW.map.get(k) || null;
}

/* Split text into plain text, keyword links, [[explicit links]] and source page refs. */
function tokenize(text, autolink = S.settings.autolink) {
  const out = [];
  const plain = (s) => {
    if (!s) return;
    if (!autolink || !KW.re) { out.push({ t: 'text', s }); return; }
    KW.re.lastIndex = 0;
    let last = 0, m;
    while ((m = KW.re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
      out.push({ t: 'kw', s: m[0], id: KW.map.get(m[1].toLowerCase()) });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  };
  const re = REF.combo;
  re.lastIndex = 0;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) plain(text.slice(last, m.index));
    if (m[1] !== undefined) out.push({ t: 'wiki', s: m[1], raw: m[0], id: resolveTitle(m[1]) });
    else out.push({ t: 'ref', s: m[0], raw: m[0], src: REF.map.get(m[2].toLowerCase()), page: +m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) plain(text.slice(last));
  return out;
}

function tokHtml(tokens) {
  return tokens.map((k) => {
    if (k.t === 'text') return esc(k.s);
    if (k.t === 'kw') { const t = TOPIC_MAP.get(k.id); return t ? `<a class="kw r-${t.realm}" href="#/topic/${t.id}">${esc(k.s)}</a>` : esc(k.s); }
    if (k.t === 'wiki') {
      const t = k.id && TOPIC_MAP.get(k.id);
      if (t) return `<a class="wl r-${t.realm}" href="#/topic/${t.id}">${esc(k.s)}</a>`;
      return `<a class="wl missing" href="#" data-act="new-topic-from" data-title="${esc(k.s)}">${esc(k.s)}</a>`;
    }
    if (k.t === 'ref') return `<a class="ref" href="#/read/${k.src}/${k.page}">${ic('book')}${esc(k.s)}</a>`;
    return '';
  }).join('');
}

function renderBody(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '', buf = [], mode = null;
  const line = (l) => tokHtml(tokenize(l));
  const flush = () => {
    if (!buf.length) { mode = null; return; }
    if (mode === 'ul') html += `<ul>${buf.map((l) => `<li>${line(l)}</li>`).join('')}</ul>`;
    else if (mode === 'q') html += `<blockquote>${buf.map(line).join('<br>')}</blockquote>`;
    else html += `<p>${buf.map(line).join('<br>')}</p>`;
    buf = []; mode = null;
  };
  for (const l of lines) {
    let m;
    if (!l.trim()) { flush(); continue; }
    if ((m = l.match(/^\s*[-•*]\s+(.*)$/))) { if (mode !== 'ul') { flush(); mode = 'ul'; } buf.push(m[1]); }
    else if ((m = l.match(/^\s*>\s?(.*)$/))) { if (mode !== 'q') { flush(); mode = 'q'; } buf.push(m[1]); }
    else { if (mode !== 'p') { flush(); mode = 'p'; } buf.push(l); }
  }
  flush();
  return html;
}

const topicCache = new Map();
function entryTopics(e) {
  const c = topicCache.get(e.id);
  if (c && c.ver === S.ver && c.upd === e.updatedAt && c.len === (e.body || '').length) return c.set;
  const set = topicsInText(entryText(e));
  topicCache.set(e.id, { ver: S.ver, upd: e.updatedAt, len: (e.body || '').length, set });
  return set;
}
function topicsInText(text) {
  const set = new Set();
  for (const k of tokenize(text)) if ((k.t === 'kw' || k.t === 'wiki') && k.id) set.add(k.id);
  return set;
}
/* Captions on photos and sounds count as part of the entry, so they link to topics too. */
function captionsOf(e) { return (e.media || []).map((m) => m.caption || '').filter(Boolean).join('\n'); }
function entryText(e) { return `${e.title || ''}\n${e.body || ''}\n${captionsOf(e)}`; }
function entryTitle(e) {
  if (e.title && e.title.trim()) return e.title.trim();
  const fl = firstLine(e.body);
  if (fl) return fl;
  const ms = e.media || [];
  const cap = ms.find((m) => m.caption)?.caption;
  if (cap) return cap;
  if (ms.some((m) => m.kind === 'image')) return 'Photo';
  return ms.length ? 'Sound' : 'Untitled';
}
function topicCounts() {
  const m = new Map();
  for (const e of S.entries) for (const id of entryTopics(e)) m.set(id, (m.get(id) || 0) + 1);
  return m;
}
function plainText(text) {
  return String(text || '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^\s*[>\-•*]\s?/gm, '').replace(/\s+/g, ' ').trim();
}
function firstLine(text) { return plainText(String(text || '').split('\n').find((l) => l.trim()) || '').slice(0, 80); }

function snippetFor(e, topicId) {
  const text = String(e.body || '').replace(/\s+/g, ' ');
  let pos = 0, hit = null;
  for (const k of tokenize(text)) {
    const len = (k.raw || k.s).length;
    if ((k.t === 'kw' || k.t === 'wiki') && k.id === topicId) { hit = { at: pos, len, show: k.s }; break; }
    pos += len;
  }
  if (!hit) return esc(plainText(text).slice(0, 140));
  let a = Math.max(0, hit.at - 70), b = Math.min(text.length, hit.at + hit.len + 100);
  if (a > 0) a = text.indexOf(' ', a) + 1 || a;
  const pre = plainText(text.slice(a, hit.at)), post = plainText(text.slice(hit.at + hit.len, b));
  return `${a > 0 ? '…' : ''}${esc(pre)} <mark>${esc(hit.show)}</mark> ${esc(post)}${b < text.length ? '…' : ''}`;
}

function allPrompts() {
  const out = [];
  for (const t of TOPIC_LIST) for (const p of (t.prompts || [])) out.push({ p, id: t.id });
  return out;
}
function randomPrompt(exclude) {
  const all = allPrompts().filter((x) => !exclude || x.p !== exclude.p);
  return all.length ? all[Math.floor(Math.random() * all.length)] : null;
}

/* ───────── routing ───────── */
const V = document.getElementById('view');
const ROUTES = [
  [/^#\/journal$/, viewJournal],
  [/^#\/entry\/([\w-]+)$/, viewEntry],
  [/^#\/edit\/([\w-]+)$/, viewEdit],
  [/^#\/topics$/, viewTopics],
  [/^#\/topic\/([\w-]+)$/, viewTopic],
  [/^#\/sources$/, viewSources],
  [/^#\/read\/([\w-]+)(?:\/(\d+))?$/, viewReader],
  [/^#\/more$/, viewMore],
];

function go(hash, { replace = false } = {}) {
  if (hash === location.hash && !replace) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (replace) history.replaceState(null, '', hash);
  else { history.pushState(null, '', hash); S.navDepth++; }
  router();
}
function back(fallback) {
  if (S.navDepth > 0) history.back();
  else go(fallback || '#/journal', { replace: true });
}
function router(force = false, restore = false) {
  const h = location.hash || '#/journal';
  if (!force && h === S.curHash) return;
  if (S.curHash) S.scroll[S.curHash] = window.scrollY;
  if (S.onLeave) { const f = S.onLeave; S.onLeave = null; try { f(); } catch (e) { console.error(e); } }
  closeSheet();
  closeViewer();
  for (const u of S.urls) URL.revokeObjectURL(u);
  S.urls = [];
  S.prevHash = S.curHash;
  S.curHash = h;
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) {
      fn(...m.slice(1));
      const y = restore || force ? (S.scroll[h] || 0) : 0;
      if (!h.startsWith('#/read/')) requestAnimationFrame(() => window.scrollTo(0, y));
      return;
    }
  }
  go('#/journal', { replace: true });
}
window.addEventListener('popstate', () => { S.navDepth = Math.max(0, S.navDepth - 1); router(false, true); });
window.addEventListener('hashchange', () => router(false, true));

function mount(html, { tab = null, cls = '' } = {}) {
  document.body.className = cls;
  V.innerHTML = html;
  const tabs = document.getElementById('tabs');
  tabs.hidden = !tab;
  for (const a of $$('a', tabs)) a.classList.toggle('on', a.dataset.tab === tab);
}
function bar({ back: fb = '#/journal', title = '', right = '' } = {}) {
  return `<header class="bar"><button class="icon-btn" data-back="${fb}" aria-label="Back">${ic('back')}</button><div class="bar-title">${esc(title)}</div><div class="bar-right">${right}</div></header>`;
}
const chip = (t) => (t ? `<a class="chip r-${t.realm}" href="#/topic/${t.id}"><i class="dot"></i>${esc(t.title)}</a>` : '');
function notFound(fallback) {
  mount(`${bar({ back: fallback })}<div class="wrap pad center"><p class="muted">This page is no longer here.</p></div>`, { tab: null });
}

window.addEventListener('scroll', rafThrottle(() => {
  const b = $('.bar');
  if (b) b.classList.toggle('scrolled', window.scrollY > 4);
}), { passive: true });

/* ───────── Journal ───────── */
function viewJournal() {
  mount(`
    <header class="top">
      <div class="eyebrow">Christmas of the Angels · going within</div>
      <h1 class="display">Journal</h1>
    </header>
    <div class="wrap">
      ${installNudge()}
      ${promptCard()}
      <label class="search">${ic('search')}<input id="jq" type="search" placeholder="Search your journal and topics" value="${esc(S.jq)}" autocomplete="off" enterkeyhint="search"></label>
      <div id="jlist"></div>
    </div>
    <button class="fab" data-act="new" aria-label="New entry">${ic('pen')}<span>Write</span></button>`, { tab: 'journal' });
  renderJournalList();
  $('#jq').addEventListener('input', (e) => { S.jq = e.target.value; renderJournalList(); });
}

function installNudge() {
  if (isStandalone() || S.settings.installDismissed) return '';
  return `<div class="card nudge">${ic('download')}<p>To keep Within on your iPhone and use it offline, add it to your Home Screen. <a href="#/more">How</a></p><button class="icon-btn" data-act="dismiss-install" aria-label="Dismiss" style="width:32px;height:32px;color:var(--ink-3)">${ic('close')}</button></div>`;
}

function promptCard() {
  if (!S.prompt) S.prompt = randomPrompt();
  const p = S.prompt;
  if (!p) return '';
  const t = TOPIC_MAP.get(p.id);
  return `<section class="card prompt r-${t.realm}">
    <div class="card-eyebrow">${ic('spark', 'fill')} A question to sit with</div>
    <p class="prompt-text">${esc(p.p)}</p>
    <div class="prompt-foot">
      <a class="from" href="#/topic/${t.id}">${esc(t.title)}</a><span class="grow"></span>
      <button class="btn ghost sm" data-act="prompt-next">Another</button>
      <button class="btn sm" data-act="prompt-write">Write</button>
    </div>
  </section>`;
}

function renderJournalList() {
  const el = $('#jlist');
  if (!el) return;
  if (!S.entries.length) { el.innerHTML = emptyJournal(); return; }
  const q = S.jq.trim().toLowerCase();
  let list = [...S.entries].sort((a, b) => b.createdAt - a.createdAt);
  let hits = '';
  if (q) {
    list = list.filter((e) => entryText(e).toLowerCase().includes(q));
    const th = TOPIC_LIST.filter((t) => t.title.toLowerCase().includes(q) || t.allKeys.some((k) => k.toLowerCase().includes(q))).slice(0, 8);
    if (th.length) hits = `<div class="chips topic-hits">${th.map(chip).join('')}</div>`;
  }
  el.innerHTML = hits + (list.length ? list.map(entryCard).join('') : `<p class="muted center pad">Nothing in your journal matches “${esc(S.jq)}”.</p>`);
  hydrateMedia(el);
}

function entryCard(e) {
  const ids = [...entryTopics(e)];
  const shown = ids.slice(0, 4).map((id) => TOPIC_MAP.get(id)).filter(Boolean);
  const hasTitle = !!(e.title && e.title.trim());
  const title = entryTitle(e);
  let snip = plainText(e.body);
  if (!hasTitle && snip.startsWith(title)) snip = snip.slice(title.length).trim();
  const imgs = (e.media || []).filter((m) => m.kind === 'image');
  const auds = (e.media || []).filter((m) => m.kind === 'audio');
  const strip = imgs.length || auds.length
    ? `<div class="thumbs">${imgs.slice(0, 4).map((m) => `<img data-media="${m.id}" data-v="thumb" alt="">`).join('')}${imgs.length > 4 ? `<span class="more">+${imgs.length - 4}</span>` : ''}${auds.length ? `<span class="aud-chip">${ic('note')}${auds.length > 1 ? `${auds.length} sounds` : (fmtDur(auds[0].dur) || 'Sound')}</span>` : ''}</div>`
    : '';
  return `<a class="card entry" href="#/entry/${e.id}">
    <div class="entry-date">${esc(fmtDate(e.createdAt))}</div>
    <h3 class="entry-title">${esc(title)}</h3>
    ${snip ? `<p class="entry-snip">${esc(snip.slice(0, 220))}</p>` : ''}
    ${strip}
    ${shown.length ? `<div class="dots">${shown.map((t) => `<span class="dot-chip r-${t.realm}"><i></i>${esc(t.title)}</span>`).join('')}${ids.length > 4 ? `<span class="more">+${ids.length - 4}</span>` : ''}</div>` : ''}
  </a>`;
}

function emptyJournal() {
  return `<section class="card empty">
    <div class="eyebrow">Begin</div>
    <h2>Write what stirred in the silence</h2>
    <p>Write naturally. Words such as <em>tree</em>, <em>sylph</em>, <em>witness</em>, <em>group lotus</em> or <em>silver bells</em> link themselves to their topics, so each entry joins the map of practice.</p>
    <p>To link something on purpose, put it in double brackets, like <code>[[The Birth Within]]</code>. To point at a page, write <code>Guidebook p.17</code> or <code>Christmas of the Angels p.5</code>.</p>
    <button class="btn wide" data-act="new">${ic('pen')} Write your first entry</button>
  </section>`;
}

/* ───────── Entry view ───────── */
function viewEntry(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return notFound('#/journal');
  const topics = [...entryTopics(e)].map((i) => TOPIC_MAP.get(i)).filter(Boolean);
  const edited = e.updatedAt - e.createdAt > 120000 ? ` · edited ${esc(fmtDate(e.updatedAt))}` : '';
  mount(`${bar({ back: '#/journal', right: `<button class="icon-btn" data-act="edit" data-id="${e.id}" aria-label="Edit">${ic('pen')}</button>` })}
    <article class="wrap entry-view">
      <div class="entry-date">${esc(fmtDate(e.createdAt))}${edited}</div>
      ${e.title ? `<h1 class="title">${esc(e.title)}</h1>` : '<div style="height:12px"></div>'}
      ${mediaHtml(e)}
      <div class="prose">${renderBody(e.body) || (e.media?.length ? '' : '<p class="muted">Empty entry.</p>')}</div>
      ${topics.length ? `<section class="woven"><h2 class="h-sec">Woven with</h2><div class="chips">${topics.map(chip).join('')}</div></section>` : ''}
      <div class="entry-actions"><button class="btn danger sm" data-act="delete-entry" data-id="${e.id}">${ic('trash')} Delete entry</button></div>
    </article>`, { tab: 'journal' });
  hydrateMedia(V);
}

/* ───────── Editor ───────── */
function newEntry(body = '') {
  const now = Date.now();
  const e = { id: uid(), title: '', body, createdAt: now, updatedAt: now };
  S.entries.push(e);
  go(`#/edit/${e.id}`);
  if (body.trim()) saveEntry(e);
}

function viewEdit(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return notFound('#/journal');
  mount(`<header class="bar edit-bar">
      <span class="saved" id="saved" style="text-align:left;padding-left:8px"></span>
      <div class="bar-title">${esc(fmtDate(e.createdAt))}</div>
      <button class="text-btn" data-act="edit-done">Done</button>
    </header>
    <div class="wrap editor">
      <input id="e-title" class="e-title" placeholder="Title (optional)" value="${esc(e.title)}" autocomplete="off" enterkeyhint="next">
      <div class="tools">
        <button class="tool" data-act="add-photo">${ic('camera')} Photo</button>
        <button class="tool" data-act="add-sound">${ic('mic')} Sound</button>
        <button class="tool" data-act="ins-link">${ic('link')} Link a topic</button>
        <button class="tool" data-act="ins-prompt">${ic('spark', 'fill')} A question</button>
        <button class="tool" data-act="ins-ref">${ic('book')} Source page</button>
      </div>
      <div id="e-media" class="atts" hidden></div>
      <textarea id="e-body" class="e-body" placeholder="What stirred within…">${esc(e.body)}</textarea>
      <div id="e-links" class="chips e-links"></div>
      <p class="hint">Topic words link themselves. Use <code>[[ ]]</code> to link anything on purpose, or write “Guidebook p.17” to point at a page.</p>
    </div>`, { tab: null, cls: 'editing' });

  const ta = $('#e-body'), ti = $('#e-title'), saved = $('#saved');
  let lastSaved = `${e.title}\u0000${e.body}`;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 4, window.innerHeight * 0.45) + 'px'; };
  const links = () => {
    const ids = [...topicsInText(`${ti.value}\n${ta.value}\n${captionsOf(e)}`)];
    const box = $('#e-links');
    if (box) box.innerHTML = ids.length ? `<span class="lbl">Woven with</span>${ids.map((i) => chip(TOPIC_MAP.get(i))).join('')}` : '';
  };
  // force = save even if the text is unchanged (a photo, sound or caption changed)
  const commit = async (force = false) => {
    e.title = ti.value; e.body = ta.value;
    const now = `${e.title}\u0000${e.body}`;
    const empty = !e.title.trim() && !e.body.trim() && !(e.media && e.media.length);
    if (empty || (!force && now === lastSaved)) return;
    lastSaved = now;
    await saveEntry(e);
    if (saved.isConnected) saved.textContent = 'Saved';
  };
  const save = debounce(commit, 600);
  const linksLater = debounce(links, 250);
  const onInput = () => { saved.textContent = ''; grow(); save(); linksLater(); };
  ta.addEventListener('input', onInput);
  ti.addEventListener('input', onInput);
  ti.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ta.focus(); } });
  grow(); links();

  S.editor = { e, ta, ti, commit, links };
  renderAttachments();
  S.onLeave = () => {
    S.editor = null;
    e.title = ti.value; e.body = ta.value;
    if (!e.title.trim() && !e.body.trim() && !(e.media && e.media.length)) {
      S.entries = S.entries.filter((x) => x !== e);
      idb.del('entries', e.id).catch(() => {});
    } else if (`${e.title}\u0000${e.body}` !== lastSaved) {
      saveEntry(e);
    }
  };
  ta.focus();
  const end = ta.value.length;
  try { ta.setSelectionRange(end, end); } catch (_) { /* ignore */ }
}

function insertAtCursor(text) {
  const ed = S.editor;
  if (!ed) return;
  const ta = ed.ta;
  const [s, en] = ed.sel || [ta.value.length, ta.value.length];
  ta.focus();
  ta.setRangeText(text, s, en, 'end');
  ta.dispatchEvent(new Event('input'));
}

/* ───────── Sheets ───────── */
function openSheet(html, { modal = false } = {}) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg" ${modal ? '' : 'data-act="sheet-close"'}></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
}
function closeSheet() {
  const root = $('#sheet-root');
  // Never lose a recording because its sheet closed: keep what was captured.
  if (REC.rec && REC.rec.state !== 'inactive') stopRecording(true);
  else if (REC.stream || REC.ctx) cleanupRec();
  if (!root || !root.classList.contains('open')) return;
  root.classList.remove('open');
  root.innerHTML = '';
  S.sheetPick = null;
}

function topicPicker(onPick, title = 'Link a topic') {
  openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3><button class="text-btn" data-act="sheet-close">Close</button></div>
    <label class="search">${ic('search')}<input id="tp-q" type="search" placeholder="Search topics" autocomplete="off"></label>
    <div id="tp-list" class="tp-list"></div>`);
  const draw = (q = '') => {
    q = q.trim().toLowerCase();
    const items = TOPIC_LIST.filter((t) => !q || t.title.toLowerCase().includes(q) || t.allKeys.some((k) => k.toLowerCase().includes(q)));
    let html = REALM_ORDER.map((r) => {
      const its = items.filter((t) => t.realm === r);
      if (!its.length) return '';
      return `<div class="r-${r}"><div class="tp-realm">${esc(REALMS[r].name)}</div>${its.map((t) => `<button class="tp-item r-${r}" data-pick="${t.id}"><i class="dot"></i>${esc(t.title)}</button>`).join('')}</div>`;
    }).join('');
    if (q && !items.some((t) => t.title.toLowerCase() === q)) html += `<button class="tp-item" data-pick-new="${esc(q)}">${ic('plus')} New topic “${esc(q)}”</button>`;
    $('#tp-list').innerHTML = html;
  };
  draw();
  $('#tp-q').addEventListener('input', (ev) => draw(ev.target.value));
  S.sheetPick = onPick;
}

function promptPicker() {
  const ed = S.editor;
  const linked = ed ? [...topicsInText(`${ed.ti.value}\n${ed.ta.value}`)] : [];
  const fromLinked = [];
  for (const id of linked) for (const p of (TOPIC_MAP.get(id)?.prompts || [])) fromLinked.push({ p, id });
  const others = [];
  const pool = allPrompts().filter((x) => !linked.includes(x.id));
  for (let i = 0; i < 6 && pool.length; i++) others.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const row = (x) => { const t = TOPIC_MAP.get(x.id); return `<button class="tp-item prompt-pick r-${t.realm}" data-prompt="${esc(x.p)}"><i class="dot"></i><span>${esc(x.p)}</span></button>`; };
  openSheet(`<div class="sheet-head"><h3>A question to sit with</h3><button class="text-btn" data-act="sheet-close">Close</button></div>
    ${fromLinked.length ? `<div class="tp-realm" style="--rc:var(--gold)">From the topics in this entry</div>${fromLinked.map(row).join('')}` : ''}
    <div class="tp-realm" style="--rc:var(--gold)">${fromLinked.length ? 'Or another' : 'Some questions'}</div>${others.map(row).join('')}
    <button class="btn ghost wide" data-act="ins-prompt">Show others</button>`);
}

function refPicker() {
  const rows = sourcesList().map((s) => `<button class="tp-item" data-ref-src="${s.id}">${ic('book')} ${esc(s.subtitle || s.name)}</button>`).join('');
  openSheet(`<div class="sheet-head"><h3>Point to a page</h3><button class="text-btn" data-act="sheet-close">Close</button></div>
    <label class="field"><span>Page number</span><input id="ref-page" type="number" inputmode="numeric" min="1" placeholder="e.g. 17"></label>
    <div class="tp-realm" style="--rc:var(--gold)">Source</div>${rows}`);
}

function newTopicSheet(prefill = '', insertAfter = false) {
  openSheet(`<div class="sheet-head"><h3>New topic</h3><button class="text-btn" data-act="sheet-close">Cancel</button></div>
    <label class="field"><span>Name</span><input id="nt-title" value="${esc(prefill)}" placeholder="e.g. The banyan by the lake" autocomplete="off"></label>
    <label class="field"><span>Words that should link here (separate with commas)</span><input id="nt-keys" placeholder="e.g. banyan, lake" autocomplete="off"></label>
    <label class="field"><span>A few words about it (optional)</span><textarea id="nt-gist" rows="3"></textarea></label>
    <button class="btn wide" data-act="create-topic" data-insert="${insertAfter ? '1' : ''}">Create topic</button>`);
}

function createTopic(title, keys = [], gist = '') {
  title = String(title || '').trim();
  if (!title) return null;
  const existing = TOPIC_LIST.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (existing) return existing.id;
  const t = { id: 'my-' + uid(), title, keys, gist, note: '' };
  S.customTopics.push(t);
  saveKV('customTopics');
  rebuildTopics();
  return t.id;
}

/* ───────── Photos & sounds ─────────
   Each entry keeps a list of attachments: { id, kind: 'image'|'audio', type, name, size, w, h, dur, caption }.
   The bytes live in the 'media' store: { id, type, data: ArrayBuffer, thumb?: ArrayBuffer }. */
const MEDIA_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
  'audio/aiff': 'aif', 'audio/x-aiff': 'aif', 'audio/x-caf': 'caf',
};
const AUDIO_BY_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf' };
const baseType = (t) => String(t || '').split(';')[0].trim().toLowerCase();
const extOf = (name) => (String(name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase();
const extFor = (m) => MEDIA_EXT[baseType(m.type)] || extOf(m.name) || 'bin';
const fmtDur = (s) => { if (!isFinite(s) || s <= 0) return ''; s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const hasAnyMedia = () => S.entries.some((e) => e.media && e.media.length);

function pickFiles(accept, multiple = false) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(i);
    i.addEventListener('change', () => { res([...(i.files || [])]); i.remove(); }, { once: true });
    i.click();
  });
}
const pickFile = (accept) => pickFiles(accept).then((fs) => fs[0] || null);

function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image couldn’t be read')); i.src = url; });
}
function drawScaled(img, max, quality) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, max / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(async (b) => {
    c.width = 0; c.height = 0;
    if (!b) { rej(new Error('encode')); return; }
    res({ buf: await b.arrayBuffer(), w, h });
  }, 'image/jpeg', quality));
}
/* Photos are stored at up to 2048 px (plenty for a phone, and kind to storage), plus a small thumbnail. */
async function processImage(file) {
  const type = baseType(file.type);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('empty image');
    const thumb = await drawScaled(img, 640, 0.8);
    const keepAsIs = (type === 'image/gif' && file.size <= 1e7)
      || (['image/jpeg', 'image/png', 'image/webp'].includes(type) && file.size <= 1.5e6 && Math.max(W, H) <= 2560);
    if (keepAsIs) return { data: await file.arrayBuffer(), thumb: thumb.buf, type, w: W, h: H };
    const big = await drawScaled(img, 2048, 0.86);
    return { data: big.buf, thumb: thumb.buf, type: 'image/jpeg', w: big.w, h: big.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function thumbFrom(buf, type) {
  const url = URL.createObjectURL(new Blob([buf], { type }));
  try { return (await drawScaled(await loadImg(url), 640, 0.8)).buf; } finally { URL.revokeObjectURL(url); }
}
function probeDuration(blob) {
  return new Promise((res) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    let done = false;
    const fin = (v) => { if (done) return; done = true; URL.revokeObjectURL(url); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => fin(0);
    setTimeout(() => fin(0), 4000);
    a.src = url;
  });
}

async function addImages(files) {
  const ed = S.editor;
  if (!ed || !files.length) return;
  toast(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding photo…');
  let added = 0;
  for (const f of files) {
    try {
      const p = await processImage(f);
      const m = { id: 'm' + uid(), kind: 'image', type: p.type, name: f.name || 'photo.jpg', size: p.data.byteLength, w: p.w, h: p.h, caption: '' };
      await idb.put('media', { id: m.id, type: m.type, data: p.data, thumb: p.thumb });
      (ed.e.media ||= []).push(m);
      added++;
    } catch (err) {
      console.warn(err);
      toast(`Couldn’t add ${f.name || 'that photo'}`);
    }
  }
  if (added) {
    await ed.commit(true);
    renderAttachments();
    toast(added > 1 ? `${added} photos added` : 'Photo added');
  }
}

async function addAudioFile(f) {
  const ed = S.editor;
  if (!ed || !f) return;
  const ext = extOf(f.name);
  const type = baseType(f.type) || AUDIO_BY_EXT[ext] || '';
  if (!type.startsWith('audio/') && !AUDIO_BY_EXT[ext]) { toast('That doesn’t look like a sound file'); return; }
  if (f.size > 300e6) { toast('That sound file is too large (over 300 MB)'); return; }
  toast('Adding sound…');
  try {
    const data = await f.arrayBuffer();
    const t = type.startsWith('audio/') ? type : AUDIO_BY_EXT[ext];
    const dur = await probeDuration(new Blob([data], { type: t }));
    const m = { id: 'm' + uid(), kind: 'audio', type: t, name: f.name || 'sound', size: data.byteLength, dur, caption: '' };
    await idb.put('media', { id: m.id, type: t, data });
    (ed.e.media ||= []).push(m);
    await ed.commit(true);
    renderAttachments();
    toast('Sound added');
  } catch (err) {
    console.warn(err);
    toast('That sound couldn’t be added');
  }
}

/* Recording (MediaRecorder; on iPhone this records AAC in an .m4a file). */
const REC = { stream: null, rec: null, chunks: [], t0: 0, tick: null, wake: null, ctx: null, raf: 0, mime: '' };
function recordSheet() {
  openSheet(`<div class="sheet-head"><h3>Record a sound</h3><button class="text-btn" data-act="rec-cancel">Cancel</button></div>
    <div class="rec"><div class="rec-orb" id="rec-orb"><span id="rec-time">0:00</span></div>
    <p class="muted small center" id="rec-status">Starting the microphone…</p></div>
    <button class="btn wide" data-act="rec-stop" id="rec-stop" disabled>${ic('check')} Stop and keep</button>
    <p class="hint center">Keep Within open while recording. If the phone locks, the recording stops and what was captured is kept.</p>`, { modal: true });
  startRecording();
}
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    closeSheet();
    toast('Recording isn’t available here. Choose a sound file instead.');
    return;
  }
  // Create the audio context inside the tap so iOS lets it run (it drives the level glow).
  try { REC.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { REC.ctx = null; }
  try {
    REC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (err) {
    cleanupRec();
    closeSheet();
    toast('Microphone access wasn’t allowed');
    return;
  }
  if (!$('#rec-orb')) { cleanupRec(); return; }
  REC.mime = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  try { REC.rec = new MediaRecorder(REC.stream, REC.mime ? { mimeType: REC.mime } : undefined); }
  catch (err) { cleanupRec(); closeSheet(); toast('Recording couldn’t start'); return; }
  REC.chunks = [];
  REC.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) REC.chunks.push(ev.data); };
  REC.rec.start(1000);
  REC.t0 = Date.now();
  $('#rec-status').textContent = 'Recording';
  $('#rec-stop').disabled = false;
  $('#rec-orb').classList.add('on');
  REC.tick = setInterval(() => { const el = $('#rec-time'); if (el) el.textContent = fmtDur((Date.now() - REC.t0) / 1000) || '0:00'; }, 250);
  try { REC.wake = await navigator.wakeLock?.request('screen'); } catch (_) { /* optional */ }
  const ctx = REC.ctx;
  if (ctx) {
    try {
      await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(REC.stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        if (!REC.rec) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
        $('#rec-orb')?.style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / buf.length) * 5).toFixed(3));
        REC.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (_) { /* the glow is optional */ }
  }
}
function stopRecording(keep) {
  return new Promise((res) => {
    const rec = REC.rec;
    const ed = S.editor;
    const dur = (Date.now() - REC.t0) / 1000;
    if (!rec || rec.state === 'inactive') { cleanupRec(); res(); return; }
    rec.onstop = async () => {
      const chunks = REC.chunks;
      const type = baseType(rec.mimeType || REC.mime) || 'audio/mp4';
      cleanupRec();
      if (keep && chunks.length && ed) {
        try {
          const data = await new Blob(chunks, { type }).arrayBuffer();
          const when = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const m = { id: 'm' + uid(), kind: 'audio', type, name: `Recording ${when}.${MEDIA_EXT[type] || 'm4a'}`, size: data.byteLength, dur, caption: '' };
          await idb.put('media', { id: m.id, type, data });
          (ed.e.media ||= []).push(m);
          await ed.commit(true);
          renderAttachments();
          ed.links();
          toast('Recording kept');
        } catch (err) {
          console.error(err);
          toast('The recording couldn’t be saved');
        }
      }
      res();
    };
    try { rec.stop(); } catch (_) { cleanupRec(); res(); }
  });
}
function cleanupRec() {
  clearInterval(REC.tick);
  cancelAnimationFrame(REC.raf);
  REC.stream?.getTracks().forEach((t) => t.stop());
  try { REC.ctx?.close(); } catch (_) {}
  try { REC.wake?.release(); } catch (_) {}
  Object.assign(REC, { stream: null, rec: null, chunks: [], tick: null, wake: null, ctx: null, raf: 0 });
}

function soundSheet() {
  openSheet(`<div class="sheet-head"><h3>Add a sound</h3><button class="text-btn" data-act="sheet-close">Close</button></div>
    <button class="tp-item big" data-act="rec-start">${ic('mic')} Record now</button>
    <button class="tp-item big" data-act="pick-audio">${ic('note')} Choose a sound file</button>
    <p class="hint">From Voice Memos: share the memo, choose “Save to Files”, then pick it here.</p>`);
}

function renderAttachments() {
  const ed = S.editor;
  const box = $('#e-media');
  if (!ed || !box) return;
  const ms = ed.e.media || [];
  box.innerHTML = ms.map((m) => (m.kind === 'image'
    ? `<button class="att img" data-act="att-open" data-id="${m.id}" aria-label="Photo${m.caption ? ': ' + esc(m.caption) : ''}"><img data-media="${m.id}" data-v="thumb" alt=""></button>`
    : `<button class="att aud" data-act="att-open" data-id="${m.id}">${ic('note')}<span><b>${esc(m.caption || m.name || 'Sound')}</b><small>${fmtDur(m.dur) || 'Sound'}</small></span></button>`)).join('');
  box.hidden = !ms.length;
  hydrateMedia(box);
}

function attachmentSheet(id) {
  const ed = S.editor;
  const m = ed?.e.media?.find((x) => x.id === id);
  if (!m) return;
  const isImg = m.kind === 'image';
  openSheet(`<div class="sheet-head"><h3>${isImg ? 'Photo' : 'Sound'}</h3><button class="text-btn" data-act="sheet-close">Done</button></div>
    ${isImg ? `<img class="att-preview" data-media="${m.id}" data-v="data" alt="">` : `<audio class="att-audio" controls preload="metadata" data-media="${m.id}"></audio>`}
    <label class="field"><span>Caption (topic words link here too)</span><input id="att-cap" value="${esc(m.caption)}" placeholder="${isImg ? 'e.g. The old banyan at dawn' : 'e.g. Om chanting by the lake'}" autocomplete="off"></label>
    <button class="btn danger sm" data-act="att-remove" data-id="${m.id}">${ic('trash')} Remove ${isImg ? 'photo' : 'sound'}</button>`);
  hydrateMedia($('#sheet-root'));
  $('#att-cap').addEventListener('input', debounce((ev) => {
    m.caption = ev.target.value.trim();
    ed.commit(true);
    renderAttachments();
    ed.links();
  }, 350));
}

function mediaHtml(e) {
  const ms = e.media || [];
  if (!ms.length) return '';
  const imgs = ms.filter((m) => m.kind === 'image');
  const auds = ms.filter((m) => m.kind === 'audio');
  const single = imgs.length === 1;
  return `<div class="media">
    ${imgs.length ? `<div class="gallery ${single ? 'one' : 'many'}">${imgs.map((m, i) => `<figure>
      <button class="ph" data-act="view-img" data-entry="${e.id}" data-i="${i}" ${single && m.w && m.h ? `style="aspect-ratio:${m.w} / ${m.h}"` : ''} aria-label="Open photo"><img data-media="${m.id}" data-v="${single ? 'data' : 'thumb'}" alt="${esc(m.caption)}"></button>
      ${m.caption ? `<figcaption>${tokHtml(tokenize(m.caption))}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
    ${auds.map((m) => `<div class="sound">${ic('note')}<div class="sound-body"><div class="sound-title">${m.caption ? tokHtml(tokenize(m.caption)) : esc(m.name || 'Sound')}</div><audio controls preload="metadata" data-media="${m.id}"></audio></div></div>`).join('')}
  </div>`;
}

/* Load stored bytes into <img>/<audio> elements marked data-media="id". */
function hydrateMedia(root = document) {
  for (const el of $$('[data-media]', root)) {
    if (el.dataset.ready) continue;
    el.dataset.ready = '1';
    const useThumb = el.dataset.v === 'thumb';
    idb.get('media', el.dataset.media).then((rec) => {
      if (!rec) { (el.closest('figure, .sound, .att') || el).classList.add('missing'); return; }
      const buf = useThumb && rec.thumb ? rec.thumb : rec.data;
      const url = URL.createObjectURL(new Blob([buf], { type: useThumb && rec.thumb ? 'image/jpeg' : rec.type }));
      S.urls.push(url);
      el.src = url;
    }).catch(() => {});
  }
}

/* Full-screen photo viewer: swipe or use the arrows; tap to close. */
function openViewer(entryId, start) {
  const e = S.entries.find((x) => x.id === entryId);
  const imgs = (e?.media || []).filter((m) => m.kind === 'image');
  if (!imgs.length) return;
  let idx = Math.max(0, Math.min(start, imgs.length - 1));
  const root = $('#viewer');
  const draw = () => {
    const m = imgs[idx];
    root.innerHTML = `<div class="vw-top"><span>${imgs.length > 1 ? `${idx + 1} / ${imgs.length}` : ''}</span><button class="icon-btn" data-act="viewer-close" aria-label="Close">${ic('close')}</button></div>
      <div class="vw-stage" data-act="viewer-close"><img data-media="${m.id}" data-v="data" alt="${esc(m.caption)}"></div>
      ${m.caption ? `<p class="vw-cap">${esc(m.caption)}</p>` : ''}
      ${imgs.length > 1 ? `<button class="vw-nav prev" data-act="viewer-prev" aria-label="Previous photo">${ic('back')}</button><button class="vw-nav next" data-act="viewer-next" aria-label="Next photo">${ic('chev')}</button>` : ''}`;
    hydrateMedia(root);
  };
  S.viewer = {
    next: () => { idx = (idx + 1) % imgs.length; draw(); },
    prev: () => { idx = (idx - 1 + imgs.length) % imgs.length; draw(); },
  };
  root.hidden = false;
  draw();
}
function closeViewer() {
  const root = $('#viewer');
  if (!root || root.hidden) return;
  root.hidden = true;
  root.innerHTML = '';
  S.viewer = null;
}

/* ───────── Topics ───────── */
function viewTopics() {
  mount(`<header class="top"><div class="eyebrow">The map of practice</div><h1 class="display">Topics</h1></header>
    <div class="wrap">
      <label class="search">${ic('search')}<input id="tq" type="search" placeholder="Search topics and keywords" value="${esc(S.tq)}" autocomplete="off"></label>
      <div class="seg">
        <button data-act="tsort" data-v="realm" aria-pressed="${S.topicSort === 'realm'}">By theme</button>
        <button data-act="tsort" data-v="woven" aria-pressed="${S.topicSort === 'woven'}">Most woven</button>
      </div>
      <div id="tlist"></div>
      <button class="btn ghost wide" data-act="new-topic" style="margin-top:22px">${ic('plus')} A topic of your own</button>
    </div>`, { tab: 'topics' });
  renderTopicList();
  $('#tq').addEventListener('input', (ev) => { S.tq = ev.target.value; renderTopicList(); });
}

function renderTopicList() {
  const el = $('#tlist');
  if (!el) return;
  const counts = topicCounts();
  const q = S.tq.trim().toLowerCase();
  const match = (t) => !q || t.title.toLowerCase().includes(q) || t.allKeys.some((k) => k.toLowerCase().includes(q)) || (t.gist || '').toLowerCase().includes(q);
  const row = (t, showRealm) => {
    const c = counts.get(t.id) || 0;
    return `<a class="trow r-${t.realm}" href="#/topic/${t.id}"><i class="dot"></i><span class="tname">${esc(t.title)}${showRealm ? `<span class="realm-mini">${esc(REALMS[t.realm].name)}</span>` : ''}</span>${c ? `<span class="count">${c}</span>` : ''}${ic('chev')}</a>`;
  };
  if (S.topicSort === 'woven') {
    const list = TOPIC_LIST.filter((t) => match(t) && counts.get(t.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id));
    el.innerHTML = list.length
      ? `<div class="tlist" style="margin-top:16px">${list.map((t) => row(t, true)).join('')}</div>`
      : `<p class="muted pad center">Nothing woven yet. As you write, the topics your entries touch will gather here, most-visited first.</p>`;
    return;
  }
  const html = REALM_ORDER.map((r) => {
    const its = TOPIC_LIST.filter((t) => t.realm === r && match(t));
    if (!its.length) return '';
    return `<section class="realm r-${r}">
      <div class="realm-head"><i class="dot"></i><h2>${esc(REALMS[r].name)}</h2></div>
      ${q ? '' : `<p class="realm-blurb">${esc(REALMS[r].blurb)}</p>`}
      <div class="tlist" ${q ? 'style="margin-top:10px"' : ''}>${its.map((t) => row(t)).join('')}</div>
    </section>`;
  }).join('');
  el.innerHTML = html || `<p class="muted pad center">No topic matches “${esc(S.tq)}”.</p>`;
}

function refChip([src, page]) {
  const s = sourceById(src);
  if (!s) return '';
  return `<a class="chip ref" href="#/read/${src}/${page}">${ic('book')}${esc(s.name)} p.${page}</a>`;
}
function stepHtml(s) {
  const i = s.indexOf(' — ');
  return i > 0 ? `<li><strong>${esc(s.slice(0, i))}</strong> — ${esc(s.slice(i + 3))}</li>` : `<li>${esc(s)}</li>`;
}

function viewTopic(id) {
  const t = TOPIC_MAP.get(id);
  if (!t) return notFound('#/topics');
  const R = REALMS[t.realm];
  const entries = S.entries.filter((e) => entryTopics(e).has(id)).sort((a, b) => b.createdAt - a.createdAt);
  const related = (t.related || []).map((r) => TOPIC_MAP.get(r)).filter(Boolean);
  const keyChips = (t.builtin ? t.keys : []).map((k) => `<span class="chip key">${esc(k)}</span>`).join('');
  mount(`${bar({ back: '#/topics', right: `<button class="icon-btn" data-act="write-topic" data-id="${id}" aria-label="Write about this">${ic('pen')}</button>` })}
    <article class="wrap topic r-${t.realm}">
      <div class="eyebrow realm-label"><i class="dot"></i>${esc(R.name)}</div>
      <h1 class="title">${esc(t.title)}</h1>
      ${t.gist ? `<p class="lede">${esc(t.gist)}</p>` : ''}
      ${t.steps?.length ? `<h2 class="h-sec">Practice</h2><ol class="steps">${t.steps.map(stepHtml).join('')}</ol>` : ''}
      ${t.notes?.length ? `<h2 class="h-sec">Keep in mind</h2><ul class="notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${t.prompts?.length ? `<h2 class="h-sec">Questions to sit with</h2><div class="prompts">${t.prompts.map((p, i) => `<button class="prompt-row" data-act="write-prompt" data-id="${id}" data-i="${i}"><span>${esc(p)}</span>${ic('pen')}</button>`).join('')}</div>` : ''}
      ${t.refs?.length ? `<h2 class="h-sec">Read in the sources</h2><div class="chips">${t.refs.map(refChip).join('')}</div>` : ''}
      <h2 class="h-sec">In your journal <span class="count">${entries.length}</span></h2>
      ${entries.length ? entries.map((e) => `<a class="card backlink" href="#/entry/${e.id}"><div class="entry-date">${esc(fmtDate(e.createdAt))}</div><div class="bl-title">${esc(e.title || firstLine(e.body) || 'Untitled')}</div><p class="bl-snip">${snippetFor(e, id)}</p></a>`).join('')
        : `<p class="muted small">No entries touch this yet. <a href="#" data-act="write-topic" data-id="${id}" style="color:var(--gold)">Begin one</a>.</p>`}
      ${related.length ? `<h2 class="h-sec">Related</h2><div class="chips">${related.map(chip).join('')}</div>` : ''}
      <h2 class="h-sec">Your notes</h2>
      <textarea id="t-note" class="note" placeholder="Your own understanding, the words of an invocation, questions for the group…">${esc(t.note)}</textarea>
      <h2 class="h-sec">Words that link here</h2>
      ${keyChips ? `<div class="chips">${keyChips}</div>` : ''}
      <label class="field"><span>${t.builtin ? 'Add your own words' : 'Words'} (separate with commas)</span><input id="t-keys" value="${esc(t.extraKeys.join(', '))}" placeholder="e.g. banyan, frangipani" autocomplete="off"></label>
      ${t.builtin ? '' : `
        <h2 class="h-sec">About this topic</h2>
        <label class="field"><span>Name</span><input id="t-title" value="${esc(t.title)}" autocomplete="off"></label>
        <label class="field"><span>Description</span><textarea id="t-gist" rows="3">${esc(t.gist)}</textarea></label>
        <button class="btn danger sm" data-act="del-topic" data-id="${id}" style="margin-top:6px">${ic('trash')} Delete topic</button>`}
    </article>`, { tab: 'topics' });

  const saveNote = debounce((v) => {
    if (t.builtin) { (S.topicEdits[id] ||= {}).note = v; saveKV('topicEdits'); }
    else { const c = S.customTopics.find((x) => x.id === id); if (c) { c.note = v; saveKV('customTopics'); } }
    t.note = v;
  }, 500);
  $('#t-note').addEventListener('input', (ev) => saveNote(ev.target.value));
  $('#t-keys').addEventListener('change', (ev) => {
    const keys = parseKeys(ev.target.value);
    if (t.builtin) { (S.topicEdits[id] ||= {}).keys = keys; saveKV('topicEdits'); }
    else { const c = S.customTopics.find((x) => x.id === id); if (c) { c.keys = keys; saveKV('customTopics'); } }
    rebuildTopics();
    toast('Linking words updated');
  });
  if (!t.builtin) {
    const c = S.customTopics.find((x) => x.id === id);
    $('#t-title').addEventListener('change', (ev) => { const v = ev.target.value.trim(); if (c && v) { c.title = v; saveKV('customTopics'); rebuildTopics(); $('.title').textContent = v; } });
    $('#t-gist').addEventListener('input', debounce((ev) => { if (c) { c.gist = ev.target.value; saveKV('customTopics'); rebuildTopics(); } }, 500));
  }
}

/* ───────── Sources ───────── */
function viewSources() {
  mount(`<header class="top"><div class="eyebrow">Read, then write</div><h1 class="display">Sources</h1></header>
    <div class="wrap">
      <p class="muted intro">Add each PDF once from the Files app. It stays on this phone, and every page link in Within opens right here, even with no signal.</p>
      ${sourcesList().map(sourceCard).join('')}
      <details class="card">
        <summary>${ic('plus')} Add another source</summary>
        <label class="field"><span>Name</span><input id="ns-name" placeholder="e.g. Kingdom of the Gods" autocomplete="off"></label>
        <label class="field"><span>Short code (optional)</span><input id="ns-short" placeholder="e.g. KG" autocomplete="off"></label>
        <button class="btn" data-act="add-source">Choose its PDF…</button>
      </details>
    </div>`, { tab: 'sources' });
}

function sourceCard(s) {
  const meta = S.fileMeta[s.id];
  const mismatch = meta && s.pages && meta.pages && meta.pages !== s.pages;
  return `<section class="card">
    <div class="eyebrow">${esc(s.by || 'Your source')}</div>
    <h2 class="src-title">${esc(s.subtitle || s.name)}</h2>
    <div class="muted small">In your journal, write “${esc(s.name)} p.12”</div>
    <div class="src-status">${meta ? `<span class="pill ok">${ic('check')} On this phone${meta.pages ? ` · ${meta.pages} pages` : ''}</span>` : '<span class="pill">Not added yet</span>'}</div>
    ${mismatch ? `<p class="warn small">This copy has ${meta.pages} pages and the topic notes expect ${s.pages}, so some page links may land nearby rather than exactly.</p>` : ''}
    ${s.note ? `<p class="muted small" style="margin:0 0 10px">${esc(s.note)}</p>` : ''}
    <div class="src-actions">
      ${meta ? `<a class="btn" href="#/read/${s.id}/1">${ic('book')} Open</a>` : ''}
      <button class="btn ${meta ? 'ghost' : ''}" data-act="import-pdf" data-src="${s.id}">${meta ? 'Replace PDF' : 'Add PDF…'}</button>
      ${s.url && !meta ? `<a class="btn ghost" href="${esc(s.url)}" target="_blank" rel="noopener">Get it online</a>` : ''}
      ${s.custom ? `<button class="btn danger sm" data-act="del-source" data-src="${s.id}">Remove</button>` : ''}
    </div>
    ${s.toc?.length ? `<details class="toc"><summary>Contents</summary><ul>${s.toc.map(([title, page, tid]) => `<li><a class="pg-chip" href="#/read/${s.id}/${page}">p.${page}</a>${tid ? `<a class="toc-t" href="#/topic/${tid}">${esc(title)}</a>` : `<span class="toc-t plain">${esc(title)}</span>`}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

async function importPdf(srcId) {
  const f = await pickFile('application/pdf,.pdf');
  if (!f) return false;
  let buf;
  try { buf = await f.arrayBuffer(); } catch { toast('Could not read that file'); return false; }
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
  if (!head.startsWith('%PDF')) { toast('That file doesn’t look like a PDF'); return false; }
  try { await idb.put('files', { name: f.name, size: f.size, data: buf }, srcId); }
  catch (err) { toast('Not enough room to store this PDF'); return false; }
  let pages = null;
  try {
    await ensurePdfjs();
    const d = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    pages = d.numPages;
    d.destroy();
  } catch (_) { /* reader not cached yet; page count unknown */ }
  S.fileMeta[srcId] = { name: f.name, size: f.size, pages, added: Date.now() };
  await saveKV('fileMeta');
  if (RD.src === srcId) { try { RD.doc?.destroy(); } catch (_) {} RD.doc = null; RD.src = null; }
  toast('Added. It’s ready to read offline.');
  router(true);
  return true;
}

/* ───────── Reader (PDF.js, cached for offline) ───────── */
const RD = { doc: null, src: null, token: 0, io: null, zoom: 1, cur: 1, onScroll: null, rec: null, name: '' };
let pdfjsP = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}
function ensurePdfjs() {
  if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions.workerSrc) return Promise.resolve();
  if (!pdfjsP) {
    pdfjsP = (async () => {
      if (!window.pdfjsLib) await loadScript(PDFJS_URL);
      const r = await fetch(PDFJS_WORKER, { mode: 'cors' });
      if (!r.ok) throw new Error('worker ' + r.status);
      const code = await r.text();
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    })().catch((err) => { pdfjsP = null; throw err; });
  }
  return pdfjsP;
}

async function viewReader(src, page) {
  page = Math.max(1, parseInt(page || '1', 10));
  const s = sourceById(src);
  const tok = ++RD.token;
  RD.rec = null;
  mount(`<header class="bar reader-bar">
      <button class="icon-btn" data-back="#/sources" aria-label="Back">${ic('back')}</button>
      <div class="bar-title"><span>${esc(s ? s.name : 'Source')}</span><small id="r-pg">page ${page}</small></div>
      <button class="icon-btn txt" data-act="r-jump" aria-label="Go to page">#</button>
      <button class="icon-btn" data-act="r-zoom" aria-label="Zoom">${ic('zoom')}</button>
      <button class="icon-btn" data-act="r-write" aria-label="Write about this page">${ic('pen')}</button>
    </header>
    <div id="r-body" class="reader"><p class="muted center pad">Opening…</p></div>`, { tab: null, cls: 'reading' });
  S.onLeave = () => { RD.token++; teardownReader(); };
  const body = $('#r-body');
  if (!s) { body.innerHTML = '<p class="muted center pad">This source isn’t known.</p>'; return; }
  RD.name = s.name;

  let rec = null;
  try { rec = await idb.get('files', src); } catch (_) {}
  if (tok !== RD.token) return;
  if (!rec) {
    body.innerHTML = `<div class="wrap pad center"><p>${esc(s.subtitle || s.name)} isn’t on this phone yet.</p>
      <button class="btn" data-act="import-pdf" data-src="${src}">Add the PDF…</button>
      <p class="muted small">Then page ${page} will open here.</p>
      ${s.url ? `<p class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--gold)">Download it while online</a></p>` : ''}</div>`;
    return;
  }
  RD.rec = rec;
  try { await ensurePdfjs(); }
  catch (_) {
    if (tok !== RD.token) return;
    body.innerHTML = `<div class="wrap pad center"><p>The page viewer isn’t stored on this phone yet.</p>
      <p class="muted small">Open Within once while connected to the internet so it can keep the viewer for offline use. Until then you can open the PDF in another app.</p>
      <button class="btn ghost" data-act="r-share">${ic('share')} Open in another app</button></div>`;
    return;
  }
  if (tok !== RD.token) return;
  try {
    if (RD.src !== src || !RD.doc) {
      try { RD.doc?.destroy(); } catch (_) {}
      RD.doc = null;
      RD.doc = await pdfjsLib.getDocument({ data: new Uint8Array(rec.data.slice(0)), isEvalSupported: false }).promise;
      RD.src = src;
    }
  } catch (err) {
    console.error(err);
    if (tok === RD.token) body.innerHTML = '<p class="muted center pad">This PDF couldn’t be opened.</p>';
    return;
  }
  if (tok !== RD.token) return;
  const doc = RD.doc, n = doc.numPages;
  page = Math.min(page, n);
  const v = (await doc.getPage(1)).getViewport({ scale: 1 });
  if (tok !== RD.token) return;
  body.style.setProperty('--z', RD.zoom);
  body.innerHTML = `<div class="pages">${Array.from({ length: n }, (_, i) => `<div class="pg" id="pg-${i + 1}" data-n="${i + 1}" style="aspect-ratio:${v.width} / ${v.height}"><span class="pgn">${i + 1}</span></div>`).join('')}</div>`;
  RD.io = new IntersectionObserver((list) => {
    for (const en of list) { if (en.isIntersecting) renderPage(en.target, tok); else unrenderPage(en.target); }
  }, { rootMargin: '1400px 0px' });
  for (const el of $$('.pg', body)) RD.io.observe(el);
  RD.cur = page;
  $('#pg-' + page)?.scrollIntoView({ block: 'start' });
  updatePageLabel(n);
  RD.onScroll = rafThrottle(() => trackPage(n));
  window.addEventListener('scroll', RD.onScroll, { passive: true });
}

function trackPage(n) {
  const line = window.innerHeight * 0.35;
  for (const el of $$('.pg')) {
    const r = el.getBoundingClientRect();
    if (r.top <= line && r.bottom > line) { const p = +el.dataset.n; if (p !== RD.cur) { RD.cur = p; updatePageLabel(n); } return; }
  }
}
function updatePageLabel(n) {
  const l = $('#r-pg');
  if (l) l.textContent = `page ${RD.cur} of ${n}`;
  if (RD.src) history.replaceState(null, '', `#/read/${RD.src}/${RD.cur}`), (S.curHash = location.hash);
}
async function renderPage(el, tok) {
  if (el.dataset.st) return;
  el.dataset.st = 'busy';
  try {
    const page = await RD.doc.getPage(+el.dataset.n);
    if (tok !== RD.token || el.dataset.st !== 'busy') return;
    const base = page.getViewport({ scale: 1 });
    el.style.aspectRatio = `${base.width} / ${base.height}`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = page.getViewport({ scale: (el.clientWidth * dpr) / base.width });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const task = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
    el._task = task;
    await task.promise;
    el._task = null;
    if (tok !== RD.token || el.dataset.st !== 'busy') { freeCanvas(c); return; }
    const old = el.querySelector('canvas');
    if (old) freeCanvas(old);
    el.appendChild(c);
    el.dataset.st = 'done';
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.warn(err);
    if (el.dataset.st === 'busy') el.dataset.st = '';
  }
}
function unrenderPage(el) {
  if (!el.dataset.st) return;
  try { el._task?.cancel(); } catch (_) {}
  const c = el.querySelector('canvas');
  if (c) freeCanvas(c);
  el.dataset.st = '';
}
function freeCanvas(c) { c.width = 0; c.height = 0; c.remove(); }
function teardownReader() {
  RD.io?.disconnect(); RD.io = null;
  if (RD.onScroll) window.removeEventListener('scroll', RD.onScroll);
  RD.onScroll = null;
  for (const c of $$('.pg canvas')) freeCanvas(c);
}
function scrollToPage(p) {
  const el = $('#pg-' + p);
  if (el) { el.scrollIntoView({ block: 'start' }); RD.cur = p; updatePageLabel($$('.pg').length); }
}

/* ───────── More ───────── */
function viewMore() {
  const pdfCount = Object.keys(S.fileMeta).length;
  mount(`<header class="top"><div class="eyebrow">Care &amp; settings</div><h1 class="display">More</h1></header>
    <div class="wrap">
      ${isStandalone() ? '' : `<section class="card install">
        <h2 class="h-card">Keep Within on your iPhone</h2>
        <ol>
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap the Share button <span class="share-glyph">${ic('share')}</span>, then <b>Add to Home Screen</b>.</li>
          <li>Open <b>Within</b> from your Home Screen once while online. From then on it works without internet.</li>
        </ol>
      </section>`}
      <section class="card">
        <h2 class="h-card">Offline</h2>
        <div id="offline-status" class="muted">Checking…</div>
      </section>
      <section class="card">
        <h2 class="h-card">Backup</h2>
        <p class="muted small" style="margin-top:0">Your journal, photos and sounds live only on this phone. Now and then, save a backup to Files. You can restore it here or on another device.${hasAnyMedia() ? ' The backup is a .zip that includes your photos and sounds; it also opens on a computer.' : ''}</p>
        <div class="row">
          <button class="btn" data-act="export">${ic('share')} Save backup</button>
          <button class="btn ghost" data-act="import">${ic('download')} Restore…</button>
        </div>
        <button class="btn ghost wide" data-act="export-md">Export journal as readable text</button>
        ${hasAnyMedia() ? '<button class="btn ghost wide" data-act="export-text">Small backup without photos &amp; sounds</button>' : ''}
      </section>
      <section class="card">
        <h2 class="h-card">Linking</h2>
        <label class="switch"><input type="checkbox" id="autolink" ${S.settings.autolink ? 'checked' : ''}><span>Link topic words automatically</span></label>
        <p class="muted small" style="margin-bottom:0">When this is off, only <code>[[double-bracket]]</code> links and source pages are linked.</p>
      </section>
      <section class="card">
        <h2 class="h-card">Appearance</h2>
        <div class="seg">${[['auto', 'Match phone'], ['dark', 'Night'], ['light', 'Day']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${S.settings.theme === v}">${l}</button>`).join('')}</div>
      </section>
      <section class="card">
        <h2 class="h-card">About</h2>
        <div class="stats">
          <div><b>${S.entries.length}</b><span>entries</span></div>
          <div><b>${TOPIC_LIST.length}</b><span>topics</span></div>
          <div><b>${pdfCount}</b><span>PDFs here</span></div>
          <div><b id="used">…</b><span>stored</span></div>
        </div>
        <p class="muted small">The topic pages are paraphrased study notes from the Retreat Guidebook, the Cooperation with the Angels master document, and Dora van Gelder Kunz’s <i>The Christmas of the Angels</i>. Read the sources for the full teaching.</p>
        <p class="muted small" style="margin-bottom:0">Nothing you write leaves this phone. Within ${APP_VERSION}.</p>
      </section>
    </div>`, { tab: 'more' });
  $('#autolink').addEventListener('change', (ev) => { S.settings.autolink = ev.target.checked; saveKV('settings'); S.ver++; toast(ev.target.checked ? 'Topic words will link automatically' : 'Only [[ ]] links from now on'); });
  checkOffline();
  S.preparedBackup = null;
  navigator.storage?.estimate?.().then((est) => { const el = $('#used'); if (el) el.textContent = fmtSize(est.usage || 0).replace(' ', ' '); }).catch(() => { const el = $('#used'); if (el) el.textContent = '–'; });
}

async function checkOffline() {
  const el = $('#offline-status');
  if (!el) return;
  const line = (ok, text) => `<div class="status-line">${ok ? ic('check') : '<span style="width:19px;flex:none;text-align:center">·</span>'}<span>${text}</span></div>`;
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') { el.innerHTML = line(false, 'Offline mode needs the app to be opened from its web address, then added to the Home Screen.'); return; }
  let reg = null, pdf = false;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch (_) {}
  try { pdf = !!(await caches.match(PDFJS_URL)) && !!(await caches.match(PDFJS_WORKER)); } catch (_) {}
  const ready = !!navigator.serviceWorker.controller;
  el.innerHTML = [
    ready ? line(true, 'The app is stored on this phone and opens without internet.') : line(false, reg ? 'Almost ready. Close and reopen Within once.' : 'Not stored yet. Add it to the Home Screen, then open it once while online.'),
    pdf ? line(true, 'The PDF page viewer is stored too.') : line(false, 'The PDF page viewer will be stored the next time Within is opened online.'),
    line(true, `${S.entries.length} ${S.entries.length === 1 ? 'entry' : 'entries'} saved on this device.`),
  ].join('');
}

function shareOrDownload(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title }).catch((err) => { if (err.name !== 'AbortError') downloadFile(file); });
    return;
  }
  downloadFile(file);
}
function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function backupData() {
  return {
    app: 'within', kind: 'backup', version: 2, exportedAt: new Date().toISOString(),
    entries: S.entries.map(({ id, title, body, createdAt, updatedAt, media }) => ({ id, title, body, createdAt, updatedAt, media: media || [] })),
    topicEdits: S.topicEdits, customTopics: S.customTopics, customSources: S.customSources, settings: S.settings,
  };
}
function exportBackup() {
  shareOrDownload(new File([JSON.stringify(backupData(), null, 1)], `within-backup-${today()}.json`, { type: 'application/json' }), 'Within backup');
}
function journalMarkdown(withFiles) {
  const lines = ['# Within — journal', ''];
  for (const e of [...S.entries].sort((a, b) => a.createdAt - b.createdAt)) {
    lines.push(`## ${entryTitle(e)}`, `*${fmtDate(e.createdAt)}*`, '');
    for (const m of e.media || []) {
      const label = m.caption || (m.kind === 'image' ? 'Photo' : (m.name || 'Sound'));
      if (withFiles) lines.push(m.kind === 'image' ? `![${label}](media/${m.id}.${extFor(m)})` : `[🔊 ${label}](media/${m.id}.${extFor(m)})`, '');
      else lines.push(`*[${m.kind === 'image' ? 'Photo' : 'Sound'}${m.caption ? ': ' + m.caption : ''}]*`, '');
    }
    lines.push(e.body || '', '');
    const names = [...entryTopics(e)].map((i) => TOPIC_MAP.get(i)?.title).filter(Boolean);
    if (names.length) lines.push(`Woven with: ${names.join(' · ')}`, '');
    lines.push('---', '');
  }
  return lines.join('\n');
}
function exportMarkdown() {
  shareOrDownload(new File([journalMarkdown(false)], `within-journal-${today()}.md`, { type: 'text/markdown' }), 'Within journal');
}

/* A full backup is a plain .zip: backup.json, journal.md (readable on a computer, photos included)
   and media/<id>.<ext>. Files are stored uncompressed: photos and sounds are already compressed. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0, cdSize = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    cdSize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const index = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip');
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    index.set(dec.decode(new Uint8Array(cd.buffer, p + 46, nlen)), { method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), lho: cd.getUint32(p + 42, true) });
    p += 46 + nlen + xlen + clen;
  }
  return {
    async get(name) {
      const en = index.get(name);
      if (!en) return null;
      const lh = new DataView(await blob.slice(en.lho, en.lho + 30).arrayBuffer());
      const start = en.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const part = blob.slice(start, start + en.csize);
      if (en.method === 0) return part.arrayBuffer();
      if (en.method === 8 && 'DecompressionStream' in window) return new Response(part.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      throw new Error('unsupported zip');
    },
  };
}
async function prepareFullBackup(btn) {
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const enc = new TextEncoder();
    const files = [
      { name: 'backup.json', data: enc.encode(JSON.stringify(backupData(), null, 1)) },
      { name: 'journal.md', data: enc.encode(journalMarkdown(true)) },
    ];
    for (const e of S.entries) {
      for (const m of e.media || []) {
        const rec = await idb.get('media', m.id);
        if (rec) files.push({ name: `media/${m.id}.${extFor(m)}`, data: new Uint8Array(rec.data) });
      }
    }
    const blob = makeZip(files);
    S.preparedBackup = new File([blob], `within-backup-${today()}.zip`, { type: 'application/zip' });
    btn.disabled = false;
    btn.dataset.act = 'export-ready';
    btn.innerHTML = `${ic('share')} Save backup · ${fmtSize(blob.size)}`;
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.innerHTML = `${ic('share')} Save backup`;
    toast('The backup couldn’t be prepared');
  }
}

async function importBackup() {
  const f = await pickFile('.json,.zip,application/json,application/zip');
  if (!f) return;
  let data, zip = null;
  try {
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) {
      zip = await readZip(f);
      const b = await zip.get('backup.json');
      if (!b) throw new Error('no backup.json');
      data = JSON.parse(new TextDecoder().decode(b));
    } else {
      data = JSON.parse(await f.text());
    }
  } catch (_) { toast('That file couldn’t be read'); return; }
  if (!data || data.app !== 'within' || !Array.isArray(data.entries)) { toast('That isn’t a Within backup'); return; }
  toast('Restoring…');
  let added = 0, updated = 0, media = 0;
  if (zip) {
    for (const e of data.entries) {
      for (const m of e?.media || []) {
        if (!m?.id || await idb.has('media', m.id)) continue;
        let buf = null;
        try { buf = await zip.get(`media/${m.id}.${extFor(m)}`); } catch (_) {}
        if (!buf) continue;
        let thumb;
        if (m.kind === 'image') { try { thumb = await thumbFrom(buf, m.type); } catch (_) {} }
        await idb.put('media', { id: m.id, type: m.type, data: buf, thumb });
        media++;
      }
    }
  }
  for (const e of data.entries) {
    if (!e || !e.id || typeof e.body !== 'string') continue;
    const cur = S.entries.find((x) => x.id === e.id);
    if (!cur) { S.entries.push({ ...e }); await idb.put('entries', e); added++; }
    else if ((e.updatedAt || 0) > (cur.updatedAt || 0)) { Object.assign(cur, e); await idb.put('entries', cur); updated++; }
  }
  for (const [id, ed] of Object.entries(data.topicEdits || {})) {
    const cur = (S.topicEdits[id] ||= {});
    cur.keys = [...new Set([...(cur.keys || []), ...(ed.keys || [])])];
    if (!cur.note && ed.note) cur.note = ed.note;
  }
  for (const t of (data.customTopics || [])) if (t?.id && !S.customTopics.some((x) => x.id === t.id)) S.customTopics.push(t);
  for (const s of (data.customSources || [])) if (s?.id && !S.customSources.some((x) => x.id === s.id)) S.customSources.push(s);
  await Promise.all([saveKV('topicEdits'), saveKV('customTopics'), saveKV('customSources')]);
  rebuildTopics();
  toast(`Restored: ${added} new, ${updated} updated${media ? `, ${media} photos & sounds` : ''}`);
  router(true);
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

let toastT;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ───────── actions ───────── */
const ACTIONS = {
  'new': () => newEntry(''),
  'prompt-next': () => { S.prompt = randomPrompt(S.prompt); const c = $('.prompt'); if (c) c.outerHTML = promptCard(); },
  'prompt-write': () => { const p = S.prompt; const t = p && TOPIC_MAP.get(p.id); if (t) newEntry(`[[${t.title}]]\n> ${p.p}\n\n`); },
  'dismiss-install': () => { S.settings.installDismissed = true; saveKV('settings'); $('.nudge')?.remove(); },
  'edit': (el) => go(`#/edit/${el.dataset.id}`),
  'delete-entry': async (el) => {
    if (!confirm('Delete this entry? This can’t be undone.')) return;
    const id = el.dataset.id;
    const gone = S.entries.find((x) => x.id === id);
    for (const m of gone?.media || []) idb.del('media', m.id).catch(() => {});
    S.entries = S.entries.filter((x) => x.id !== id);
    await idb.del('entries', id).catch(() => {});
    toast('Entry deleted');
    back('#/journal');
  },
  'edit-done': () => {
    const ed = S.editor;
    if (!ed) return back('#/journal');
    const empty = !ed.ti.value.trim() && !ed.ta.value.trim();
    const id = ed.e.id;
    if (empty) { back('#/journal'); return; }
    if (S.prevHash === `#/entry/${id}` && S.navDepth > 0) history.back();
    else go(`#/entry/${id}`, { replace: true });
  },
  'ins-link': () => {
    const ed = S.editor; if (!ed) return;
    ed.sel = [ed.ta.selectionStart, ed.ta.selectionEnd];
    topicPicker((id) => { const t = TOPIC_MAP.get(id); if (t) insertAtCursor(`[[${t.title}]]`); });
  },
  'ins-prompt': () => {
    const ed = S.editor; if (!ed) return;
    if (!$('#sheet-root').classList.contains('open')) ed.sel = [ed.ta.selectionStart, ed.ta.selectionEnd];
    promptPicker();
  },
  'ins-ref': () => {
    const ed = S.editor; if (!ed) return;
    ed.sel = [ed.ta.selectionStart, ed.ta.selectionEnd];
    refPicker();
  },
  'sheet-close': () => closeSheet(),
  'write-topic': (el) => { const t = TOPIC_MAP.get(el.dataset.id); if (t) newEntry(`[[${t.title}]]\n\n`); },
  'write-prompt': (el) => { const t = TOPIC_MAP.get(el.dataset.id); if (t) newEntry(`[[${t.title}]]\n> ${t.prompts[+el.dataset.i]}\n\n`); },
  'tsort': (el) => { S.topicSort = el.dataset.v; for (const b of $$('.seg button')) b.setAttribute('aria-pressed', b.dataset.v === S.topicSort); renderTopicList(); },
  'new-topic': () => newTopicSheet(''),
  'new-topic-from': (el) => newTopicSheet(el.dataset.title || ''),
  'create-topic': (el) => {
    const title = $('#nt-title')?.value.trim();
    if (!title) { toast('Give the topic a name'); return; }
    const id = createTopic(title, parseKeys($('#nt-keys')?.value), $('#nt-gist')?.value.trim() || '');
    const insert = el.dataset.insert === '1';
    closeSheet();
    if (insert && S.editor) { insertAtCursor(`[[${title}]]`); return; }
    if (S.editor) { S.editor.ta.dispatchEvent(new Event('input')); toast('Topic created'); return; }
    if (id) go(`#/topic/${id}`);
  },
  'del-topic': async (el) => {
    if (!confirm('Delete this topic? Your entries stay; they just won’t link to it.')) return;
    S.customTopics = S.customTopics.filter((x) => x.id !== el.dataset.id);
    await saveKV('customTopics');
    rebuildTopics();
    toast('Topic deleted');
    back('#/topics');
  },
  'import-pdf': (el) => { importPdf(el.dataset.src); },
  'add-source': () => {
    const name = $('#ns-name')?.value.trim();
    if (!name) { toast('Give the source a name first'); return; }
    const short = $('#ns-short')?.value.trim();
    const s = { id: 'u' + uid(), name, short: short || '', aliases: [name, short].filter(Boolean), by: 'Your source' };
    S.customSources.push(s);
    rebuildRefs();
    importPdf(s.id).then((ok) => {
      if (ok) { saveKV('customSources'); rebuildTopics(); }
      else { S.customSources = S.customSources.filter((x) => x !== s); rebuildRefs(); }
    });
  },
  'del-source': async (el) => {
    if (!confirm('Remove this source and its PDF from the phone?')) return;
    const id = el.dataset.src;
    S.customSources = S.customSources.filter((x) => x.id !== id);
    delete S.fileMeta[id];
    await Promise.all([saveKV('customSources'), saveKV('fileMeta'), idb.del('files', id).catch(() => {})]);
    rebuildTopics();
    router(true);
  },
  'r-zoom': () => {
    RD.zoom = RD.zoom === 1 ? 1.8 : 1;
    const body = $('#r-body');
    if (!body || !RD.io) return;
    body.style.setProperty('--z', RD.zoom);
    const keep = RD.cur;
    for (const el of $$('.pg', body)) { unrenderPage(el); RD.io.unobserve(el); RD.io.observe(el); }
    scrollToPage(keep);
  },
  'r-jump': () => {
    const n = $$('.pg').length;
    if (!n) return;
    const v = parseInt(prompt(`Go to page (1–${n})`, String(RD.cur)) || '', 10);
    if (v >= 1 && v <= n) scrollToPage(v);
  },
  'r-write': () => { if (RD.name) newEntry(`${RD.name} p.${RD.cur} — `); },
  'r-share': () => {
    const rec = RD.rec;
    if (!rec) return;
    shareOrDownload(new File([rec.data], rec.name || 'source.pdf', { type: 'application/pdf' }), rec.name || 'PDF');
  },
  'add-photo': () => { if (S.editor) pickFiles('image/*', true).then(addImages); },
  'add-sound': () => { if (S.editor) soundSheet(); },
  'pick-audio': () => { closeSheet(); pickFile('audio/*,.m4a,.mp3,.wav,.aac,.aif,.aiff,.caf,.ogg,.flac').then(addAudioFile); },
  'rec-start': () => recordSheet(),
  'rec-stop': () => { const b = $('#rec-stop'); if (b) b.disabled = true; stopRecording(true).then(closeSheet); },
  'rec-cancel': () => {
    if (REC.rec && Date.now() - REC.t0 > 3000 && !confirm('Discard this recording?')) return;
    stopRecording(false).then(closeSheet);
  },
  'att-open': (el) => attachmentSheet(el.dataset.id),
  'att-remove': async (el) => {
    const ed = S.editor;
    if (!ed) return;
    const m = ed.e.media?.find((x) => x.id === el.dataset.id);
    if (!m || !confirm(`Remove this ${m.kind === 'image' ? 'photo' : 'sound'} from the entry?`)) return;
    ed.e.media = ed.e.media.filter((x) => x !== m);
    closeSheet();
    await idb.del('media', m.id).catch(() => {});
    await ed.commit(true);
    renderAttachments();
    ed.links();
  },
  'view-img': (el) => openViewer(el.dataset.entry, +el.dataset.i),
  'viewer-close': () => closeViewer(),
  'viewer-next': () => S.viewer?.next(),
  'viewer-prev': () => S.viewer?.prev(),
  'export': (el) => { if (hasAnyMedia()) prepareFullBackup(el); else exportBackup(); },
  'export-ready': () => { if (S.preparedBackup) shareOrDownload(S.preparedBackup, 'Within backup'); },
  'export-text': () => exportBackup(),
  'export-md': () => exportMarkdown(),
  'import': () => { importBackup(); },
  'theme': (el) => { S.settings.theme = el.dataset.v; saveKV('settings'); applyTheme(); for (const b of $$('.seg button')) b.setAttribute('aria-pressed', b.dataset.v === S.settings.theme); },
};

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href^="#/"]');
  if (a) { ev.preventDefault(); go(a.getAttribute('href')); return; }
  const b = ev.target.closest('[data-back]');
  if (b) { back(b.dataset.back); return; }
  const pick = ev.target.closest('[data-pick]');
  if (pick) { const f = S.sheetPick; closeSheet(); f?.(pick.dataset.pick); return; }
  const pickNew = ev.target.closest('[data-pick-new]');
  if (pickNew) { const title = pickNew.dataset.pickNew; closeSheet(); if (S.editor) newTopicSheet(title, true); else newTopicSheet(title); return; }
  const pr = ev.target.closest('[data-prompt]');
  if (pr) {
    const p = pr.dataset.prompt;
    closeSheet();
    const ed = S.editor;
    if (!ed) return;
    const at = ed.sel ? ed.sel[0] : ed.ta.value.length;
    const lead = at > 0 && ed.ta.value[at - 1] !== '\n' ? '\n' : '';
    insertAtCursor(`${lead}> ${p}\n`);
    return;
  }
  const rs = ev.target.closest('[data-ref-src]');
  if (rs) {
    const s = sourceById(rs.dataset.refSrc);
    const page = parseInt($('#ref-page')?.value || '', 10);
    if (!page || page < 1) { toast('Enter a page number first'); $('#ref-page')?.focus(); return; }
    closeSheet();
    if (s) insertAtCursor(`${s.name} p.${page}`);
    return;
  }
  const act = ev.target.closest('[data-act]');
  if (!act) return;
  const fn = ACTIONS[act.dataset.act];
  if (fn) { ev.preventDefault(); fn(act, ev); }
});
document.addEventListener('keydown', (ev) => {
  if (S.viewer) {
    if (ev.key === 'Escape') closeViewer();
    else if (ev.key === 'ArrowRight') S.viewer.next();
    else if (ev.key === 'ArrowLeft') S.viewer.prev();
    return;
  }
  if (ev.key === 'Escape' && !REC.rec) closeSheet();
});

/* Swipe between photos in the viewer. */
let swipeX = null;
document.addEventListener('touchstart', (ev) => { swipeX = S.viewer && ev.touches.length === 1 ? ev.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', (ev) => {
  if (swipeX === null || !S.viewer) return;
  const dx = ev.changedTouches[0].clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 50) { ev.preventDefault(); (dx < 0 ? S.viewer.next : S.viewer.prev)(); }
});

/* Save the open entry (and any recording in progress) if the app is sent to the background. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (REC.rec && REC.rec.state === 'recording') stopRecording(true).then(closeSheet);
  if (S.editor) S.editor.commit();
});
window.addEventListener('pagehide', () => { if (S.editor) S.editor.commit(); });

/* ───────── start ───────── */
(async function start() {
  await load();
  applyTheme();
  rebuildTopics();
  if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/journal');
  router(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
  }
})();
