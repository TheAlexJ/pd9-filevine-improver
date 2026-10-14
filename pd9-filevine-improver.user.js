// ==UserScript==
// @name         PD9 Filevine Mobile
// @namespace    https://filevine.local/pd9-mobile
// @version      0.2.4
// @description  iPhone-friendly Filevine for PD9: your cases as cards grouped by court date, and big Note and Task buttons on every case.
// @author       Alex Johnson
// @match        https://*.filevinegov.com/*
// @match        https://*.filevine.com/*
// @match        https://*.filevineapp.com/*
// @updateURL    https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-mobile.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

// For iPhone (Safari with Tampermonkey). Install this one on your phone instead of
// the desktop PD9 Filevine Improver. It only switches on for phone-sized touch
// screens, so it stays out of the way on a computer.
//
// What it does:
//   - Project Hub: your cases as cards, grouped by the next court date
//     (Today, Tomorrow, This week, Later, No court date), with search and pins.
//   - Cases open on the Activity tab.
//   - On a case: a bar at the bottom with big Cases, Note and Task buttons.
//
// It reads the same things the Project Hub and Calendar pages read, with your own
// login, and saves nothing except your pins and settings on this phone.

(function () {
  'use strict';
  try { if (window.top !== window.self) return; } catch (e) { return; }

  // A touch screen that's phone-sized (the screen itself, not the page, which can be wider).
  const isPhone = () => window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 820;
  if (!isPhone()) return;

  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '0.2.3';

  // ---------- small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const htmlToText = (h) => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent || '';
  const visible = (el) => !!(el && el.getClientRects().length);
  const store = {
    get(k, d) { try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) { /* fall back */ } try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* fall back */ } try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  async function waitFor(fn, ms = 8000, every = 120) {
    const end = Date.now() + ms;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(every);
    }
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'pm-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  const onHub = () => /#\/projecthub/i.test(location.href);
  const projectId = () => (location.hash.match(/#\/project\/(\d+)/) || [])[1] || null;
  // Cases open in this same tab. Filevine is already loaded, so switching is just a
  // change of address (no reload), and Cases comes straight back to the list.
  function openCase(id) {
    const list = document.querySelector('#pm-cases .pm-scroll');
    if (list) state.scrollTop = list.scrollTop; // come back to the same spot
    location.hash = `#/project/${encodeURIComponent(id)}/activity`;
  }

  // Make sure the page is laid out for the phone and can reach under the notch and home bar.
  (function themeColor() {
    const set = () => {
      let m = $('meta[name="theme-color"][data-pm]');
      if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; m.dataset.pm = ''; document.head.appendChild(m); }
      m.content = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#0f1216' : '#f2f4f7';
    };
    set();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', set);
  }());
  (function viewport() {
    let m = $('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
  }());

  // =====================================================================
  // Data: the same requests the Project Hub and Calendar pages make
  // =====================================================================
  const PARAMS_KEY = 'pm-hub-params';
  const PIN_KEY = 'pd9-hub-pins';
  const pins = () => new Set((store.get(PIN_KEY, []) || []).map(String));
  function togglePin(id) {
    const p = pins();
    if (p.has(String(id))) p.delete(String(id)); else p.add(String(id));
    store.set(PIN_KEY, [...p]);
  }

  // The Project Hub's own filters, from its address (like "My Projects"). Remembered,
  // so the card list shows the same cases next time.
  function hubParams() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const num = (k) => (q.get(k) && !isNaN(+q.get(k)) ? +q.get(k) : null);
    const list = (k) => q.getAll(k).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    const p = {
      query: '',
      orgID: num('org') || num('orgID'),
      includeArchived: false,
      filterByPhaseID: num('phase') || num('phaseID'),
      filterByPhaseNames: list('phaseNames'),
      filterByFirstPrimaryUserID: num('primary'),
      filterByIsPrimary: q.get('isPrimary') === 'true',
      filterByIsPinned: false,
      filterByIsFollowing: q.get('following') === 'true',
      filterByProjectTypeID: num('type') || num('projectType'),
      filterByHashtags: list('hashtags'),
      filterByRoles: list('roles'),
      filterByMinimumAccessLevel: 0,
      includeAggregateCounts: false,
      sort: 'ProjectName',
      direction: 'Ascending',
    };
    const narrowed = p.filterByFirstPrimaryUserID || p.filterByIsPrimary || p.filterByIsFollowing || p.filterByRoles.length;
    if (narrowed && p.orgID) { store.set(PARAMS_KEY, p); return p; }
    const saved = store.get(PARAMS_KEY, null);
    if (saved) return saved;
    return { ...p, filterByIsPrimary: true }; // nothing chosen yet: cases where you're primary
  }

  async function loadCases() {
    const base = hubParams();
    const hits = [];
    for (let skip = 0; skip < 1000; skip += 200) {
      const res = await fetch('/api/projectHub/search', {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, skip, take: 200 }),
      });
      if (!res.ok) throw new Error(`Filevine answered ${res.status}`);
      const json = await res.json();
      const data = json && json.data;
      if (!data || !Array.isArray(data.hits)) throw new Error('Filevine sent an unexpected reply');
      hits.push(...data.hits);
      if (!data.hasMore || !data.hits.length) break;
    }
    return hits.map((h) => {
      const parts = String(h.projectName || '').split('|');
      const client = htmlToText(h.clientName || parts[0]).trim();
      return {
        id: String(h.projectID || h.id),
        orgID: h.orgID,
        clientID: h.clientID,
        caseNo: (parts[1] || h.number || '').trim(),
        name: guessLastFirst(client),
        nameSure: false,
        lastActivity: h.lastActivity ? new Date(h.lastActivity) : null,
        tags: (h.tagsV2 && h.tagsV2.length ? h.tagsV2.filter((t) => !t.isArchived).map((t) => ({ name: t.name, color: t.colorNumber }))
          : (h.hashtags || []).map((t) => ({ name: t, color: null })))
          .map((t) => ({ name: String(t.name).replace(/^#/, ''), color: t.color })),
      };
    });
  }

  // "John Henry Doe" -> "Doe, John Henry" until the real name fields arrive.
  function guessLastFirst(full) {
    const s = String(full || '').replace(/\s+/g, ' ').trim();
    if (!s || s.includes(',')) return s;
    const w = s.split(' ');
    return w.length < 2 ? s : `${w[w.length - 1]}, ${w.slice(0, -1).join(' ')}`;
  }

  // The client's real first and last name, from their contact card.
  const nameCache = new Map();
  async function loadName(c) {
    if (!c.clientID || !c.orgID) return null;
    if (nameCache.has(c.clientID)) return nameCache.get(c.clientID);
    try {
      const res = await fetch(`/api/v2/org/${encodeURIComponent(c.orgID)}/project/${encodeURIComponent(c.id)}/person/${encodeURIComponent(c.clientID)}`,
        { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const json = await res.json();
      const p = (function find(v, d) {
        if (!v || typeof v !== 'object' || d > 6) return null;
        if (!Array.isArray(v) && 'lastName' in v) return v;
        for (const x of Object.values(v)) { const r = find(x, d + 1); if (r) return r; }
        return null;
      }(json, 0));
      const last = p && String(p.lastName || '').trim();
      const first = p && String(p.firstName || '').trim();
      const name = last ? (first ? `${last}, ${first}` : last) : null;
      nameCache.set(c.clientID, name);
      return name;
    } catch (e) { return null; }
  }

  // Next court date per case: the calendar, in 42-day pieces (Filevine's limit), 120 days out.
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isDateText = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
  const firstKey = (o, names) => names.find((k) => o && o[k] != null && o[k] !== '');
  // The biggest list of objects that carry a date (same reader as the desktop Improver).
  function findEvents(json) {
    let best = [];
    (function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (Array.isArray(v)) {
        const rows = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).some(isDateText));
        if (rows.length > best.length) best = rows;
        v.forEach((x) => walk(x, depth + 1));
        return;
      }
      Object.values(v).forEach((x) => walk(x, depth + 1));
    }(json, 0));
    return best;
  }
  function readEvent(ev) {
    const dateKey = firstKey(ev, ['start', 'startDate', 'startDateTime', 'startTime', 'eventDate', 'date', 'dueDate', 'deadlineDate'])
      || Object.keys(ev).find((k) => isDateText(ev[k]) && !/created|modified|updated|end/i.test(k));
    const proj = ev.project && typeof ev.project === 'object' ? ev.project : null;
    const pidKey = Object.keys(ev).find((k) => /^project_?id$/i.test(k) || /^projectid\d*$/i.test(k));
    const pid = (pidKey && ev[pidKey]) || (proj && (proj.id || proj.projectId || proj.projectID)) || null;
    const title = ev[firstKey(ev, ['title', 'name', 'subject', 'summary', 'eventTitle', 'eventName', 'description'])] || '';
    const allDay = !!(ev.allDay || ev.isAllDay || ev.allDayEvent);
    const raw = dateKey ? String(ev[dateKey]) : '';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) || (allDay && /T00:00:00/.test(raw));
    return {
      projectId: pid ? String(pid) : null,
      when: dateOnly ? new Date(`${raw.slice(0, 10)}T00:00:00`) : new Date(raw),
      dateOnly,
      title: htmlToText(title).replace(/\s+for\b[\s\S]*$/i, '').trim(),
      location: htmlToText(ev.location || ''),
    };
  }
  async function loadEvents() {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const urls = [];
    for (let s = 0; s < 120; s += 42) {
      const a = new Date(from); a.setDate(a.getDate() + s);
      const b = new Date(from); b.setDate(b.getDate() + Math.min(s + 42, 120));
      urls.push(`/api/calendar/displayableevents/${ymd(a)}/${ymd(b)}?timezoneOffset=${new Date().getTimezoneOffset()}`);
    }
    const replies = await Promise.all(urls.map((u) => fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const seen = new Set();
    const events = replies.filter(Boolean).flatMap((j) => findEvents(j)).filter((ev) => {
      const id = ev.id || ev.eventId || ev.uniqueId || JSON.stringify(ev);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(readEvent).filter((e) => e.projectId && !isNaN(e.when) && e.when >= from);
    const byCase = new Map();
    events.sort((a, b) => a.when - b.when).forEach((e) => { if (!byCase.has(e.projectId)) byCase.set(e.projectId, e); });
    return byCase;
  }

  // =====================================================================
  // The card list (shown over the Project Hub)
  // =====================================================================
  const state = { scrollTop: 0, cases: null, events: null, loading: false, error: '', filter: store.get('pm-filter', 'upcoming'), query: '', loadedAt: 0 };

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysAway = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function groupOf(c) {
    const e = state.events && state.events.get(c.id);
    if (!e) return 'none';
    const n = daysAway(e.when);
    if (n <= 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n <= 7) return 'week';
    return 'later';
  }
  const GROUPS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['later', 'Later'], ['none', 'No court date']];

  // Search: names, case numbers, and short case numbers like 26cf1234.
  function matches(c, q) {
    if (!q) return true;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = `${c.name} ${c.caseNo} ${c.tags.map((t) => t.name).join(' ')}`.toLowerCase();
    const flat = c.caseNo.toLowerCase().replace(/[^a-z0-9]/g, '');
    return words.every((w) => {
      if (hay.includes(w)) return true;
      const m = w.match(/^(\d{2}|\d{4})([a-z]{2})0*(\d+)$/);
      if (!m) return false;
      const yr = m[1].slice(-2);
      return new RegExp(`^(20)?${yr}${m[2]}0*${m[3]}(?!\\d)`).test(flat);
    });
  }

  function visibleCases() {
    const p = pins();
    let list = (state.cases || []).filter((c) => matches(c, state.query));
    if (state.filter === 'pinned') list = list.filter((c) => p.has(c.id));
    if (state.filter === 'upcoming' && !state.query) list = list.filter((c) => groupOf(c) !== 'none' && groupOf(c) !== 'later');
    const when = (c) => { const e = state.events && state.events.get(c.id); return e ? e.when.getTime() : Infinity; };
    return list.sort((a, b) => when(a) - when(b) || a.name.localeCompare(b.name));
  }

  function tileHtml(c) {
    const e = state.events && state.events.get(c.id);
    if (!e) return '<div class="pm-tile pm-tile-none" aria-hidden="true"><span class="pm-tile-day">&#8211;</span></div>';
    const soon = daysAway(e.when) <= 2;
    return `<div class="pm-tile${soon ? ' pm-tile-soon' : ''}" aria-hidden="true">
      <span class="pm-tile-mon">${MONTHS[e.when.getMonth()]}</span>
      <span class="pm-tile-day">${e.when.getDate()}</span>
      <span class="pm-tile-dow">${DAYS[e.when.getDay()]}</span></div>`;
  }
  function eventLine(c) {
    const e = state.events && state.events.get(c.id);
    if (!e) return c.lastActivity ? `Last activity ${MONTHS[c.lastActivity.getMonth()]} ${c.lastActivity.getDate()}` : '';
    const n = daysAway(e.when);
    const day = n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${DAYS[e.when.getDay()]}, ${MONTHS[e.when.getMonth()]} ${e.when.getDate()}`;
    const time = e.dateOnly ? '' : ` at ${e.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return `${e.title || 'Court date'}: ${day}${time}`;
  }

  function cardHtml(c, pinned) {
    const tags = c.tags.slice(0, 4).map((t) => `<span class="pm-tag"${t.color != null ? ` style="--pm-tag: var(--t-color-object-${t.color}-primary, var(--pm-teal))"` : ''}>${esc(t.name)}</span>`).join('');
    const label = `${c.name}, ${c.caseNo}. ${eventLine(c)}`;
    return `<li class="pm-card${pinned ? ' pm-pinned' : ''}" data-id="${esc(c.id)}">
      <a class="pm-card-link" href="#/project/${encodeURIComponent(c.id)}/activity" aria-label="${esc(label)}">
        ${tileHtml(c)}
        <div class="pm-card-body">
          <div class="pm-name">${esc(c.name || 'Unnamed client')}</div>
          <div class="pm-case">${esc(c.caseNo)}</div>
          <div class="pm-event">${esc(eventLine(c))}</div>
          ${tags ? `<div class="pm-tags">${tags}</div>` : ''}
        </div>
      </a>
      <button type="button" class="pm-pin" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(c.name)}">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2h-4v5l-1 1-1-1v-5H7v-2l3-3z" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </button>
    </li>`;
  }

  function drawList() {
    const root = document.getElementById('pm-cases');
    if (!root) return;
    const list = $('.pm-list', root);
    const count = $('.pm-count', root);
    if (state.error && !state.cases) {
      list.innerHTML = `<li class="pm-empty"><p>${esc(state.error)}</p><button type="button" class="pm-retry">Try again</button></li>`;
      count.textContent = '';
      return;
    }
    if (!state.cases) {
      list.innerHTML = Array.from({ length: 6 }, () => '<li class="pm-card pm-skel" aria-hidden="true"><div class="pm-tile"></div><div class="pm-card-body"><div class="pm-sk pm-sk-a"></div><div class="pm-sk pm-sk-b"></div><div class="pm-sk pm-sk-c"></div></div></li>').join('');
      count.textContent = 'Loading your cases';
      return;
    }
    const p = pins();
    const shown = visibleCases();
    count.textContent = `${state.cases.length} cases${state.events ? '' : ', loading court dates'}`;
    if (!shown.length) {
      const why = state.query ? `No case matches "${state.query}".`
        : state.filter === 'pinned' ? 'No pinned cases yet. Tap the pin on a card to keep it here.'
          : 'No court dates in the next 7 days. Switch to All to see every case.';
      list.innerHTML = `<li class="pm-empty"><p>${esc(why)}</p></li>`;
      return;
    }
    let html = '';
    const pinnedOnTop = state.filter !== 'pinned' && !state.query ? shown.filter((c) => p.has(c.id)) : [];
    if (pinnedOnTop.length) html += `<li class="pm-group">Pinned</li>${pinnedOnTop.map((c) => cardHtml(c, true)).join('')}`;
    const rest = shown.filter((c) => !pinnedOnTop.includes(c));
    for (const [g, label] of GROUPS) {
      const inGroup = rest.filter((c) => groupOf(c) === g);
      if (inGroup.length) html += `<li class="pm-group">${label}</li>${inGroup.map((c) => cardHtml(c, p.has(c.id))).join('')}`;
    }
    list.innerHTML = html;
    if (state.scrollTop) { const sc = $('.pm-scroll', root); sc.scrollTop = state.scrollTop; if (sc.scrollTop) state.scrollTop = 0; }
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!force && state.cases && Date.now() - state.loadedAt < 5 * 60 * 1000) { drawList(); return; }
    state.loading = true;
    state.error = '';
    const btn = $('#pm-cases .pm-refresh');
    if (btn) btn.classList.add('pm-spin');
    drawList();
    try {
      const evP = loadEvents().then((m) => { state.events = m; drawList(); }).catch(() => { state.events = new Map(); drawList(); });
      state.cases = await loadCases();
      state.loadedAt = Date.now();
      drawList();
      // Real names, a few at a time, so the list fills in as they arrive.
      const queue = state.cases.slice();
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const n = await loadName(c);
          if (n) { c.name = n; c.nameSure = true; }
        }
      };
      await Promise.all([evP, ...Array.from({ length: 6 }, worker)]);
      drawList();
    } catch (e) {
      state.error = `Couldn't load your cases. ${e.message}.`;
      drawList();
    } finally {
      state.loading = false;
      if (btn) btn.classList.remove('pm-spin');
    }
  }

  function buildCases() {
    if (document.getElementById('pm-cases')) return;
    const root = document.createElement('section');
    root.id = 'pm-cases';
    root.setAttribute('aria-label', 'My cases');
    root.innerHTML = `
      <header class="pm-nav">
        <div class="pm-nav-bar">
          <span class="pm-nav-title" aria-hidden="true">Cases</span>
          <button type="button" class="pm-icon pm-refresh" aria-label="Refresh">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </header>
      <div class="pm-scroll">
        <h1 class="pm-title">Cases</h1>
        <p class="pm-count"></p>
        <div class="pm-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="search" placeholder="Name or case number" aria-label="Search your cases" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        </div>
        <div class="pm-seg" role="tablist" aria-label="Show">
          <button type="button" role="tab" data-f="upcoming">This week</button>
          <button type="button" role="tab" data-f="all">All</button>
          <button type="button" role="tab" data-f="pinned">Pinned</button>
        </div>
        <ul class="pm-list" role="list"></ul>
        <button type="button" class="pm-desktop">Show Filevine's Project Hub</button>
        <p class="pm-ver">PD9 Mobile v${esc(VERSION)}</p>
      </div>`;
    document.body.appendChild(root);

    const scroller = $('.pm-scroll', root);
    const nav = $('.pm-nav', root);
    scroller.addEventListener('scroll', () => nav.classList.toggle('pm-nav-solid', scroller.scrollTop > 44), { passive: true });

    const seg = $('.pm-seg', root);
    const markSeg = () => $$('button', seg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.f === state.filter)));
    markSeg();
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      state.filter = b.dataset.f;
      store.set('pm-filter', state.filter);
      markSeg();
      drawList();
    });
    $('input', root).addEventListener('input', (e) => { state.query = e.target.value.trim(); drawList(); });
    $('.pm-refresh', root).addEventListener('click', () => refresh(true));
    $('.pm-desktop', root).addEventListener('click', () => { store.set('pm-hide-cards', true); root.remove(); toast('Back to Filevine\'s list. Tap Cases at the bottom to return.'); showBar(); });
    $('.pm-list', root).addEventListener('click', (e) => {
      const pin = e.target.closest('.pm-pin');
      if (pin) {
        e.preventDefault();
        const id = pin.closest('.pm-card').dataset.id;
        togglePin(id);
        if (navigator.vibrate) navigator.vibrate(8);
        drawList();
        return;
      }
      if (e.target.closest('.pm-retry')) { refresh(true); return; }
      const link = e.target.closest('.pm-card-link');
      if (link) { e.preventDefault(); openCase(link.closest('.pm-card').dataset.id); }
    });
    refresh(false);
  }

  // =====================================================================
  // The bottom bar: Cases, Note, Task
  // =====================================================================
  const SEL = {
    createBtn: 'button[aria-label="Create Activity"]',
    docked: '[data-testid="activity-creator-docked-form"]',
    message: '[data-testid="note-input"]',
    taskFields: '[data-testid="activity-creator-task-fields"]',
  };
  const TYPE_ICONS = { note: 'sticky_note_2', task: 'notes' };

  // The button in the note box that switches it to a note or a task.
  function typeSwitch(form, type) {
    const want = TYPE_ICONS[type];
    const word = type === 'task' ? /\btasks?\b/i : /\bnotes?\b/i;
    const cands = $$('.icon-wrapper, [role="tab"], [role="radio"], button, [aria-label], [title]', form)
      .filter((el) => visible(el) && !el.closest('[data-testid="note-input"]'));
    // 1. Filevine's icon buttons (the icon's name: sticky_note_2 for note, notes for task)
    const byIcon = cands.find((el) => { const i = el.querySelector('i'); return i && el.classList.contains('icon-wrapper') && i.textContent.trim().split(/\s+/)[0] === want; });
    if (byIcon) return byIcon;
    // 2. Anything labeled Task / Note
    return cands.find((el) => word.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`))
      || cands.find((el) => (el.matches('button, [role="tab"], [role="radio"]')) && word.test(el.textContent.trim()) && el.textContent.trim().length < 20)
      || null;
  }
  // A full tap (touch screens: some buttons listen for pointer events, not just click).
  function tap(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const fire = (C, t) => { try { el.dispatchEvent(new C(t, o)); } catch (e) { /* skip */ } };
    fire(PointerEvent, 'pointerdown'); fire(MouseEvent, 'mousedown');
    fire(PointerEvent, 'pointerup'); fire(MouseEvent, 'mouseup');
    el.click();
  }

  async function openComposer(type) {
    let form = $(SEL.docked);
    if (!form || !visible($(SEL.message, form))) {
      const btn = await waitFor(() => $(SEL.createBtn), 6000);
      if (!btn) { toast('Open the case\'s Activity tab first.'); return; }
      btn.click();
      form = await waitFor(() => { const f = $(SEL.docked); return f && visible($(SEL.message, f)) ? f : null; });
      if (!form) { toast('The note box didn\'t open. Try again.'); return; }
    }
    // Switch to Task (or back to Note). Filevine's type buttons can take a moment to
    // appear, and may look different on a phone, so look a few ways and check it worked.
    const isTask = () => !!$(SEL.taskFields, form);
    if ((type === 'task') !== isTask()) {
      for (let attempt = 0; attempt < 4 && (type === 'task') !== isTask(); attempt++) {
        const sw = await waitFor(() => typeSwitch(form, type), 2500);
        if (!sw) break;
        tap(sw);
        await waitFor(() => (type === 'task') === isTask(), 1500);
      }
      if ((type === 'task') !== isTask()) toast(`Tap ${type === 'task' ? 'Task' : 'Note'} at the top of the box to switch.`);
    }
    const box = $(SEL.message, form);
    if (box) { box.focus(); box.scrollIntoView({ block: 'center' }); }
  }

  function buildBar() {
    if (document.getElementById('pm-bar')) return;
    const bar = document.createElement('nav');
    bar.id = 'pm-bar';
    bar.setAttribute('aria-label', 'Quick actions');
    bar.innerHTML = `
      <button type="button" class="pm-bar-btn pm-bar-cases" aria-label="My cases">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="4" y="5" width="16" height="4" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="12" width="16" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        <span>Cases</span>
      </button>
      <button type="button" class="pm-bar-btn pm-bar-main" data-type="note">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 19h14M7 15l9-9 3 3-9 9H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <span>Note</span>
      </button>
      <button type="button" class="pm-bar-btn pm-bar-main pm-bar-task" data-type="task">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Task</span>
      </button>`;
    document.body.appendChild(bar);
    $('.pm-bar-cases', bar).addEventListener('click', () => {
      store.set('pm-hide-cards', false);
      const saved = store.get(PARAMS_KEY, null);
      location.hash = saved && saved.orgID ? `#/projecthub?org=${saved.orgID}` : '#/projecthub';
    });
    $$('.pm-bar-main', bar).forEach((b) => b.addEventListener('click', () => openComposer(b.dataset.type)));
    placeBar();
  }
  const showBar = () => buildBar();

  // Filevine's pages are wider than a phone, so Safari zooms out and slides around.
  // Keep the bar the same size and pinned to the bottom of what you actually see.
  function placeBar() {
    const bar = document.getElementById('pm-bar');
    const vv = window.visualViewport;
    if (!bar || !vv) return;
    const z = 1 / (vv.scale || 1);
    if (Math.abs(vv.scale - 1) < 0.01 && vv.offsetLeft === 0 && vv.width >= window.innerWidth - 1) { bar.style.cssText = ''; return; }
    bar.style.cssText = `left:${vv.offsetLeft}px; top:${vv.offsetTop + vv.height}px; right:auto; bottom:auto; width:${vv.width * vv.scale}px;`
      + ` transform-origin: 0 0; transform: scale(${z}) translateY(calc(-100% - env(safe-area-inset-bottom) - 10px)) translateX(12px); max-width:none;`;
    bar.style.width = `${vv.width * vv.scale - 24}px`;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeBar);
    window.visualViewport.addEventListener('scroll', placeBar);
  }

  // =====================================================================
  // Keep everything in step with where you are
  // =====================================================================
  // Cases from Filevine's own list open on Activity too.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="#/project/"]');
    if (!a || a.closest('#pm-cases')) return;
    const m = a.getAttribute('href').match(/#\/project\/(\d+)\/?(?:[?#].*)?$/);
    if (m) { e.preventDefault(); location.hash = `#/project/${m[1]}/activity`; }
  }, true);

  function sync() {
    const hub = onHub();
    const inCase = !!projectId();
    document.documentElement.classList.toggle('pm-on', true);
    // Cards over the Project Hub (unless you chose Filevine's list).
    const cards = document.getElementById('pm-cases');
    const showCards = hub && !store.get('pm-hide-cards', false);
    if (showCards) { buildCases(); hubParams(); } else if (cards) cards.remove();
    // While the cards are up, Filevine's own (desktop-sized) page is hidden under them,
    // so the phone lays the screen out at its own width.
    document.documentElement.classList.toggle('pm-cards-open', showCards);
    // The bottom bar everywhere except the card list (which has its own top bar).
    if (!hub || store.get('pm-hide-cards', false)) buildBar();
    else { const old = document.getElementById('pm-bar'); if (old) old.remove(); }
    const b = document.getElementById('pm-bar');
    if (b) {
      b.classList.toggle('pm-bar-incase', inCase);
      // Hide while the note box is open, so it doesn't cover the Save button.
      const composing = visible($(`${SEL.docked} ${SEL.message}`));
      b.classList.toggle('pm-bar-hidden', !!composing);
    }
  }
  window.addEventListener('hashchange', sync);
  let pending = false;
  new MutationObserver(() => { if (!pending) { pending = true; setTimeout(() => { pending = false; sync(); }, 250); } })
    .observe(document.body, { childList: true, subtree: true });

  // =====================================================================
  // Look
  // =====================================================================
  const css = document.createElement('style');
  css.textContent = `
    :root {
      --pm-paper: #f2f4f7; --pm-card: #ffffff; --pm-ink: #18202b; --pm-slate: #5b6575; --pm-faint: #8a93a1;
      --pm-line: rgba(24, 32, 43, .08); --pm-teal: #137a74; --pm-teal-soft: #e3f1ef; --pm-ember: #d2531a; --pm-ember-soft: #fbe9df;
      --pm-shadow: 0 1px 2px rgba(24, 32, 43, .06), 0 4px 14px -6px rgba(24, 32, 43, .12);
      --pm-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      --pm-round: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --pm-paper: #0f1216; --pm-card: #1a1f26; --pm-ink: #e8ebef; --pm-slate: #a3abb8; --pm-faint: #727b88;
        --pm-line: rgba(255, 255, 255, .07); --pm-teal: #3cc2b4; --pm-teal-soft: #15302d; --pm-ember: #ff8a4c; --pm-ember-soft: #3a2117;
        --pm-shadow: 0 1px 0 rgba(255, 255, 255, .03) inset, 0 6px 18px -8px rgba(0, 0, 0, .7);
      }
    }

    #pm-cases { position: fixed; inset: 0; z-index: 2147482000; background: var(--pm-paper); color: var(--pm-ink); font: 17px/1.35 var(--pm-font); -webkit-text-size-adjust: 100%; }
    #pm-cases *, #pm-bar * { box-sizing: border-box; }
    #pm-cases button, #pm-bar button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }

    /* Top bar: clear at first, frosted once you scroll (like iOS) */
    .pm-nav { position: absolute; top: 0; left: 0; right: 0; z-index: 2; padding-top: env(safe-area-inset-top); transition: background .2s, box-shadow .2s; }
    .pm-nav-bar { height: 44px; display: flex; align-items: center; justify-content: flex-end; padding: 0 max(8px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left)); position: relative; }
    .pm-nav-title { position: absolute; left: 0; right: 0; text-align: center; font-weight: 600; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .pm-nav-solid { background: color-mix(in srgb, var(--pm-paper) 82%, transparent); -webkit-backdrop-filter: saturate(1.8) blur(20px); backdrop-filter: saturate(1.8) blur(20px); box-shadow: 0 .5px 0 var(--pm-line); }
    .pm-nav-solid .pm-nav-title { opacity: 1; }
    .pm-icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; background: none; color: var(--pm-teal); border-radius: 22px; }
    .pm-icon:active { background: var(--pm-line); }
    .pm-spin svg { animation: pm-rot .9s linear infinite; }
    @keyframes pm-rot { to { transform: rotate(360deg); } }

    .pm-scroll { position: absolute; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: calc(env(safe-area-inset-top) + 44px) max(16px, env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 120px) max(16px, env(safe-area-inset-left)); }
    .pm-title { margin: 4px 0 0; font: 700 34px/1.1 var(--pm-round); letter-spacing: -.01em; }
    .pm-count { margin: 4px 0 12px; font-size: 14px; color: var(--pm-slate); min-height: 19px; }

    .pm-search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 12px; background: color-mix(in srgb, var(--pm-ink) 7%, transparent); color: var(--pm-faint); }
    .pm-search input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; color: var(--pm-ink); font: 17px var(--pm-font); outline: none; -webkit-appearance: none; }
    .pm-search input::placeholder { color: var(--pm-faint); }

    .pm-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; margin: 12px 0 4px; padding: 2px; border-radius: 10px; background: color-mix(in srgb, var(--pm-ink) 7%, transparent); }
    .pm-seg button { height: 32px; border: 0; border-radius: 8px; background: none; font-size: 14px; font-weight: 500; color: var(--pm-ink); }
    .pm-seg button[aria-selected="true"] { background: var(--pm-card); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }

    .pm-list { list-style: none; margin: 0; padding: 0; }
    .pm-group { margin: 22px 4px 8px; font-size: 15px; font-weight: 600; color: var(--pm-slate); }

    /* A case card: the court date tile, then who and what */
    .pm-card { position: relative; margin-bottom: 10px; background: var(--pm-card); border-radius: 16px; box-shadow: var(--pm-shadow); }
    .pm-card-link { display: flex; gap: 14px; padding: 14px 52px 14px 14px; color: inherit; text-decoration: none; -webkit-tap-highlight-color: transparent; border-radius: 16px; }
    .pm-card-link:active { background: color-mix(in srgb, var(--pm-ink) 5%, transparent); }
    .pm-tile { flex: none; width: 52px; height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 12px; background: var(--pm-teal-soft); color: var(--pm-teal); line-height: 1; }
    .pm-tile-mon { font-size: 11px; font-weight: 600; letter-spacing: .02em; }
    .pm-tile-day { font: 700 24px/1.05 var(--pm-round); margin: 2px 0 1px; }
    .pm-tile-dow { font-size: 11px; opacity: .8; }
    .pm-tile-soon { background: var(--pm-ember); color: #fff; }
    .pm-tile-none { background: color-mix(in srgb, var(--pm-ink) 5%, transparent); color: var(--pm-faint); }
    .pm-card-body { min-width: 0; flex: 1; }
    .pm-name { font-size: 17px; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pm-case { margin-top: 1px; font-size: 14px; color: var(--pm-slate); font-variant-numeric: tabular-nums; }
    .pm-event { margin-top: 6px; font-size: 15px; line-height: 1.3; color: var(--pm-ink); }
    .pm-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .pm-tag { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--pm-tag, var(--pm-teal)); background: color-mix(in srgb, var(--pm-tag, var(--pm-teal)) 13%, transparent); }
    .pm-pin { position: absolute; top: 6px; right: 4px; width: 44px; height: 44px; display: grid; place-items: center; border: 0; background: none; color: var(--pm-faint); border-radius: 22px; }
    .pm-pin[aria-pressed="true"] { color: var(--pm-teal); }
    .pm-pin:active { background: var(--pm-line); }

    .pm-skel .pm-tile { background: color-mix(in srgb, var(--pm-ink) 6%, transparent); }
    .pm-skel { display: flex; gap: 14px; padding: 14px; }
    .pm-sk { height: 12px; border-radius: 6px; background: color-mix(in srgb, var(--pm-ink) 7%, transparent); margin: 6px 0; }
    .pm-sk-a { width: 60%; height: 15px; } .pm-sk-b { width: 40%; } .pm-sk-c { width: 75%; }
    .pm-empty { padding: 48px 24px; text-align: center; color: var(--pm-slate); font-size: 15px; }
    .pm-empty button, .pm-desktop { margin-top: 8px; min-height: 44px; padding: 0 18px; border: 0; border-radius: 12px; background: none; color: var(--pm-teal); font-weight: 600; }
    .pm-desktop { display: block; margin: 20px auto 0; font-size: 15px; }
    .pm-ver { margin: 8px 0 0; text-align: center; font-size: 12px; color: var(--pm-faint); }

    html.pm-cards-open body > *:not(#pm-cases):not(.pm-toast) { display: none !important; }
    html.pm-cards-open, html.pm-cards-open body { overflow: hidden !important; min-width: 0 !important; width: 100% !important; }
    /* Paint the whole page (including behind Safari's toolbar) in the list's color */
    html.pm-cards-open, html.pm-cards-open body { background: var(--pm-paper) !important; }
    #pm-cases { bottom: auto !important; height: 100lvh; }
    #pm-cases .pm-card-link, #pm-cases .pm-card-link:hover, #pm-cases .pm-card-link:focus, #pm-cases .pm-card-link:visited,
    #pm-cases .pm-card-link * { text-decoration: none !important; color: inherit; }
    #pm-cases .pm-card-link .pm-case { color: var(--pm-slate); }
    /* The bottom bar */
    #pm-bar { position: fixed; z-index: 2147482100; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right));
      bottom: calc(env(safe-area-inset-bottom) + 10px); display: grid; grid-template-columns: 64px 1fr 1fr; gap: 8px; padding: 8px;
      border-radius: 22px; background: color-mix(in srgb, var(--pm-card) 86%, transparent); -webkit-backdrop-filter: saturate(1.8) blur(22px); backdrop-filter: saturate(1.8) blur(22px);
      box-shadow: 0 0 0 .5px var(--pm-line), 0 12px 32px -10px rgba(0, 0, 0, .35); font: 16px var(--pm-font); color: var(--pm-ink);
      transition: transform .25s ease, opacity .25s ease; }
    #pm-bar:not(.pm-bar-incase) { grid-template-columns: 1fr; }
    #pm-bar:not(.pm-bar-incase) .pm-bar-main { display: none; }
    #pm-bar.pm-bar-hidden { transform: translateY(140%); opacity: 0; pointer-events: none; }
    .pm-bar-btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 56px; border: 0; border-radius: 16px; font-weight: 600; font-size: 17px; }
    .pm-bar-cases { flex-direction: column; gap: 2px; font-size: 11px; font-weight: 500; background: none; color: var(--pm-slate); }
    #pm-bar:not(.pm-bar-incase) .pm-bar-cases { flex-direction: row; gap: 8px; font-size: 17px; font-weight: 600; color: var(--pm-teal); min-height: 48px; }
    .pm-bar-main { background: var(--pm-teal); color: #fff; }
    .pm-bar-task { background: color-mix(in srgb, var(--pm-teal) 14%, var(--pm-card)); color: var(--pm-teal); }
    .pm-bar-btn:active { transform: scale(.97); }
    /* Room under the page so the bar never covers the last item */
    html.pm-on body { padding-bottom: calc(env(safe-area-inset-bottom) + 96px) !important; }

    .pm-toast { position: fixed; z-index: 2147482200; left: 50%; bottom: calc(env(safe-area-inset-bottom) + 96px); transform: translateX(-50%); max-width: calc(100vw - 40px);
      padding: 10px 16px; border-radius: 14px; background: rgba(24, 32, 43, .92); color: #fff; font: 15px/1.35 var(--pm-font); text-align: center; }

    #pm-cases :focus-visible, #pm-bar :focus-visible { outline: 3px solid var(--pm-teal); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .pm-spin svg { animation: none; } #pm-bar, .pm-nav, .pm-nav-title { transition: none; } }
  `;
  document.head.appendChild(css);

  sync();
})();
