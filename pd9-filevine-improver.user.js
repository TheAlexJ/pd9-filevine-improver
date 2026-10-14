// ==UserScript==
// @name         PD9 Filevine Improver
// @namespace    https://filevine.local/pd9-improver
// @version      3.105.2
// @description  Faster notes, tasks, and case closing in Filevine for PD9.
// @match        https://*.filevine.com/*
// @match        https://*.filevineapp.com/*
// @match        https://*.filevinegov.com/*
// @match        https://courts.osceolaclerk.com/BenchmarkWeb/*
// @homepageURL  https://github.com/TheAlexJ/pd9-filevine-improver
// @supportURL   https://github.com/TheAlexJ/pd9-filevine-improver/issues
// @updateURL    https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-improver.user.js
// @downloadURL  https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-improver.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // Inside a case window (Window mode), Filevine runs in a frame. There we keep the
  // note and task tools but skip the page-level extras (search windows, hub table).
  // Which build this is. The same code makes two scripts:
  //   'attorney' = PD9 Filevine Improver (Project Hub table, Window mode, case switcher)
  //   'staff'    = PD9 Filevine Staff (no Project Hub extras or case switcher; adds task triage)
  const EDITION = 'attorney';
  const STAFF = EDITION === 'staff';
  const IN_FRAME = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
  // Only run in frames the script made itself (case windows, ready windows, and the
  // multi-case worker). Filevine's own hidden frames don't need it, so stop there.
  if (IN_FRAME && !/^pd9-/.test(window.name || '')) return;

  // ---------- Osceola Clerk (Benchmark): run a case number search ----------
  // The "Benchmark" button on an Osceola case opens the Clerk's search page with
  // the case number in the link (#pd9case=2026 CF 001234). Here, on the Clerk's
  // site, the script picks "Case Number", types it in and presses Search once.
  // It never touches a captcha, and it never searches a second time.
  const BENCHMARK_PENDING = 'pd9-benchmark-pending';
  if (location.hostname === 'courts.osceolaclerk.com') {
    // The Clerk's site replaces Date.now() with one that returns a date object,
    // so get the time a way it can't change.
    const now = () => new Date().getTime();
    // Only the main search page runs the search. Results and case pages can have a
    // search box too, so going by the box alone made it search a second time.
    const onSearchPage = /\/Home\.aspx\/Search/i.test(location.pathname)
      && !!(document.getElementById('caseNumber') && document.getElementById('searchButton'));
    const fromHash = decodeURIComponent((location.hash.match(/pd9case=([^&]+)/) || [])[1] || '');
    // The search waiting to run is kept in this tab only (sessionStorage). It is
    // saved right away and other Benchmark tabs never see it, so a search can't
    // run twice or start in a different tab.
    const getPending = () => { try { return JSON.parse(sessionStorage.getItem(BENCHMARK_PENDING) || 'null'); } catch (e) { return null; } };
    const setPending = (v) => { try { if (v) sessionStorage.setItem(BENCHMARK_PENDING, JSON.stringify(v)); else sessionStorage.removeItem(BENCHMARK_PENDING); } catch (e) { /* storage is optional */ } };
    if (fromHash) setPending({ caseNo: fromHash, at: now(), tries: 0 });
    let pending = getPending();
    if (pending && now() - pending.at > 10 * 60000) { setPending(null); pending = null; }
    // Logged in pages have a Logout button at the top right.
    const loggedIn = !!document.getElementById('btnLogout')
      || [...document.querySelectorAll('a, button')].some((el) => el.offsetParent && !el.closest('.modal, [id^="sessionTimeout"]') && /^\s*log\s*out\s*$/i.test(el.textContent || ''));
    if (!onSearchPage) {
      if (!pending) return;
      // Results or a case page after the search ran: done for good. This check comes
      // first. (It used to come after the login check below, so after logging in, the
      // case page sent you back to search and it searched twice.)
      if (pending.tries) { setPending(null); return; }
      // Just logged in and landed somewhere else: go back to the search page to finish.
      if (pending.needLogin && loggedIn) {
        setPending({ ...pending, needLogin: false, at: now() });
        location.href = `${location.origin}/BenchmarkWeb/Home.aspx/Search`;
        return;
      }
      // Results or a case page means the search went through. Stop here for good.
      if (pending.tries) setPending(null);
      return;
    }
    if (!pending) return;
    // Back on the search page after the search already ran: never search again.
    // If it bounced straight back (a refused search), fill the box and let you click.
    if (pending.tries && now() - pending.at > 20000) { setPending(null); return; }
    const caseNo = pending.caseNo;
    const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const note = (text, stay) => {
      let n = document.getElementById('pd9-bm-note');
      if (!n) {
        n = document.createElement('div');
        n.id = 'pd9-bm-note';
        n.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;max-width:340px;padding:10px 14px;border-radius:10px;background:#14171c;color:#e6e9ee;font:13px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
        document.body.appendChild(n);
      }
      n.textContent = text;
      clearTimeout(n._t);
      if (!stay) n._t = setTimeout(() => n.remove(), 8000);
    };
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const captchaShowing = () => [...document.querySelectorAll('.g-recaptcha, #WebCaptcha, iframe[src*="recaptcha"][title*="challenge" i]')]
      .some((el) => { const r = el.getBoundingClientRect(); return r.width > 30 && r.height > 30 && getComputedStyle(el).visibility !== 'hidden'; });
    const fill = () => {
      const radio = document.getElementById('radio_2');
      const box = document.getElementById('caseNumber');
      if (!radio || !box) return false;
      if (!radio.checked) radio.click();
      box.style.display = 'inline-block';
      box.focus();
      box.value = caseNo;
      ['input', 'change'].forEach((t) => fire(box, t));
      // The Clerk's page copies these two into its form when you press Search.
      // Fill them too, in case its own code skips it.
      const form = document.querySelector('form.searchform');
      if (form) {
        const t = form.querySelector('input[name="type"]');
        const q = form.querySelector('input[name="search"]');
        if (t) t.value = radio.getAttribute('searchtype') || 'CaseNumber';
        if (q) q.value = caseNo;
      }
      return true;
    };
    // Wait for the whole page, including the Clerk's own search code and its
    // invisible captcha check. Pressing Search before that is ready makes the
    // Clerk's site throw the search away and show a blank search page.
    const ready = () => new Promise((resolve) => {
      const started = now();
      const check = () => {
        const loaded = document.readyState === 'complete';
        const rc = pageWin.grecaptcha;
        const rcReady = !!(rc && (typeof rc.execute === 'function' || typeof rc.render === 'function'));
        const hasRc = !!document.querySelector('script[src*="recaptcha"], iframe[src*="recaptcha"]');
        if (loaded && (rcReady || !hasRc || now() - started > 8000)) resolve();
        else setTimeout(check, 200);
      };
      check();
    });
    const go = async () => {
      // One search per page, even if both the Improver and the Staff script are
      // installed (they share this page, so the first one to start takes it).
      const root = document.documentElement;
      if (root.dataset.pd9Benchmark) return;
      root.dataset.pd9Benchmark = EDITION;
      if (fromHash) history.replaceState(null, '', location.pathname + location.search);
      // Not logged in: searching now would fail or ask for a captcha. Ask to log in;
      // the search runs by itself when you come back logged in (within 10 minutes).
      if (!loggedIn) {
        setPending({ ...pending, needLogin: true, at: now() });
        const login = [...document.querySelectorAll('a, button')].find((el) => /^\s*(log\s*in|sign\s*in)\b/i.test(el.textContent || '') && el.offsetParent);
        note(`You are not logged in to Benchmark. Log in, and the search for ${caseNo} runs by itself after.`, true);
        const n = document.getElementById('pd9-bm-note');
        if (n && login) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = 'Log in';
          b.style.cssText = 'display:block;margin-top:8px;padding:6px 14px;border-radius:7px;border:0;background:#2fbfae;color:#06201d;font-weight:600;cursor:pointer';
          b.addEventListener('click', () => login.click());
          n.appendChild(b);
        }
        if (login) { login.style.outline = '3px solid #2fbfae'; login.style.outlineOffset = '2px'; }
        return;
      }
      // Any message the Clerk's site showed about the last try.
      const why = [...document.querySelectorAll('.toast-message, .alert-error, .alert-danger, .alert, .validation-summary-errors, .field-validation-error, .error')]
        .map((e) => e.textContent.trim()).filter((t) => t && t.length < 300)[0] || '';
      // Second time back on a blank search page: stop trying, leave it filled in.
      if (pending.tries >= 1) {
        setPending(null);
        let n = 0;
        const waitFill = () => { if (!fill() && (n += 1) < 40) setTimeout(waitFill, 250); };
        waitFill();
        const from = (document.referrer.match(/BenchmarkWeb\/([^?#]*)/) || [])[1] || '';
        note(`The Clerk's site sent you back to the search page${why ? ` (it said: "${why}")` : ''}${from ? ` from ${from}` : ''}. ${caseNo} is filled in. Click Search.`, true);
        return;
      }
      await ready();
      // The Clerk's page points its search form at the right address one second
      // after it loads, so wait a bit longer than that before pressing Search.
      await new Promise((r) => setTimeout(r, 1300));
      if (!fill()) { note(`Could not find the case number box. Search for ${caseNo} by hand.`, true); setPending(null); return; }
      if (captchaShowing()) { setPending(null); note(`${caseNo} is filled in. Finish the captcha, then click Search.`, true); return; }
      if (root.dataset.pd9Benchmark !== EDITION) return;
      // Press Search once. Mark it first, so if the Clerk's site ever sends us
      // straight back here, we only fill the box and never search a second time.
      const btn = document.getElementById('searchButton');
      if (!btn) { setPending(null); note(`${caseNo} is filled in. Press Enter or click Search.`, true); return; }
      setPending({ ...pending, tries: 1, needLogin: false, at: now() });
      btn.click();
      note(`Searching for ${caseNo}...`);
    };
    go();
    return;
  }


  // ---------------------------------------------------------------
  // DEFAULT TEMPLATES. Everyone starts with these. Each person can change
  // their own copy from the account menu: click your initials, then
  // "Improver Options". Once someone saves their own, these defaults no
  // longer apply to them (until they click "Reset to defaults").
  // "subject" goes in the Subject box. "body" goes in the Message box.
  // {date} becomes today's date, like 10/2/2026. Change it if the contact was earlier.
  // {|} is where the cursor lands. Leave it out to land at the end.
  // "tag" is added as a hashtag at the bottom of the note, after 2 blank lines.
  // ---------------------------------------------------------------
  // Client communication, the way the office wants it logged (October 2026):
  // calls as a Call with #CLIENTCOMM; visits as a note with #CLIENTCOMM plus
  // the kind of visit. File Review lives on the Intake tab and Conflict on the
  // Request tab now, so they are not note templates anymore.
  const DEFAULT_TEMPLATES = [
    {
      label: 'Client Call', subject: 'Client Call', type: 'call', tag: 'CLIENTCOMM', hotkey: 'C',
      body: [
        'Date: {date}',
        'Spoke with: {|}',
        'Discussed: ',
        'Follow-up: ',
      ].join('\n'),
    },
    {
      label: 'Jail Visit', subject: 'Jail Visit', type: 'note', tag: 'CLIENTCOMM JAILVISIT', hotkey: 'Alt+2',
      body: [
        'Date: {date}',
        'Discussed: {|}',
        'Follow-up: ',
      ].join('\n'),
    },
    {
      label: 'Video Visit', subject: 'Video Visit', type: 'note', tag: 'CLIENTCOMM VIDEO', hotkey: 'Alt+3',
      body: [
        'Date: {date}',
        'Discussed: {|}',
        'Follow-up: ',
      ].join('\n'),
    },
    {
      label: 'Court', subject: 'Court', type: 'note', tag: 'CLIENTCOMM COURT', hotkey: 'Alt+4',
      body: [
        'Date: {date}',
        'Discussed: {|}',
        'Follow-up: ',
      ].join('\n'),
    },
  ];
  // The old defaults, to tell untouched copies (safe to replace) from ones people changed.
  const OLD_DEFAULT_BODIES = {
    Contact: 'Date of contact: {date}\nContact type: {|}\nContact with: \nDiscussed: \nFollow-up: ',
    'File Review': 'Charge: {|}\nSummary: \nPending Cases: \nJail: \nConflict: \nTheory of Defense: \nMotions: \nExperts: ',
    Conflict: '(1) Nature of conflict: {|}\n(2) Open cases: \n(3) Prior representation: \n(4) If co-d, who is more culpable: \n(5) If co-d, are either incarcerated: \n(6) Recommendation for conflict and why? ',
  };

  // ---------- saved settings (per person, kept by Tampermonkey) ----------
  const store = {
    get(key, fallback) {
      try { if (typeof GM_getValue === 'function') return GM_getValue(key, fallback); } catch (e) { /* use localStorage */ }
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; } } catch (e) { /* use localStorage */ }
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };
  const TEMPLATES_KEY = 'pd9-templates';
  const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // One or more tags, written like "CLIENTCOMM JAILVISIT" (spaces, commas or # between).
  const cleanTag = (t) => (t || '').split(/[\s,#]+/).filter(Boolean).join(' ');
  const tagList = (t) => cleanTag(t).split(' ').filter(Boolean);

  function loadTemplates() {
    let saved = store.get(TEMPLATES_KEY, null);
    // One time (October 2026): swap the old Contact / File Review / Conflict
    // templates for the client communication ones. Templates someone changed stay.
    if (Array.isArray(saved) && saved.length && !store.get('pd9-templates-oct2026', false)) {
      const kept = saved.filter((t) => !(OLD_DEFAULT_BODIES[t.label] !== undefined && (t.body || '') === OLD_DEFAULT_BODIES[t.label]));
      const taken = new Set(kept.map((t) => t.hotkey).filter(Boolean));
      for (const d of DEFAULT_TEMPLATES) {
        if (kept.some((t) => t.label === d.label)) continue;
        kept.push({ ...d, hotkey: taken.has(d.hotkey) ? '' : d.hotkey });
        if (d.hotkey) taken.add(d.hotkey);
      }
      saved = kept;
      store.set(TEMPLATES_KEY, saved);
      store.set('pd9-templates-oct2026', true);
    }
    const list = Array.isArray(saved) && saved.length ? saved : DEFAULT_TEMPLATES;
    return list.map((t) => ({ id: t.id || newId(), label: t.label || 'Untitled', subject: t.subject || '', type: t.type === 'call' ? 'call' : 'note', tag: cleanTag(t.tag), body: t.body || '', hotkey: t.hotkey || '' }));
  }
  let TEMPLATES = loadTemplates();

  // ---------- template shortcuts ----------
  // Written like "Alt+1" or "Shift+C". Read from the physical key (e.code), so
  // Option+1 on a Mac still counts as Alt+1.
  function comboFromEvent(e) {
    const m = (e.code || '').match(/^(?:Key([A-Z])|Digit(\d)|Numpad(\d)|(F\d{1,2}))$/);
    if (!m) return '';
    const key = m[1] || m[2] || m[3] || m[4];
    return [e.ctrlKey && 'Ctrl', e.metaKey && 'Cmd', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
  }
  // Shortcuts we won't allow: plain N and T (note and task), and the browser's own Ctrl/Cmd keys.
  function comboProblem(combo) {
    if (!combo) return '';
    if (/^[NT]$/.test(combo)) return `${combo} is already used to open a ${combo === 'N' ? 'note' : 'task'}.`;
    if (/^(Ctrl|Cmd)(\+Shift)?\+[ACFLNPRSTVWXYZD]$/.test(combo)) return `${combo} is a browser shortcut. Try Alt with a number, like Alt+4.`;
    return '';
  }


  // Hotkeys (no modifiers, only inside a case, never while typing)
  const HOTKEYS = {
    n: 'note',  // N opens the floating box as a Note
    t: 'task',  // T opens the floating box as a Task
  };
  const CTRL_ENTER_SAVES = true; // Ctrl+Enter (Cmd+Enter on Mac) saves the note
  const AUTO_OPEN_TAGS = true;   // Show the Tags box every time the note box opens
  const SAVE_DRAFTS = true;      // Save as you type. Use "Restore note" to get it back.
  const DRAFT_MAX_AGE_DAYS = 14; // Saved drafts older than this are deleted
  const DRAFT_MAX_COUNT = 25;    // Only keep drafts for this many cases (newest win)
  const SKIP_WEEKENDS = true;     // A due date on Sat or Sun moves to Monday (Friday task -> Monday)
  const TASK_DUE_IN_DAYS = 1;    // Default task due date: 1 = tomorrow. Replaces Filevine's "today". null = off.

  // Case links in the Project Hub open to this section. Set to null to turn off.
  const HUB_OPENS_TO = STAFF ? '' : 'activity'; // staff: leave Project Hub links alone


  // ---------------------------------------------------------------
  // Filevine selectors (data-testid and aria-label are stable)
  // ---------------------------------------------------------------
  const SEL = {
    createBtn:   'button[aria-label="Create Activity"]',
    docked:      '[data-testid="activity-creator-docked-form"]',
    inline:      '[data-testid="activity-creator-inline-form"]',
    layout:      '[data-testid="activity-creator-form-layout"]',
    subject:     '[data-testid="activity-creator-subject-field"]',
    message:     '[data-testid="note-input"]',
    tagInput:    '[data-testid="tag-picker-input"]',
    tagChip:     '[data-testid^="tag-chip-"]',
    tagsBtn:     '.edit-tags-button button',
    projectName: '[data-testid="activity-creator-selected-project-description"]',
    closeBtn:    '[data-testid="activity-creator-close-button"]',
    taskFields:  '[data-testid="activity-creator-task-fields"]',
    dueDate:     '[data-testid="activity-creator-task-due-date-field"]',
    tagChip:     '[data-testid^="tag-chip-"]',
  };
  const COMPOSERS = `${SEL.docked}, ${SEL.inline}`;
  
  // ---------- small helpers ----------
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.getClientRects().length);
  const norm = (t) => (t || '').trim().replace(/^#/, '').toLowerCase();
  const composerOf = (el) => (el && el.closest ? el.closest(COMPOSERS) : null);
  const inCase = () => /\/project\/\d+/.test(location.href);

  async function waitFor(fn, timeout = 4000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    return null;
  }

  function toast(msg) {
    $$('.fvqn-toast').forEach((old) => old.remove()); // one message at a time
    const t = document.createElement('div');
    t.className = 'fvqn-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function today() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  // True when the user is typing somewhere, so the hotkey stays out of the way.
  function isTyping(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    return [...path, document.activeElement].some((el) => {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
      }
      if (el.isContentEditable) return true;
      const role = el.getAttribute && el.getAttribute('role');
      return role === 'textbox' || role === 'combobox' || role === 'searchbox';
    });
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setCaret(range) {
    if (!range || !range.startContainer.isConnected) return; // box was redrawn, skip
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  function caretToEnd(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    setCaret(r);
  }

  function placeCaretAt(box, charIndex) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let seen = 0, node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (seen + len >= charIndex) {
        const r = document.createRange();
        r.setStart(node, charIndex - seen);
        r.collapse(true);
        return setCaret(r);
      }
      seen += len;
    }
    caretToEnd(box);
  }

  // Remember the caret in each note box so we can put it back after tagging.
  const lastRange = new WeakMap();
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const box = sel.anchorNode && sel.anchorNode.parentElement &&
      sel.anchorNode.parentElement.closest(SEL.message);
    if (box) lastRange.set(box, sel.getRangeAt(0).cloneRange());
  });
  function restoreCaret(box) {
    if (!box || !box.isConnected) box = $(SEL.message); // use the current box if redrawn
    if (!box) return;
    box.focus();
    const r = lastRange.get(box);
    if (r && box.contains(r.startContainer)) setCaret(r);
    else caretToEnd(box);
  }

  // ---------- putting text in the note box ----------
  // Filevine's editor keeps its own copy of the text and can redraw the box from
  // it, so some ways of typing get wiped out. We try a few ways, in order, and
  // check after each one that every line actually landed.

  const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function clearBox(box) {
    box.focus();
    const r = document.createRange();
    r.selectNodeContents(box);
    setCaret(r);
    document.execCommand('delete');
  }

  // True when the box shows every non-empty line, in order, each on its own line.
  function linesLanded(box, lines) {
    if (!box || !box.isConnected) return false;
    // Hashtag lines are skipped: Filevine may turn them into tag chips.
    const clean = (arr) => arr.map((l) => l.trim()).filter((l) => l && !/^#\S+$/.test(l));
    const want = clean(lines);
    const have = clean(box.innerText.replace(/\u00a0/g, ' ').split('\n'));
    return want.length === have.length && want.every((w, i) => have[i] === w);
  }

  const FILL_METHODS = [
    // 1) Paste it, the way Ctrl+V would. Most editors handle paste themselves.
    function paste(box, text) {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    // 2) Insert it all at once as lines with <br> breaks.
    function html(box, text) {
      const htmlText = text.split('\n')
        .map((l) => escapeHtml(l).replace(/^ | $/g, '&nbsp;').replace(/ {2}/g, ' &nbsp;'))
        .join('<br>');
      document.execCommand('insertHTML', false, htmlText);
    },
    // 3) Type each line, Shift+Enter between lines.
    function linebreaks(box, text) {
      text.split('\n').forEach((line, i) => {
        if (i > 0) document.execCommand('insertLineBreak');
        if (line) document.execCommand('insertText', false, line);
      });
    },
    // 4) Type each line, Enter between lines.
    function paragraphs(box, text) {
      text.split('\n').forEach((line, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        if (line) document.execCommand('insertText', false, line);
      });
    },
  ];
  let goodMethod = 0; // remember what worked last time and try it first

  async function fillMessage(box, text, liveBox = () => box) {
    text = text.replace(/\{date\}/g, today());
    const markAt = text.indexOf('{|}');
    const caretChars = markAt < 0 ? -1 : text.slice(0, markAt).replace(/\n/g, '').length;
    text = text.replace('{|}', '');
    const lines = text.split('\n');

    const order = [goodMethod, ...FILL_METHODS.keys()].filter((v, i, a) => a.indexOf(v) === i);
    for (const m of order) {
      const target = liveBox();
      if (!target) return false;
      clearBox(target);
      FILL_METHODS[m](target, text);
      await sleep(150); // give Filevine a moment to redraw
      const now = liveBox();
      if (linesLanded(now, lines)) {
        goodMethod = m;
        now.focus();
        if (caretChars >= 0) placeCaretAt(now, caretChars);
        else caretToEnd(now);
        return true;
      }
    }
    return false;
  }


  // Make sure "Note" is the selected activity type.
  // Activity types in the composer header, by their icon name.
  const TYPE_ICONS = { note: 'sticky_note_2', task: 'notes', call: 'phone' };

  // Select a type (note or task). Returns true if it had to switch.
  function ensureType(form, type) {
    for (const w of $$('.icon-wrapper', form)) {
      const icon = w.querySelector('i');
      // The icon also holds hidden text like "slot-text:notes", so use the first word.
      if (icon && icon.textContent.trim().split(/\s+/)[0] === TYPE_ICONS[type]) {
        if (w.getAttribute('aria-label')) return false; // already selected
        w.click();
        return true;
      }
    }
    return false;
  }

  async function openFloating(type = 'note') {
    let form = $(SEL.docked);
    // Minimized (for example by Esc)? Bring that box back up, with its text, instead of starting a new one.
    if (form && isVisible(form) && !isVisible($(SEL.message, form))) {
      const restore = $('[data-testid="activity-creator-minimize-button"], [data-testid*="maximize"], [data-testid*="expand"]', form)
        || $('.header', form);
      if (restore) {
        restore.click();
        await waitFor(() => isVisible($(SEL.message, form)), 1500);
        refreshComposer(form);
      }
    }
    if (!form || !isVisible($(SEL.message, form))) {
      const btn = $(SEL.createBtn);
      if (!btn) { toast('Could not find the Create Activity button.'); return null; }
      btn.click();
      form = await waitFor(() => {
        const f = $(SEL.docked);
        return f && isVisible($(SEL.message, f)) ? f : null;
      });
      if (!form) { toast('The note box did not open.'); return null; }
    }
    if (ensureType(form, type)) {
      // Switching type redraws the form, so wait for it to settle.
      await waitFor(() => (type === 'task') === !!$(SEL.taskFields, form), 1500);
      await sleep(50);
    }
    const box = $(SEL.message, form);
    if (!box) return form;
    box.focus();
    if (!lastRange.get(box)) caretToEnd(box); else restoreCaret(box);
    return form;
  }


  // ---------- default task due date ----------
  // Filevine's date field ignores a value that is just "set", so this types the
  // date in like a person, then clicks away so the field accepts it. It checks
  // that the date stuck and tries again if Filevine reset the field.
  const dueDateDone = new WeakSet(); // task forms we already handled
  let dueDateBusy = false;

  function dueDateString(days = TASK_DUE_IN_DAYS) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    if (SKIP_WEEKENDS && days > 0) {
      if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Saturday -> Monday
      if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sunday -> Monday
    }
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  }

  async function defaultDueDate(form) {
    if (TASK_DUE_IN_DAYS == null || dueDateBusy) return;
    const fields = $(SEL.taskFields, form);
    if (!fields || dueDateDone.has(fields)) return;
    dueDateDone.add(fields);
    dueDateBusy = true;
    try {
      await sleep(200); // let Filevine finish drawing the task fields
      const hadFocus = document.activeElement;
      const want = dueDateString();

      for (let attempt = 0; attempt < 3; attempt++) {
        const input = $(SEL.dueDate, form);
        if (!input) return;
        // Filevine fills in today on its own. Replace that, but never a date you picked.
        const current = input.value.trim();
        if (current === want) break;
        if (current && current !== dueDateString(0)) return;

        input.focus();
        input.select();
        document.execCommand('insertText', false, want);
        if (input.value !== want) setInputValue(input, want);
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Click away (a real blur) so the date field commits the value.
        const box = $(SEL.message, form);
        if (box) box.focus(); else input.blur();

        await sleep(500);
        const check = $(SEL.dueDate, form);
        if (check && check.value.trim() === want) break; // it stuck
      }

      // Put the cursor back where it was.
      const box = $(SEL.message, form);
      if (hadFocus && hadFocus.isConnected && form.contains(hadFocus) && hadFocus !== box &&
          hadFocus !== $(SEL.dueDate, form)) {
        hadFocus.focus();
      } else {
        restoreCaret(box);
      }
    } finally {
      dueDateBusy = false;
    }
  }


  // ---------- clear old template tags from the Tags box ----------
  const templateTags = () => [...new Set(TEMPLATES.flatMap((t) => tagList(t.tag)))];

  // Remove chips for template tags other than "keep" (for example, CONFLICT
  // when you switch to a Contact template). Tags you add by hand stay.
  async function clearOtherTemplateTags(form, keep) {
    for (let pass = 0; pass < 5; pass++) {
      const extra = $$(SEL.tagChip, form).filter((chip) => {
        const name = norm(chip.getAttribute('data-testid').slice('tag-chip-'.length));
        return !tagList(keep).some((k) => norm(k) === name) && templateTags().some((t) => norm(t) === name);
      });
      if (!extra.length) return;
      for (const chip of extra) {
        const btn = chip.querySelector('button.icon-button-right, button');
        if (btn) btn.click();
      }
      await sleep(120);
    }
  }

  // ---------- Project Hub: open cases to Activity ----------
  // The hub is an ag-grid table. Each row has row-id = the case number, and
  // the grid reuses rows as you scroll or filter, so we fix links on the fly.
  const onHub = () => /#\/projecthub/i.test(location.href);
  const CASE_ROOT = /^(.*#\/project\/\d+)\/?(\?.*)?$/; // ".../#/project/123" with no section

  const activityHash = (id) => `#/project/${id}/${HUB_OPENS_TO}`;

  // Case number for a click target: from the row, or from the link itself.
  function hubCaseId(target) {
    const a = target.closest && target.closest('a[href*="/project/"]');
    const m = a && (a.getAttribute('href') || '').match(/\/project\/(\d+)/);
    if (m) return { id: m[1], link: a };
    const cell = target.closest && target.closest('[col-id="ProjectName"]');
    const row = cell && cell.closest('.ag-row[row-id]');
    return row && /^\d+$/.test(row.getAttribute('row-id')) ? { id: row.getAttribute('row-id'), link: null } : null;
  }

  function fixLink(a) {
    const m = (a.getAttribute('href') || '').match(CASE_ROOT);
    if (m) a.setAttribute('href', `${m[1]}/${HUB_OPENS_TO}${m[2] || ''}`);
  }

  function rewriteHubLinks() {
    if (!HUB_OPENS_TO || !onHub()) return;
    $$('a[href*="/project/"]').forEach(fixLink);
  }

  // Fix the link the moment you press the mouse, before any click or new-tab action.
  window.addEventListener('mousedown', (e) => {
    if (!HUB_OPENS_TO || !onHub()) return;
    const hit = hubCaseId(e.target);
    if (hit && hit.link) fixLink(hit.link);
  }, true);

  // Plain left click on a case name: go straight to Activity.
  window.addEventListener('click', (e) => {
    if (!HUB_OPENS_TO || !onHub()) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab etc. use the link
    if (e.target.closest && e.target.closest('#pd9-hub-sorted, #pd9-case, #pd9-adv, #pd9-switch')) return; // the script's own lists handle their links
    const hit = hubCaseId(e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.hash = activityHash(hit.id);
  }, true);

  // ---------- clear tags after closing the box ----------
  // Filevine keeps tags around after you X out of the box. When you close it,
  // we remember that, and clear every tag the next time the box opens.
  const closedAt = { docked: 0, inline: 0 };
  const kindOf = (form) => (form.matches(SEL.docked) ? 'docked' : 'inline');

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest(SEL.closeBtn);
    const form = btn && composerOf(btn);
    if (form) closedAt[kindOf(form)] = Date.now();
  }, true);

  async function clearAllTags(form) {
    await sleep(300); // let the tag chips draw
    for (let pass = 0; pass < 5; pass++) {
      const chips = $$(SEL.tagChip, form);
      if (!chips.length) return;
      for (const chip of chips) {
        const btn = chip.querySelector('button.icon-button-right, button');
        if (btn) btn.click();
      }
      await sleep(150);
    }
  }

  // A fresh, empty note box should not start with tags left over from a
  // template (like #CLIENTCOMM). Tags you add yourself after that stay.
  const freshBoxes = new WeakSet();
  function clearLeftoverTemplateTags(form) {
    const box = $(SEL.message, form);
    if (!box || freshBoxes.has(box) || !isVisible(box)) return;
    freshBoxes.add(box);
    if (box.textContent.trim()) return; // has text (a draft or a template): leave it alone
    setTimeout(() => {
      if (box.textContent.trim()) return;
      const names = templateTags().map(norm);
      $$(SEL.tagChip, form)
        .filter((chip) => names.includes(norm(chip.getAttribute('data-testid').slice('tag-chip-'.length))))
        .forEach((chip) => { const btn = chip.querySelector('button.icon-button-right, button'); if (btn) btn.click(); });
    }, 400);
  }

  function clearTagsIfReopened(form) {
    const kind = kindOf(form);
    // Wait until the old box is gone, so we only act on the reopened one.
    if (!closedAt[kind] || Date.now() - closedAt[kind] < 400) return;
    const box = $(SEL.message, form);
    if (!isVisible(box)) return;
    if (box.textContent.trim()) return; // still has text (for example a save that didn't go through): keep the tags
    closedAt[kind] = 0;
    clearAllTags(form);
  }

  // Show the Tags box once each time a note box opens.
  const tagsShownFor = new WeakSet();
  function autoShowTags(form) {
    if (!AUTO_OPEN_TAGS) return;
    const box = $(SEL.message, form);
    if (!box || tagsShownFor.has(box)) return;
    tagsShownFor.add(box);
    if ($(SEL.tagInput, form)) return;
    const btn = $(SEL.tagsBtn, form);
    if (!btn) return;
    const hadFocus = document.activeElement;
    btn.click();
    setTimeout(() => {
      const active = document.activeElement;
      if (active === box || active === $(SEL.subject, form)) return;
      if (hadFocus && form.contains(hadFocus) && hadFocus !== btn) hadFocus.focus();
      else restoreCaret(box);
    }, 80);
  }

  // ---------- templates ----------
  async function useTemplate(form, tpl) {
    // Filevine can redraw the note box (for example after tags change), which
    // leaves us holding an old, detached copy. Always grab the live one.
    const liveBox = () => $(SEL.message, form);
    const box0 = liveBox();
    const subj0 = $(SEL.subject, form);
    if (!box0) return;
    const dirty = box0.textContent.trim() || (subj0 && subj0.value.trim());
    if (dirty && !confirm('Replace what is already in the note box?')) return;

    // Two blank lines, then the hashtag. The space after it closes the tag
    // suggestion list. Then the cursor jumps back to the {|} spot.
    const tags = tagList(tpl.tag);
    const body = tags.length ? `${tpl.body}\n\n\n${tags.map((t) => `#${t}`).join(' ')} ` : tpl.body;

    // Calls are logged as a Call (the phone icon), everything else as a Note.
    const want = tpl.type === 'call' ? 'call' : 'note';
    if (!$(SEL.taskFields, form) && ensureType(form, want)) {
      await sleep(400); // switching type redraws the form
      await waitFor(() => $(SEL.message, form), 1500);
    }

    await clearOtherTemplateTags(form, tpl.tag);
    const subj = $(SEL.subject, form);
    if (subj) setInputValue(subj, tpl.subject);
    await sleep(50); // let Filevine settle after the subject change

    // Fill, then check it landed. If Filevine redrew the box, fill the new one.
    const landed = await fillMessage(liveBox(), body, liveBox);
    if (!landed) toast('The template did not load. Click in the message box, then try the button again.');

    // Filevine may turn the old hashtag into a chip a moment later, so check again.
    await sleep(150);
    const box = liveBox();
    const caret = box && lastRange.get(box);
    await clearOtherTemplateTags(form, tpl.tag);
    if (box && caret && document.activeElement !== box) { box.focus(); setCaret(caret); }
    saveDraft(form);
  }


  function buildBar(form) {
    const wrap = document.createElement('div');
    wrap.className = 'fvqn-wrap';

    const warn = document.createElement('div');
    warn.className = 'fvqn-warn';
    warn.hidden = true;
    wrap.appendChild(warn);

    const bar = document.createElement('div');
    bar.className = 'fvqn-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Note templates');
    // Uses Filevine's own label class (same as "Message" and "Tags") so it matches.
    const label = document.createElement('span');
    label.className = 'fvs-heading-75 fvqn-label';
    label.textContent = 'Templates:';
    bar.appendChild(label);
    for (const tpl of TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fvqn-chip';
      b.textContent = tpl.label;
      if (tpl.hotkey) b.title = `Shortcut: ${tpl.hotkey}`; // shows on hover only
      b.addEventListener('click', () => useTemplate(composerOf(b) || form, tpl));
      bar.appendChild(b);
    }
    const hint = document.createElement('span');
    hint.className = 'fvqn-hint';
    hint.textContent = 'N: note   T: task   C: client call   Ctrl+Enter: save';
    bar.appendChild(hint);
    wrap.appendChild(bar);
    return wrap;
  }

  // Warn if the floating box is set to a different case than the one on screen.
  function currentCaseName() {
    if (!inCase()) return '';
    return document.title.replace(/\s*\|\s*Filevine\s*$/i, '').trim();
  }
  function updateWarning(form) {
    const warn = $('.fvqn-warn', form);
    const proj = $(SEL.projectName, form);
    if (!warn) return;
    const noteCase = proj ? proj.textContent.trim() : '';
    const pageCase = currentCaseName();
    const mismatch = noteCase && pageCase && noteCase !== pageCase;
    if (warn.hidden === !!mismatch) warn.hidden = !mismatch;
    const msg = mismatch ? `This note will go to ${noteCase}, not the case on screen. Use "Change project" if that is wrong.` : '';
    if (mismatch && warn.textContent !== msg) warn.textContent = msg; // only write on change, avoids an observer loop
  }

  // ---------- close the floating box when you switch cases ----------
  const projectId = () => (location.href.match(/\/project\/(\d+)/) || [])[1] || null;
  let lastProjectId = projectId();

  function watchProject() {
    const id = projectId();
    if (!id || id === lastProjectId) return; // same case, or not in a case
    lastProjectId = id;
    rememberRecent(id);
    const form = $(SEL.docked);
    if (!form) return;
    const box = $(SEL.message, form);
    const hadText = box && box.textContent.trim();
    saveDraft(form); // keep the text for the old case
    const close = $(SEL.closeBtn, form);
    if (close) {
      close.click();
      toast(hadText ? 'Closed the note for the other case. Click "Restore note" there to get it back.' : 'Closed the note for the other case.');
    }
  }

  // ---------- What's new ----------
  // After an update, a small card shows the new features once, in the corner.
  // No dark backdrop, nothing to click through. It also opens from Improver Options.
  // Newest first. "v" is the Improver version that brought it; "staff" is the Staff
  // version. Leave one out to hide the item from that script.
  const WHATS_NEW = [
    // One list for everything new (October 13 and 14, 2026), so everyone sees it all together.
    { v: '3.105.1', items: [
      'Intake tab: a Today button next to Today\u2019s Date, and a File Review template button next to Incident Details.',
      'Request tab: a Today button next to Date Requested, Requestor fills in with your name when you pick a Request Type (or click Me), and a Conflict template button appears next to Comment when the type is CONFLICT.',
      'New client contact templates that follow the office rules: Client Call (logs it as a Call with #CLIENTCOMM, shortcut C), Jail Visit (#CLIENTCOMM #JAILVISIT), Video Visit (#CLIENTCOMM #VIDEO) and Court (#CLIENTCOMM #COURT).',
      'The old Contact, File Review and Conflict note templates are gone (File Review goes on the Intake tab and Conflict on the Request tab now). If you changed one of them yourself, yours is kept.',
      'Benchmark button on Osceola cases. It searches the Clerk’s site for the Court Case Number on Case Summary and opens the case. If you are not logged in to Benchmark, it asks you to log in first.',
      'Record Depo button on every case. It shows the sound level while it records, and the audio file (case name, date and time) downloads when you stop. A backup keeps it safe if Chrome crashes.',
      'Search box above a case’s Activity feed. Type words or a date like 10/2 to show only matching items. Click "Search older items" to include older activity.',
      'In the file preview, the Left and Right arrow keys flip to the previous or next file, like Up and Down.',
      'The checkbox column in the PD9 table is narrower.',
      'This What’s new box. You can open it again from Improver Options.',
    ] },
    { staff: '1.6.2', items: [
      'Flag tasks red, yellow or green. Hover a task and press 1, 2 or 3, or select several and flag them all at once.',
      'Sort tasks by due date, newest first, or priority, and show one color at a time.',
      'Search box on the Tasks page. Type any word or a date like 9/28 to filter the tasks.',
      'Benchmark button on Osceola cases. It searches the Clerk’s site for the Court Case Number on Case Summary.',
      'Record Depo button on every case. The audio file downloads when you stop.',
      'Search box above a case’s Activity feed, and Left/Right arrow keys in the file preview.',
    ] },
  ];
  const WHATS_NEW_SEEN = 'pd9-whats-new-seen';
  const scriptVersion = () => (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';
  const versionNum = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0).reduce((t, n) => t * 1000 + n, 0);

  function whatsNewItems(sinceVersion) {
    const key = STAFF ? 'staff' : 'v';
    const since = sinceVersion ? versionNum(sinceVersion) : -1;
    const now = versionNum(scriptVersion() || '999');
    const groups = WHATS_NEW.filter((g) => g[key] && versionNum(g[key]) <= now)
      .sort((a, b) => versionNum(b[key]) - versionNum(a[key]));
    const fresh = groups.filter((g) => versionNum(g[key]) > since);
    // After an update with nothing new to list (a small fix), show nothing.
    if (sinceVersion && !fresh.length) return [];
    return (fresh.length ? fresh : groups).flatMap((g) => g.items).slice(0, 12);
  }

  function showWhatsNew(items, fromMenu) {
    document.getElementById('pd9-whatsnew')?.remove();
    if (!items.length) { if (fromMenu) toast('Nothing new to show.'); return; }
    const card = document.createElement('div');
    card.id = 'pd9-whatsnew';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = `
      <div class="pd9-wn-head"><b>What's new in the ${STAFF ? 'Staff script' : 'Improver'}</b><span class="pd9-wn-ver">v${escapeHtml(scriptVersion())}</span>
        <button type="button" class="pd9-wn-x" aria-label="Close">&#215;</button></div>
      <ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      <div class="pd9-wn-foot"><button type="button" class="pd9-wn-ok">Got it</button></div>`;
    const close = () => { card.classList.add('pd9-wn-out'); setTimeout(() => card.remove(), 200); };
    card.querySelector('.pd9-wn-x').addEventListener('click', close);
    card.querySelector('.pd9-wn-ok').addEventListener('click', close);
    // Stay out of the way of the deposition recorder.
    const depoPanel = document.getElementById('pd9-depo');
    if (depoPanel) card.style.bottom = `${Math.round(window.innerHeight - depoPanel.getBoundingClientRect().top + 12)}px`;
    document.body.appendChild(card);
    // From the update (not the menu), fade away after 20 seconds unless the mouse is on it.
    if (!fromMenu) {
      let timer = setTimeout(close, 20000);
      card.addEventListener('mouseenter', () => clearTimeout(timer));
      card.addEventListener('mouseleave', () => { timer = setTimeout(close, 8000); });
    }
  }

  // Once per new version, a few seconds after the page loads.
  if (!IN_FRAME) setTimeout(() => {
    const now = scriptVersion();
    if (!now) return;
    const seen = store.get(WHATS_NEW_SEEN, '');
    if (seen === now) return;
    store.set(WHATS_NEW_SEEN, now);
    showWhatsNew(whatsNewItems(seen), false);
  }, 4000);

  // ---------- "Improver Options" in the account menu ----------
  // Filevine draws the account menu only when it opens. When it does, we copy
  // its "Filevine Settings" item (so the look matches) and add ours below it.
  // Only search for the menu for a few seconds after the account menu is clicked,
  // instead of on every change to the page.
  let menuCheckUntil = 0;
  document.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('.fvs-global-avatar-menu'))) return;
    menuCheckUntil = Date.now() + 3000;
    [60, 300, 800].forEach((ms) => setTimeout(addOptionsMenuItem, ms)); // in case the menu opens without new page parts
  }, true);

  function addOptionsMenuItem() {
    if (Date.now() > menuCheckUntil) return;
    // XPath is a fast, built-in text search, so this stays cheap while you type.
    const hit = document.evaluate("//body//*[not(*)][normalize-space(.)='Filevine Settings']",
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const label = hit && isVisible(hit) ? hit : null;
    if (!label) return;
    // Climb to the menu item: the highest parent that does not also hold "Logout".
    let item = label;
    while (item.parentElement && !/Logout/.test(item.parentElement.textContent)) item = item.parentElement;
    if (!item.parentElement || item.parentElement.querySelector('[data-pd9-options]')) return;

    const mine = item.cloneNode(true);
    mine.setAttribute('data-pd9-options', '');
    for (const el of [mine, ...mine.querySelectorAll('*')]) {
      el.removeAttribute('id');
      el.removeAttribute('href');
      el.removeAttribute('data-testid');
      if (el.childElementCount === 0 && el.textContent.trim() === 'Filevine Settings') {
        el.textContent = 'Improver Options ';
        // The version, small and grey, for when someone needs help ("which version do you have?").
        const v = document.createElement('span');
        v.className = 'pd9-ver';
        v.textContent = `(v${typeof GM_info !== 'undefined' ? GM_info.script.version : '?'})`;
        el.appendChild(v);
      }
    }
    mine.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const trigger = $('.fvs-global-avatar-menu-trigger');
      if (trigger) trigger.click(); // close Filevine's menu
      openOptions();
    }, true);
    item.after(mine);

    // "Dark mode: Off/On", right under Improver Options. Clicking it keeps the menu open.
    const dark = item.cloneNode(true);
    dark.setAttribute('data-pd9-dark', '');
    for (const el of [dark, ...dark.querySelectorAll('*')]) {
      el.removeAttribute('id');
      el.removeAttribute('href');
      el.removeAttribute('data-testid');
      if (el.childElementCount === 0 && el.textContent.trim() === 'Filevine Settings') {
        el.textContent = 'Dark mode: ';
        const st = document.createElement('span');
        st.className = 'pd9-dark-state';
        st.textContent = darkOn() ? 'On' : 'Off';
        el.appendChild(st);
      }
    }
    // Swap the copied icon for a moon.
    const ic = dark.querySelector('i.mdis, i[data-testid="material-icon"], i');
    if (ic) { const t = [...ic.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim()); if (t) t.nodeValue = 'dark_mode '; const h = ic.querySelector('.visually-hidden'); if (h) h.textContent = 'slot-text:dark_mode'; }
    dark.title = 'Alt+Shift+D';
    dark.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleDark(); }, true);
    mine.after(dark);
  }

  const escapeAttr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function openOptions() {
    if (document.getElementById('pd9-options')) return;
    let list = TEMPLATES.map((t) => ({ ...t })); // working copy until Save
    let sel = 0;
    let dirty = false;

    const overlay = document.createElement('div');
    overlay.id = 'pd9-options';
    overlay.className = 'pd9-overlay';
    overlay.innerHTML = `
      <div class="pd9-dialog" role="dialog" aria-modal="true" aria-labelledby="pd9-title">
        <div class="pd9-head">
          <h2 id="pd9-title">Improver Options</h2>
          <button type="button" class="pd9-x" aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="pd9-body">
          <div class="pd9-side">
            <div class="pd9-section">Templates</div>
            <ul class="pd9-list" role="listbox" aria-label="Templates"></ul>
            <button type="button" class="pd9-btn pd9-add">+ New template</button>
          </div>
          <div class="pd9-form">
            <label>Button name<input type="text" name="label" maxlength="40"></label>
            <label>Subject<input type="text" name="subject" maxlength="200"></label>
            <label>Type<select name="type"><option value="note">Note</option><option value="call">Call (phone icon)</option></select></label>
            <label>Tags<span class="pd9-tagwrap"><span>#</span><input type="text" name="tag" maxlength="120" placeholder="CLIENTCOMM JAILVISIT"></span></label>
            <label>Shortcut<span class="pd9-tagwrap"><input type="text" name="hotkey" readonly placeholder="Click here, then press keys (like Alt+4)"><button type="button" class="pd9-btn pd9-hk-clear">Clear</button></span></label>
            <label>Note text<textarea name="body" rows="10"></textarea></label>
            <p class="pd9-help">Type <code>{date}</code> for today's date and <code>{|}</code> where the cursor should start. Put a space between tags. Leave Tags empty for no tag. A shortcut starts a note with this template from anywhere in a case.</p>
            <div class="pd9-row">
              <button type="button" class="pd9-btn pd9-up" title="Move up">Move up</button>
              <button type="button" class="pd9-btn pd9-down" title="Move down">Move down</button>
              <button type="button" class="pd9-btn pd9-del">Delete</button>
            </div>
          </div>
        </div>
        <div class="pd9-foot">
          <button type="button" class="pd9-btn pd9-whatsnew-btn" title="See what changed in recent updates">What's new</button>
          <button type="button" class="pd9-btn pd9-reset">Reset to defaults</button>
          <button type="button" class="pd9-btn pd9-export" title="Save your templates to a file">Export</button>
          <button type="button" class="pd9-btn pd9-import" title="Add templates from a file">Import</button>
          <input type="file" class="pd9-file" accept=".json,application/json" hidden>
          <span class="pd9-grow"></span>
          <label class="pd9-zoomopt" title="How big things look inside case windows. Auto shrinks them to fit when Windows display scaling is above 100%.">Case window zoom
            <select class="pd9-zoomsel">${WIN_ZOOM_CHOICES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <button type="button" class="pd9-btn pd9-cancel">Cancel</button>
          <button type="button" class="pd9-btn pd9-primary pd9-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const q = (s) => overlay.querySelector(s);
    q('.pd9-whatsnew-btn').addEventListener('click', () => showWhatsNew(whatsNewItems(''), true));
    const zoomSel = q('.pd9-zoomsel');
    zoomSel.value = String(store.get(WIN_ZOOM_KEY, 'auto'));
    if (!zoomSel.value) zoomSel.value = 'auto';
    // Takes effect right away (it's not part of the templates' Save).
    zoomSel.addEventListener('change', () => {
      store.set(WIN_ZOOM_KEY, zoomSel.value);
      applyWinZoom();
      toast(zoomSel.value === 'auto' ? `Case windows: Auto (${Math.round(winZoom() * 100)}% on this screen)` : `Case windows: ${zoomSel.selectedOptions[0].textContent}`);
    });
    const ul = q('.pd9-list');
    const f = { label: q('[name=label]'), subject: q('[name=subject]'), type: q('[name=type]'), tag: q('[name=tag]'), body: q('[name=body]') };
    const hk = q('[name=hotkey]');
    hk.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!list[sel]) return;
      if (e.key === 'Backspace' || e.key === 'Delete') { list[sel].hotkey = ''; hk.value = ''; dirty = true; drawList(); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // still holding Alt/Shift, wait for the letter or number
      const problem = comboProblem(combo);
      if (problem) { toast(problem); return; }
      const other = list.findIndex((t, i) => i !== sel && t.hotkey === combo);
      if (other >= 0) { toast(`${combo} is already the shortcut for "${list[other].label}".`); return; }
      list[sel].hotkey = combo; hk.value = combo; dirty = true; drawList();
    }, true);
    q('.pd9-hk-clear').addEventListener('click', () => { if (list[sel]) { list[sel].hotkey = ''; hk.value = ''; dirty = true; drawList(); } });

    function drawList() {
      ul.innerHTML = list.map((t, i) =>
        `<li role="option" tabindex="0" data-i="${i}" aria-selected="${i === sel}">${escapeAttr(t.label || 'Untitled')}${t.hotkey ? ` <span class="pd9-hk">${escapeAttr(t.hotkey)}</span>` : ''}</li>`).join('');
      const empty = !list.length;
      Object.values(f).forEach((el) => { el.disabled = empty; });
      ['.pd9-up', '.pd9-down', '.pd9-del'].forEach((s) => { q(s).disabled = empty; });
      if (!empty) {
        q('.pd9-up').disabled = sel === 0;
        q('.pd9-down').disabled = sel === list.length - 1;
      }
    }
    function drawForm() {
      const t = list[sel] || { label: '', subject: '', type: 'note', tag: '', body: '', hotkey: '' };
      f.label.value = t.label; f.subject.value = t.subject; f.type.value = t.type === 'call' ? 'call' : 'note'; f.tag.value = t.tag; f.body.value = t.body;
      hk.value = t.hotkey || ''; hk.disabled = !list[sel];
    }
    function redraw() { drawList(); drawForm(); }

    for (const [key, el] of Object.entries(f)) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        if (!list[sel]) return;
        list[sel][key] = key === 'tag' ? cleanTag(el.value) : el.value;
        dirty = true;
        if (key === 'label') drawList();
      });
    }
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) { sel = +li.dataset.i; redraw(); }
    });
    ul.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); sel = +li.dataset.i; redraw(); } }
    });
    q('.pd9-add').addEventListener('click', () => {
      list.push({ id: newId(), label: 'New template', subject: '', type: 'note', tag: '', body: '', hotkey: '' });
      sel = list.length - 1; dirty = true; redraw(); f.label.select();
    });
    q('.pd9-del').addEventListener('click', () => {
      if (!list[sel] || !confirm(`Delete the "${list[sel].label}" template?`)) return;
      list.splice(sel, 1); sel = Math.max(0, sel - 1); dirty = true; redraw();
    });
    const move = (d) => {
      const j = sel + d;
      if (j < 0 || j >= list.length) return;
      [list[sel], list[j]] = [list[j], list[sel]]; sel = j; dirty = true; redraw();
    };
    q('.pd9-up').addEventListener('click', () => move(-1));
    q('.pd9-down').addEventListener('click', () => move(1));
    q('.pd9-reset').addEventListener('click', () => {
      if (!confirm('Replace your templates with the office defaults?')) return;
      list = DEFAULT_TEMPLATES.map((t) => ({ ...t, id: newId() })); sel = 0; dirty = true; redraw();
    });

    // Export: download the templates in this window as a .json file.
    q('.pd9-export').addEventListener('click', () => {
      const data = { app: 'pd9-filevine-improver', exported: new Date().toISOString(),
        templates: list.map(({ label, subject, tag, body, hotkey }) => ({ label, subject, tag, body, hotkey: hotkey || '' })) };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      a.download = `pd9-templates-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Exported ${list.length} template${list.length === 1 ? '' : 's'}.`);
    });

    // Import: add templates from a file to this list. Nothing is replaced, and
    // nothing is kept until you click Save. Exact duplicates are skipped.
    const fileInput = q('.pd9-file');
    q('.pd9-import').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        if (file.size > 1e6) throw new Error('too big');
        const parsed = JSON.parse(await file.text());
        const items = Array.isArray(parsed) ? parsed : parsed && parsed.templates;
        if (!Array.isArray(items)) throw new Error('no templates');
        const text = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
        const same = (x, y) => x.label === y.label && x.subject === y.subject && x.tag === y.tag && x.body === y.body;
        let added = 0, skipped = 0;
        for (const raw of items.slice(0, 100)) {
          const t = { id: newId(), label: text(raw && raw.label, 40).trim(), subject: text(raw && raw.subject, 200),
            type: raw && raw.type === 'call' ? 'call' : 'note', tag: cleanTag(text(raw && raw.tag, 120)), body: text(raw && raw.body, 20000), hotkey: '' };
          if (!t.label) { skipped++; continue; }
          if (list.some((x) => same(x, t))) { skipped++; continue; }
          const hkIn = text(raw && raw.hotkey, 20);
          if (hkIn && !comboProblem(hkIn) && !list.some((x) => x.hotkey === hkIn)) t.hotkey = hkIn;
          list.push(t); added++;
        }
        if (added) { sel = list.length - added; dirty = true; redraw(); }
        toast(added
          ? `Added ${added} template${added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}. Click Save to keep them.`
          : 'Nothing new to add from that file.');
      } catch (err) {
        toast('That file is not a PD9 templates export.');
      }
    });

    function close(force) {
      if (!force && dirty && !confirm('Close without saving your changes?')) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    }
    document.addEventListener('keydown', onKey, true);
    q('.pd9-x').addEventListener('click', () => close(false));
    q('.pd9-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });

    q('.pd9-save').addEventListener('click', () => {
      const bad = list.findIndex((t) => !t.label.trim());
      if (bad >= 0) { sel = bad; redraw(); f.label.focus(); toast('Every template needs a button name.'); return; }
      TEMPLATES = list.map((t) => ({ ...t, label: t.label.trim(), tag: cleanTag(t.tag) }));
      store.set(TEMPLATES_KEY, TEMPLATES);
      $$('.fvqn-wrap').forEach((w) => w.remove()); // rebuild the template rows
      decorate();
      toast('Templates saved.');
      close(true);
    });

    redraw();
    f.label.focus();
  }

  // ---------- "Improved Close" on the Sentence tab ----------
  // One button runs the office's closing steps:
  //   1. opens a new Sentence item and fills the safe parts (dates, notes outline)
  //   2. shows hints next to the fields that need judgment
  //   3. after you click Create, offers to set the phase to Closed and takes you
  //      to Case Summary with User Status highlighted
  const CLOSE_FILL = {
    sentenceDateToday: true,     // Sentence date = today (change it if sentencing was earlier)
    dispositionDateToday: true,  // Disposition Date = today
    notesOutline: '',            // text to start Disposition Notes with ('' = leave it empty)
  };
  // Short reminders from the office closing guide, shown under each label.
  const CLOSE_HINTS = {
    dispositionaction: 'How the case resolved: negotiated plea, nolle pros, jury trial not guilty, etc.',
    sentencetype: 'Pick the harsher part (county jail then probation = County Jail). Put the rest in Disposition Notes.',
    dispositiontype: 'Most serious charge resolved, and the most serious charge you worked up.',
    dispositionnotes: 'The rest of the sentence that Sentence Type does not cover.',
  };

  const onSentenceTab = () => /\/custom\/[^/?#]*sentence/i.test(location.href);
  const sentenceForm = () => [...document.querySelectorAll('form.project-item-edit-form')]
    .find((f) => f.querySelector('[name^="sentencetype"]') && f.querySelector('[name^="dispositionaction"]')) || null;
  const fieldIn = (form, prefix) => [...form.querySelectorAll(`[name^="${prefix}"]`)]
    .find((el) => /^\D+\d+$/.test(el.name) && el.name.replace(/\d+$/, '') === prefix) || null;

  function addCloseButton() {
    if (!onSentenceTab()) return;
    const add = document.getElementById('add-an-item');
    if (!add || document.getElementById('pd9-improved-close')) return;
    const btn = add.cloneNode(false); // same Filevine button style, none of its behavior
    btn.id = 'pd9-improved-close';
    btn.removeAttribute('ng-click');
    btn.className = add.className;
    btn.innerHTML = '<i class="fa fa-flag-checkered"></i> Improved Close';
    btn.title = 'Start a closing Sentence entry, then finish closing the case';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); startImprovedClose(); });
    add.after(btn);
  }

  // Type into an Angular or Svelte field so Filevine notices.
  function setFieldValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  }

  const mdY = (d = new Date()) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

  let closeFlow = null; // { projectId } while a closing entry is being filled out

  async function startImprovedClose() {
    let form = sentenceForm();
    if (!form) {
      const add = document.getElementById('add-an-item');
      if (!add) { toast('Could not find "Add an Item" on this tab.'); return; }
      add.click();
      form = await waitFor(sentenceForm, 4000);
      if (!form) { toast('The Sentence form did not open.'); return; }
    }
    await sleep(150); // let Filevine finish drawing the form

    const fill = (prefix, value) => {
      const el = fieldIn(form, prefix);
      if (el && !el.value.trim()) setFieldValue(el, value);
    };
    if (CLOSE_FILL.sentenceDateToday) fill('sentencedate', mdY());
    if (CLOSE_FILL.dispositionDateToday) fill('dispositiondate', mdY());
    if (CLOSE_FILL.notesOutline) fill('dispositionnotes', CLOSE_FILL.notesOutline);

    closeFlow = { projectId: projectId() };
    const first = fieldIn(form, 'dispositionaction');
    if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.focus(); }
    toast('Fill in the rest, then click Create.');
  }

  // Hints under the labels of the Sentence form (shown any time the form is open).
  function addCloseHints() {
    if (!onSentenceTab()) return;
    const form = sentenceForm();
    if (!form) return;
    for (const [prefix, text] of Object.entries(CLOSE_HINTS)) {
      const el = fieldIn(form, prefix);
      const label = el && form.querySelector(`#label-${CSS.escape(el.name)}`);
      const holder = label && (label.closest('field-label') || label).parentElement;
      if (!holder || holder.nextElementSibling?.classList.contains('pd9-hint')) continue;
      const hint = document.createElement('div');
      hint.className = 'pd9-hint';
      hint.textContent = text;
      holder.after(hint);
    }
  }

  // Watch for Create on the Sentence form while a close is in progress.
  document.addEventListener('click', async (e) => {
    if (!closeFlow) return;
    const btn = e.target.closest && e.target.closest('#collection-top-save, #collection-bottom-save');
    if (!btn || btn.disabled) return;
    const flow = closeFlow;
    // Saved = the form goes away. If it is still there after 10 seconds,
    // something needs fixing (a required field), so we wait for the next Create.
    const gone = await waitFor(() => !sentenceForm(), 10000);
    if (gone && closeFlow === flow && projectId() === flow.projectId) {
      closeFlow = null;
      finishClose(flow.projectId);
    }
  }, true);

  const phaseSelect = () => $('[data-testid="project-phase-selector"] select');
  const phaseText = () => { const t = $('[data-testid="project-phase-selector"] .text-container'); return t ? t.textContent.trim() : ''; };

  function selectByText(select, text) {
    const opt = [...select.options].find((o) => o.textContent.trim().toLowerCase() === text.toLowerCase());
    if (!opt) return false;
    if (select.value !== opt.value) {
      select.value = opt.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function findUserStatus() {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'User Status' && isVisible(l));
    if (!label) return null;
    const field = label.closest('.custom-field') || label.parentElement.parentElement;
    return { field, select: field.querySelector('select') };
  }

  // The Save button for the section that holds this field.
  function findSectionSave(el) {
    const isSave = (b) => isVisible(b) && /^save$/i.test(b.textContent.trim());
    const form = el.closest('form');
    return (form && [...form.querySelectorAll('button')].find(isSave)) ||
      [...document.querySelectorAll('#collection-top-save, #collection-bottom-save, button')].find(isSave) || null;
  }

  function flash(el, on) { if (el) el.classList.toggle('pd9-flash', on); }

  // After the Sentence entry saves: go to Case Summary, set User Status and the
  // phase to Closed, then ask the person to double-check before saving.
  async function finishClose(pid) {
    toast('Sentence saved. Opening Case Summary...');
    const link = $('a[href*="/custom/casesummary"]');
    if (link && !/\/custom\/casesummary/.test(location.href)) location.hash = new URL(link.href, location.href).hash;

    const us = await waitFor(() => { const f = findUserStatus(); return f && f.select ? f : null; }, 8000);
    if (projectId() !== pid) return; // moved to another case, stop
    const usSet = us ? selectByText(us.select, 'Closed') : false;

    const ps = phaseSelect();
    const wasPhase = phaseText();
    const canPhase = !!(ps && [...ps.options].some((o) => o.textContent.trim().toLowerCase() === 'closed'));

    const phaseBox = $('[data-testid="project-phase-selector"]');
    if (us) { us.field.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(us.field, true); }
    flash(phaseBox, true);

    // A small panel in the corner, so the highlighted fields stay visible.
    const panel = document.createElement('div');
    panel.className = 'pd9-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Double-check before saving');
    const row = (ok, text) => `<li class="${ok ? '' : 'pd9-warn'}">${ok ? '&#10003;' : '!'} ${text}</li>`;
    panel.innerHTML = `
      <h3>Double-check before saving</h3>
      <ul>
        ${row(usSet, usSet ? 'User Status set to <b>Closed</b> (outlined in orange)' : 'Could not set User Status. Pick <b>Closed</b> yourself.')}
        ${row(canPhase, canPhase ? `Phase will change from <b>${escapeAttr(wasPhase || 'Open')}</b> to <b>Closed</b>` : 'Could not find the phase picker. Change it at the top of the case.')}
      </ul>
      <div class="pd9-panel-btns">
        <button type="button" class="pd9-btn pd9-cancel">Cancel</button>
        <button type="button" class="pd9-btn pd9-primary pd9-go">Save and close case</button>
      </div>`;
    document.body.appendChild(panel);
    const q = (sel) => panel.querySelector(sel);
    const done = () => { panel.remove(); flash(us && us.field, false); flash(phaseBox, false); };
    q('.pd9-cancel').addEventListener('click', () => { done(); toast('Nothing saved. User Status was changed but not saved.'); });
    q('.pd9-go').addEventListener('click', async () => {
      q('.pd9-go').disabled = true;
      q('.pd9-go').textContent = 'Saving...';

      // 1) Save Case Summary.
      let saved = true;
      if (us) {
        const save = await waitFor(() => { const b = findSectionSave(us.select); return b && !b.disabled ? b : null; }, 3000);
        if (save) {
          save.click();
          // Saved = the button settles back to disabled, or the section redraws.
          saved = !!(await waitFor(() => !document.contains(save) || save.disabled, 8000));
        } else {
          saved = false;
        }
      }

      // 2) Change the phase (Filevine saves this one on its own).
      let phased = !canPhase;
      if (canPhase) {
        selectByText(phaseSelect(), 'Closed');
        phased = !!(await waitFor(() => phaseText().toLowerCase() === 'closed', 5000));
      }

      done();
      toast(saved && phased
        ? 'Case closed: User Status and phase are both Closed.'
        : `Check the case: ${saved ? '' : 'Case Summary may not have saved. '}${phased ? '' : 'Phase may not have changed.'}`.trim());
    });
    q('.pd9-go').focus();
  }

  // ---------- case numbers: one reader for every format we've seen ----------
  //   24-CF-001234-A-OS    2026-OC-000123-A-OS    07CT004567AOS    06DF000789AOS
  //   24 CF 1234 A OS      24cf1234               2024-CF-1234
  // Parts: year (2 or 4 digits), court type (2 letters), number (up to 7 digits,
  // often zero-padded to 6), defendant letter (optional), county (optional, OR/OS).
  const CASE_PART_RX = /(?<![a-z0-9])(\d{4}|\d{2})[\s\-_]*([a-z]{2})[\s\-_]*(\d{1,7})(?:[\s\-_]*([a-z])[\s\-_]*([a-z]{1,2})|[\s\-_]*([a-z]))?(?![a-z0-9])/gi; // suffix: -A-OS, AOS, -AO (Orange), or -A

  const twoDigitYear = (y) => (y.length === 4 ? y.slice(2) : y);
  const stripZeros = (n) => n.replace(/^0+(?=\d)/, '');

  // Every case number found in a piece of text, normalized.
  function readCaseNumbers(text) {
    const out = [];
    for (const m of String(text || '').matchAll(CASE_PART_RX)) {
      const [, year, type, num, def, county, defOnly] = m;
      out.push({
        raw: m[0],
        year: twoDigitYear(year),
        type: type.toUpperCase(),
        num: stripZeros(num),
        def: (def || defOnly || '').toUpperCase(),
        county: (county || '').toUpperCase(),
      });
    }
    return out;
  }

  // What someone typed into Case# Search, STAC style. Returns a list of possible
  // meanings (an all-digit entry like 20261234 could be year 2026 or year 20).
  //   241234      -> year 24, number 1234 (001234), any type, any county
  //   24cf1234    -> also type CF
  //   24cf1234os  -> also county OS (24cf1234aos / 24-CF-001234-A-OS work too)
  function readCaseQuery(input) {
    const t = String(input || '').trim().toUpperCase().replace(/[\s\-_|]+/g, '');
    if (!t) return [];
    let m = t.match(/^(\d{4}|\d{2})([A-Z]{2})(\d{1,7})(?:([A-Z])?([A-Z]{2}))?$|^(\d{4}|\d{2})([A-Z]{2})(\d{1,7})([A-Z])$/);
    if (m) {
      if (m[1]) return [{ year: twoDigitYear(m[1]), type: m[2], num: stripZeros(m[3]), def: m[4] || '', county: m[5] || '' }];
      return [{ year: twoDigitYear(m[6]), type: m[7], num: stripZeros(m[8]), def: m[9], county: '' }];
    }
    m = t.match(/^(\d+)$/);
    if (!m || t.length < 3) return [];
    const options = [{ year: t.slice(0, 2), type: '', num: stripZeros(t.slice(2)), def: '', county: '' }];
    const y4 = +t.slice(0, 4);
    if (t.length >= 7 && y4 >= 1990 && y4 <= new Date().getFullYear() + 1) {
      options.push({ year: t.slice(2, 4), type: '', num: stripZeros(t.slice(4)), def: '', county: '' });
    }
    return options;
  }

  // Does a case number fit what was typed? Same year and the same number
  // (leading zeros don't matter: 1234 = 001234). Type, defendant letter, and
  // county only count if you typed them.
  function caseFits(q, c) {
    return c.year === q.year && c.num === q.num &&
      (!q.type || c.type === q.type) && (!q.def || c.def === q.def) && (!q.county || c.county === q.county);
  }
  // Text of an element with a space between lines and blocks, so "...AOS" and the
  // next line never run together ("000123AOSJohn"). Highlighting inside a line
  // (Filevine wraps matches in <mark>, like 25-CF-0<mark>01234</mark>) is joined
  // with no space, so the case number stays in one piece.
  const INLINE_TAGS = new Set(['MARK', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'SMALL', 'SUB', 'SUP', 'ABBR', 'CODE', 'FONT', 'LABEL']);
  function spacedText(el) {
    let out = '';
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        const inline = INLINE_TAGS.has(n.tagName);
        if (!inline || n.tagName === 'BR') out += ' ';
        walk(n);
        if (!inline) out += ' ';
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }


  // ---------- Case # Search: filtering Filevine's dropdown ----------
  // While a Case # Search is showing, hide dropdown results whose title doesn't
  // have the right case number. Typing anything yourself turns this off.
  let caseFilter = null; // { query, entry }

  const searchInput = () => document.getElementById('header-search-input');
  function resultItems() {
    const input = searchInput();
    const box = input && document.getElementById(input.getAttribute('aria-controls'));
    if (!box || !isVisible(box)) return { box: null, items: [], loading: false };
    const loading = !!box.querySelector('[data-testid="fv-loading-spinner"], .loading-spinner');
    // Result rows are the list's options (or its direct children). Only rows that
    // look like a case ("Name | Case #" or a case number) are filtered; others are left alone.
    const options = box.querySelectorAll('[role="option"]');
    const rows = options.length ? [...options] : [...box.children];
    const looksLikeCase = (t) => t.includes('|') || readCaseNumbers(t).length > 0;
    return { box, items: rows.filter((el) => looksLikeCase(spacedText(el))), loading };
  }

  function caseBadge(text) {
    let badge = document.getElementById('pd9-case-badge');
    const input = searchInput();
    if (!text || !input) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pd9-case-badge';
      document.body.appendChild(badge);
    }
    // Sit just left of the search box, in the header, so it never covers results.
    const r = input.getBoundingClientRect();
    badge.style.right = `${Math.round(window.innerWidth - r.left + 8)}px`;
    badge.style.top = `${Math.round(r.top + r.height / 2 - 11)}px`;
    if (badge.textContent !== text) badge.textContent = text;
  }

  function applyCaseFilter() {
    const input = searchInput();
    if (!caseFilter) return;
    if (!input || !input.value || input.value !== caseFilter.query) { // search changed or cleared: show everything again
      document.querySelectorAll('[data-pd9-hidden]').forEach((el) => { el.style.display = ''; el.removeAttribute('data-pd9-hidden'); });
      caseFilter = null;
      caseBadge('');
      return;
    }
    const { box, items, loading } = resultItems();
    if (!box) { caseBadge(''); return; } // dropdown closed
    if (!items.length) { caseBadge(loading ? 'Case # Search: searching...' : ''); return; }

    const keep = items.filter((el) => titleFitsCase(spacedText(el), caseFilter.entry));
    for (const el of items) {
      const hide = !keep.includes(el);
      if (hide && el.style.display !== 'none') { el.style.display = 'none'; el.setAttribute('data-pd9-hidden', ''); }
      if (!hide && el.hasAttribute('data-pd9-hidden')) { el.style.display = ''; el.removeAttribute('data-pd9-hidden'); }
    }
    caseBadge(keep.length
      ? `Case # Search: ${keep.length} match${keep.length === 1 ? '' : 'es'}`
      : loading ? 'Case # Search: searching...' : 'Case # Search: no case with that number. Try Include Archived');
  }

  store.set('pd9-find-last', null); // earlier versions remembered searches; forget them

  // ---------- Case# Search (STAC style) ----------
  // Type 241234, 24cf1234, 24cf1234os, or a full case number. We type a precise
  // search into Filevine's own search box and show only real matches.

  // What we hand Filevine's search. It uses Filevine's search syntax: a backtick
  // turns it on, quotes + ~1 mean "these words next to each other, with at most
  // one word between", and | means "or". In a title, the year and the number sit
  // side by side (25-CF-003767), so this finds case numbers but skips stray
  // dates in the details line (10/31/2025).
  //   253767      ->  `"25 003767"~1 | "2025 003767"~1
  //   25cf3767    ->  `"25 CF 003767" | "2025 CF 003767"
  // County (OS/OR) and anything that still slips through are checked afterward
  // against each result's title.
  function caseSearchTerms(qs) {
    // An all-digit entry like 20261234 could mean 2026 or 20; go with the 4-digit year.
    const q = qs[qs.length - 1];
    const num = q.num.length < 6 ? q.num.padStart(6, '0') : q.num;
    const fullYear = `${+q.year > 50 ? '19' : '20'}${q.year}`;
    const phrase = (y) => (q.type ? `"${y} ${q.type} ${num}"` : `"${y} ${num}"~1`);
    return `\`${phrase(q.year)} | ${phrase(fullYear)}`;
  }


  // Tick Include Archived BEFORE typing, so Filevine runs one search (archived
  // included) instead of two: a normal one, then a second when the box gets
  // ticked. Two overlapping searches are what blank out the search box.
  async function runCaseSearch(input, query, entry) {
    input.focus();
    const t = await waitFor(() => {
      const label = [...document.querySelectorAll('.include-label')].find((el) => isVisible(el));
      const box = label && label.closest('label') && label.closest('label').querySelector('input[type=checkbox]');
      return box && !box.disabled ? { label, box } : null;
    }, 1500);
    if (t && !t.box.checked) {
      t.label.click(); // the words, not the square
      await waitFor(() => t.box.checked, 1000);
    }
    caseFilter = { query, entry };
    input.focus();
    setInputValue(input, query);
    input.dispatchEvent(new KeyboardEvent('keyup', { key: query.slice(-1), bubbles: true }));
    applyCaseFilter();
    // Backup: if the box wasn't there to tick up front, tick it once loading allows.
    if (!t) includeArchivedFor(query);
  }


  // ---------- patch: search box goes blank after "Include Archived" ----------
  // Filevine bug: if a search is still loading when Include Archived changes,
  // the dropdown redraws with the text and checkbox hidden, and the search
  // looks dead. Filevine still has the text and the tick; clicking back into
  // the search box brings them back and the search finishes. So after any
  // Include Archived click, if things went blank, we click back into the box.
  // We never retype the text (that would start yet another search).
  const PATCH_BLANK_SEARCH = true;
  function searchLooksBlank() {
    const input = searchInput();
    if (!input) return false;
    const label = [...document.querySelectorAll('.include-label')].find((el) => isVisible(el));
    const box = label && label.closest('label') && label.closest('label').querySelector('.custom-checkbox, input[type=checkbox]');
    return !input.value || !label || !box || !isVisible(box);
  }
  function wakeSearchBox() {
    const input = searchInput();
    if (!input) return;
    input.focus();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    input.click();
  }
  document.addEventListener('click', (e) => {
    if (!PATCH_BLANK_SEARCH) return;
    const label = e.target.closest && e.target.closest('label');
    if (!label || !label.querySelector('.include-label')) return;
    for (const ms of [300, 900, 2000]) {
      setTimeout(() => { if (searchLooksBlank()) wakeSearchBox(); }, ms);
    }
  }, true);

  // Tick "Include Archived" for this search by clicking the WORDS "Include
  // Archived" (clicking the square itself trips a Filevine bug). Filevine greys
  // it out while a search is loading, so we wait until it's clickable.
  async function includeArchivedFor(query) {
    const findBox = () => {
      const label = [...document.querySelectorAll('.include-label')].find((el) => isVisible(el));
      const box = label && label.closest('label') && label.closest('label').querySelector('input[type=checkbox]');
      return box ? { label, box } : null;
    };
    const stillThisSearch = () => caseFilter && caseFilter.query === query && (searchInput() || {}).value === query;
    const ready = await waitFor(() => {
      if (!stillThisSearch()) return 'stop';
      const t = findBox();
      return t && !t.box.disabled ? t : null;
    }, 120000);
    if (!ready || ready === 'stop' || ready.box.checked) return;
    ready.label.click();
  }

  // Only the case number in the title counts: the first one after the "|".
  function titleFitsCase(text, entry) {
    const bar = text.indexOf('|');
    if (bar < 0) return false;
    const first = readCaseNumbers(text.slice(bar + 1))[0];
    return !!first && readCaseQuery(entry).some((q) => caseFits(q, first));
  }

  const MAGNIFIER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function addCaseSearchButton() {
    const input = searchInput();
    if (!input || document.getElementById('pd9-case-btn')) return;
    const host = input.closest('.search') || input.closest('.fvs-autocomplete') || input.parentElement;
    const make = (id, text, title, mode) => {
      const btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.className = 'pd9-head-btn';
      btn.title = title;
      btn.innerHTML = `${MAGNIFIER}<span>${text}</span>`;
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleSearchPanel(btn, mode); });
      return btn;
    };
    const caseBtn = make('pd9-case-btn', 'Case # Search', 'Search by case number, like STAC (241234, 24cf1234, 24-CF-001234-A-OS)', 'case');
    const nameBtn = make('pd9-name-btn', 'Name Search', 'Search case names (any order, partial names work)', 'name');
    host.after(caseBtn);
    caseBtn.after(nameBtn);
  }


  const SEARCH_MODES = {
    case: {
      label: 'Case number',
      help: 'Year + number finds every court type and county: <b>241234</b> finds 24-CF-001234, 24-MM-001234, and so on. Narrow it with the type or county: <b>24cf1234</b>, <b>24cf1234os</b>.',
      check: (entry) => (readCaseQuery(entry).length ? '' : 'Type a case number like 241234, 24cf1234, or 24-CF-001234-A-OS.'),
      queries: (entry) => [caseSearchTerms(readCaseQuery(entry))],
      keep: (hit, entry) => titleFitsCase(hit.title, entry),
      none: 'No case with that number. Check the year and number.',
      fallback: (entry) => { const input = searchInput(); if (input) runCaseSearch(input, caseSearchTerms(readCaseQuery(entry)), entry); },
    },
    name: {
      label: 'Name',
      help: 'Any order, partial names work: <b>john doe</b>, <b>doe, john</b>, <b>joh do</b>. Middle names count too.',
      check: (entry) => (nameWords(entry).length ? '' : 'Type at least part of a name.'),
      // Strictest first: every word required, as the start of a word. If that
      // finds nothing, loosen up so Filevine's spelling help can kick in.
      queries: (entry) => {
        const w = nameWords(entry);
        return [`\`${w.map((x) => `+${x}*`).join(' ')}`, `\`${w.map((x) => `+${x}`).join(' ')}`, w.join(' ')];
      },
      keep: (hit, entry) => nameFits(hit, entry),
      none: 'No case names match all of those words.',
      fallback: null,
    },
  };

  // Name words: letters only, so "Doe, John" and "john  doe" read the same.
  const nameWords = (t) => fold(t).split(/[^a-z0-9'-]+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
  const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Every word you typed must start a word in the case name (the part before the
  // "|") or the client's full name, so middle names count.
  function nameFits(hit, entry) {
    const have = nameWords(`${hit.title.split('|')[0]} ${hit.clientName || ''}`);
    return nameWords(entry).every((w) => have.some((h) => h.startsWith(w)));
  }

  function toggleSearchPanel(btn, mode) {
    const open = document.getElementById('pd9-case');
    if (open) {
      const same = open.dataset.mode === mode;
      open.remove();
      if (same) return;
    }
    const m = SEARCH_MODES[mode];
    const panel = document.createElement('div');
    panel.id = 'pd9-case';
    panel.dataset.mode = mode;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', mode === 'case' ? 'Case # Search' : 'Name Search');
    panel.innerHTML = `
      <label>${m.label}<input name="q" autocomplete="off" spellcheck="false"></label>
      <p class="pd9-case-help">${m.help}</p>
      <div class="pd9-panel-btns">
        ${mode === 'name' ? '<button type="button" class="pd9-btn pd9-adv-open">Advanced search</button><span class="pd9-grow"></span>' : ''}
        <button type="button" class="pd9-btn pd9-primary pd9-go">Search</button>
      </div>
      <div class="pd9-case-results" aria-live="polite"></div>`;
    document.body.appendChild(panel);
    const advBtn = panel.querySelector('.pd9-adv-open');
    if (advBtn) advBtn.addEventListener('click', () => { const v = panel.querySelector('input').value.trim(); panel.remove(); openAdvanced(v); });
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.left = `${Math.max(8, Math.round(Math.min(r.left, window.innerWidth - 420)))}px`;
    const input = panel.querySelector('input');
    input.focus();
    const go = () => {
      const entry = input.value.trim();
      const problem = m.check(entry);
      if (problem) { toast(problem); input.focus(); return; }
      searchDirect(entry, panel, m);
    };
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); go(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); panel.remove(); btn.focus(); }
    });
    panel.querySelector('.pd9-go').addEventListener('click', go);
    setTimeout(() => document.addEventListener('mousedown', function away(e) {
      if (!panel.isConnected) return document.removeEventListener('mousedown', away, true);
      if (!panel.contains(e.target) && !e.target.closest('.pd9-head-btn')) { panel.remove(); document.removeEventListener('mousedown', away, true); }
    }, true), 0);
  }

  // ---------- open a case the fast way (search results) ----------
  // Same speed-ups as the PD9 table: Window mode opens a case window (from a warm
  // spare, preloaded on hover); on the Project Hub it uses the one shared case tab;
  // anywhere else it switches the tab you're in (Filevine is already loaded).
  // Ctrl/Cmd/Shift/middle click still open a new tab the normal way.
  function wireCaseLink(a, id, title, onOpen) {
    a.href = `#/project/${encodeURIComponent(id)}/activity`;
    a.addEventListener('mouseenter', () => { if (!IN_FRAME && windowMode() && onHub()) prefetchCase(id); });
    a.addEventListener('mouseleave', () => clearTimeout(prefetchTimer));
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (onOpen) onOpen();
      if (!IN_FRAME && windowMode() && onHub()) openCaseWindow(String(id), title || `Case ${id}`);
      else if (!IN_FRAME && onHub()) window.open(`${location.origin}${location.pathname}#/project/${encodeURIComponent(id)}/activity`, CASE_TAB);
      else location.hash = `#/project/${encodeURIComponent(id)}/activity`;
      rememberRecent(id);
    });
  }

  // Filevine's answers, remembered for 5 minutes, so searching the same thing again is instant.
  const suggestCache = new Map();

  // Your own cases (the Project Hub list every tab shares) that match, shown instantly.
  function myCaseHits(entry, mode) {
    try { readSwitchCache(); } catch (e) { return []; }
    const rows = switchList || [];
    return rows.map((r) => ({ r, sc: switchScore(r, entry) }))
      .filter((x) => x.sc >= (mode === 'case' ? 55 : 50))
      .sort((a, b) => b.sc - a.sc || b.r.lastActivity - a.r.lastActivity)
      .slice(0, 15)
      .map(({ r }) => ({ id: r.id, title: `${r.name || ''} | ${r.caseNo}`, details: r.last ? `${r.last} \u00b7 your case` : 'Your case', mine: true }));
  }

  // Ask Filevine's search directly (the same address its dropdown uses), with
  // archived cases included, and list only real matches. One request at a time,
  // no checkbox, none of the dropdown's bugs.
  let searchRequest = null;
  const htmlToText = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';

  async function askFilevine(query, signal, archived = true) {
    const url = `/api/suggest?q=${encodeURIComponent(query)}&onlyBillingEligible=false&archived=${archived ? 'true' : 'false'}`;
    const cached = suggestCache.get(url);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
    const res = await fetch(url, { credentials: 'include', signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    if (!json || json.success === false || !Array.isArray(json.data)) throw new Error('unexpected reply');
    const data = json.data.map((d) => ({ id: d.id, title: htmlToText(d.title), details: htmlToText(d.details), clientName: htmlToText(d.clientName), clientID: d.clientID || null, orgID: d.orgID || null }));
    suggestCache.set(url, { at: Date.now(), data });
    if (suggestCache.size > 60) suggestCache.delete(suggestCache.keys().next().value);
    return data;
  }

  function drawHitList(out, hits, panel, label) {
    out.querySelectorAll('.pd9-case-list, .pd9-case-mine').forEach((x) => x.remove());
    if (label) { const l = document.createElement('div'); l.className = 'pd9-case-mine'; l.textContent = label; out.appendChild(l); }
    const list = document.createElement('ul');
    list.className = 'pd9-case-list';
    for (const h of hits) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const t = document.createElement('span');
      t.className = 'pd9-case-title';
      t.textContent = h.title;
      const d = document.createElement('span');
      d.className = 'pd9-case-details';
      d.textContent = h.details;
      a.append(t, d);
      if (h.mine) li.classList.add('pd9-hit-mine');
      // Plain click: open it the fast way and close. Ctrl/Cmd/middle-click opens a new tab as usual.
      wireCaseLink(a, h.id, `${(h.title.split('|')[1] || '').trim()}  ${(h.title.split('|')[0] || '').trim()}`.trim(), () => setTimeout(() => panel.remove(), 0));
      li.appendChild(a);
      list.appendChild(li);
    }
    out.appendChild(list);
  }

  async function searchDirect(entry, panel, m) {
    const out = panel.querySelector('.pd9-case-results');
    const go = panel.querySelector('.pd9-go');
    if (searchRequest) searchRequest.abort();
    const ctrl = new AbortController();
    searchRequest = ctrl;

    const started = Date.now();
    const mode = m === SEARCH_MODES.case ? 'case' : 'name';
    const mine = myCaseHits(entry, mode);
    out.innerHTML = '<div class="pd9-case-status"><span class="pd9-spin" aria-hidden="true"></span><span class="pd9-case-wait">Searching, including archived...</span></div>';
    if (mine.length) drawHitList(out, mine, panel, 'Your cases (instant)');
    const tick = setInterval(() => {
      const w = out.querySelector('.pd9-case-wait');
      if (w) w.textContent = `Searching, including archived... ${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
    go.disabled = true;

    let hits = [];
    let gotBack = 0;
    try {
      for (const q of m.queries(entry)) {
        const data = await askFilevine(q, ctrl.signal);
        gotBack = data.length;
        hits = data.filter((h) => h.id && m.keep(h, entry));
        if (hits.length) break;
      }
    } catch (err) {
      clearInterval(tick);
      go.disabled = false;
      if (err.name === 'AbortError') return;
      if (mine.length) { // your cases are already showing; just say the rest didn't come
        const st = out.querySelector('.pd9-case-status');
        if (st) st.textContent = 'Filevine did not answer, so only your cases are shown.';
        return;
      }
      if (m.fallback) {
        panel.remove();
        toast('Direct search failed, using the search box instead.');
        m.fallback(entry);
      } else {
        out.textContent = 'Filevine did not answer. Try again in a moment, or use the regular search box.';
      }
      return;
    } finally {
      if (searchRequest === ctrl) searchRequest = null;
    }
    clearInterval(tick);
    go.disabled = false;
    if (!panel.isConnected) return;

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    out.textContent = '';
    const head = document.createElement('div');
    head.className = 'pd9-case-status';
    head.textContent = hits.length ? `${hits.length} case${hits.length === 1 ? '' : 's'} found (${secs}s)` : `${m.none} (${secs}s)`;
    out.appendChild(head);

    // Your cases first (already shown instantly), then everything else Filevine found.
    const mineIds = new Set(mine.map((x) => String(x.id)));
    const merged = [...mine, ...hits.filter((h) => !mineIds.has(String(h.id)))];
    head.textContent = merged.length ? `${merged.length} case${merged.length === 1 ? '' : 's'} found (${secs}s)` : `${m.none} (${secs}s)`;
    drawHitList(out, merged, panel, '');
    if (gotBack >= 10) {
      const more = document.createElement('div');
      more.className = 'pd9-case-note';
      more.textContent = m === SEARCH_MODES.case
        ? 'Filevine only sends its top results. If a case is missing, add the court type (like 24cf1234).'
        : 'Filevine only sends its top results. If someone is missing, add more of the name (like a middle name).';
      out.appendChild(more);
    }
  }


  // ---------- Advanced Name Search (a window that stays open between pages) ----------
  // Like the note box: it stays put while you move around Filevine, and comes
  // back after a reload in the same tab. Shows a table of every matching case.
  const ADV_KEY = 'pd9-adv';
  const advState = () => { try { return JSON.parse(sessionStorage.getItem(ADV_KEY) || 'null') || {}; } catch (e) { return {}; } };
  let advOpen = !!advState().open; // kept in memory so page changes don't reread storage
  const saveAdv = (patch) => {
    if ('open' in patch) advOpen = !!patch.open;
    try { sessionStorage.setItem(ADV_KEY, JSON.stringify({ ...advState(), ...patch })); } catch (e) { /* ignore */ }
  };

  // Filevine's details line: "Full Name • Attorney (@handle) • Open • 9/8/2026 • Org • PD • #CF, #DIV12A"
  function readDetails(hit) {
    const parts = hit.details.split('•').map((t) => t.trim());
    const tags = (parts[6] || '').split(',').map((t) => t.trim()).filter(Boolean);
    const cn = readCaseNumbers(hit.title.split('|').slice(1).join('|'))[0];
    return {
      name: hit.clientName || parts[0] || hit.title.split('|')[0].trim(),
      caseNo: (hit.title.split('|')[1] || '').trim(),
      type: cn ? cn.type : '',
      county: cn ? ({ OS: 'Osceola', OR: 'Orange' }[cn.county] || cn.county) : '',
      attorney: (parts[1] || '').replace(/\s*\(@[^)]*\)\s*/, ''),
      status: parts[2] || '',
      date: parts[3] || '',
      tags: tags.join(' '),
      apd: hit.extra ? hit.extra.apd : '...',
      userStatus: hit.extra ? hit.extra.userStatus : '...',
      dob: hit.extra ? hit.extra.dob : '...',
      disposition: hit.extra ? hit.extra.disposition : '...',
      charges: hit.extra && hit.extra.charges !== undefined ? hit.extra.charges : '...',
    };
  }

  // ---------- extra details per case (Case Summary) ----------
  // Filevine loads Case Summary from /api/projects/<id>/custom/casesummary886.
  // Field names end in a number (apd10682), so we match the start of the name.
  const CASE_SUMMARY_SECTION = 'casesummary886';
  const extraCache = new Map(); // project id -> { apd, userStatus, dob, disposition, charges }
  // Kept in this browser for 30 minutes so repeat searches (in any tab) fill in instantly.
  const EXTRA_KEY = 'pd9-extra-cache';
  (function loadExtraCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}');
      const fresh = {};
      for (const [id, v] of Object.entries(saved)) if (v && Date.now() - v.at < 30 * 60 * 1000) { extraCache.set(id, v.data); fresh[id] = v; }
      localStorage.setItem(EXTRA_KEY, JSON.stringify(fresh)); // drop old ones
    } catch (e) { /* ignore */ }
  })();
  function saveExtra(id, data) {
    try {
      const saved = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}');
      saved[id] = { at: Date.now(), data };
      const keys = Object.keys(saved);
      if (keys.length > 300) keys.sort((a, b) => saved[a].at - saved[b].at).slice(0, keys.length - 300).forEach((k) => delete saved[k]);
      localStorage.setItem(EXTRA_KEY, JSON.stringify(saved));
    } catch (e) { /* ignore */ }
  }

  function pickField(obj, name) {
    const key = Object.keys(obj || {}).find((k) => new RegExp(`^${name}\\d*$`, 'i').test(k));
    return key ? obj[key] : undefined;
  }

  async function loadCaseSummary(projectId, signal) {
    const url = `/api/projects/${encodeURIComponent(projectId)}/custom/${CASE_SUMMARY_SECTION}?page=1`;
    const tries = [
      { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' },
      { method: 'GET', headers: { Accept: 'application/json' } },
    ];
    for (const t of tries) {
      const res = await fetch(url, { credentials: 'include', signal, ...t });
      if (!res.ok) continue;
      const json = await res.json();
      const obj = json && json.data && json.data.customObject;
      if (obj) return obj;
    }
    throw new Error('case summary not available');
  }

  // ISO date "1990-05-04T00:00:00Z" -> "5/4/1990" (read as written, no time zone shift)
  const isoToMdy = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : ''; };

  // Find every object (at any depth) that has a field starting with this name.
  function findObjectsWith(root, name, out = [], depth = 0) {
    if (!root || typeof root !== 'object' || depth > 6) return out;
    if (Array.isArray(root)) { root.forEach((v) => findObjectsWith(v, name, out, depth + 1)); return out; }
    if (pickField(root, name) !== undefined) out.push(root);
    Object.values(root).forEach((v) => findObjectsWith(v, name, out, depth + 1));
    return out;
  }

  // Client's contact card: GET /api/v2/org/<org>/project/<project>/person/<client>
  async function loadDob(hit, signal) {
    if (!hit.clientID || !hit.orgID) return '';
    const url = `/api/v2/org/${encodeURIComponent(hit.orgID)}/project/${encodeURIComponent(hit.id)}/person/${encodeURIComponent(hit.clientID)}`;
    const res = await fetch(url, { credentials: 'include', signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    const person = findObjectsWith(json, 'birthDate')[0];
    return person ? isoToMdy(pickField(person, 'birthDate')) : '';
  }

  // Sentence tab: same kind of address as Case Summary, different section.
  const SENTENCE_SECTION = 's1_sentence886';
  async function loadSection(projectId, section, signal = undefined) {
    const url = `/api/projects/${encodeURIComponent(projectId)}/custom/${section}?page=1`;
    const tries = [
      { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' },
      { method: 'GET', headers: { Accept: 'application/json' } },
    ];
    for (const t of tries) {
      const res = await fetch(url, { credentials: 'include', signal, ...t });
      if (res.ok) return res.json();
    }
    throw new Error(`${section} not available`);
  }

  async function loadDisposition(projectId, signal) {
    const json = await loadSection(projectId, SENTENCE_SECTION, signal);
    // Each sentence entry has dispositionaction<number>. Newest entry first.
    const items = findObjectsWith(json, 'dispositionaction');
    const when = (it) => String(pickField(it, 'dispositiondate') || pickField(it, 'sentencedate') || (it._itemHeader && it._itemHeader.createdDate) || '');
    items.sort((a, b) => when(b).localeCompare(when(a)));
    const actions = [...new Set(items.map((it) => String(pickField(it, 'dispositionaction') || '').trim()).filter((v) => v && !/^unknown$/i.test(v)))];
    return actions.join('; ');
  }

  async function loadExtra(hit, signal) {
    const cachedExtra = extraCache.get(hit.id) || extraCache.get(String(hit.id));
    if (cachedExtra && cachedExtra.charges !== undefined) return cachedExtra;
    const extra = { apd: '', userStatus: '', dob: '', disposition: '', charges: '' };
    const [summary, dob, disposition] = await Promise.allSettled([
      loadCaseSummary(hit.id, signal), loadDob(hit, signal), loadDisposition(hit.id, signal),
    ]);
    for (const r of [summary, dob, disposition]) if (r.status === 'rejected' && r.reason && r.reason.name === 'AbortError') throw r.reason;
    if (summary.status === 'fulfilled') {
      const obj = summary.value;
      const apd = pickField(obj, 'apd');
      extra.apd = (apd && (apd.fullname || [apd.firstName, apd.lastName].filter(Boolean).join(' '))) || '';
      extra.userStatus = pickField(obj, 'usersatus') || pickField(obj, 'userstatus') || '';
      // Charges are one per line in Case Summary; show each on its own line.
      extra.charges = String(pickField(obj, 'charges') || '').split(/\r?\n/).map((c) => c.trim()).filter(Boolean).join('\n');
    } else { extra.apd = 'n/a'; extra.userStatus = 'n/a'; extra.charges = 'n/a'; }
    extra.dob = dob.status === 'fulfilled' ? dob.value : 'n/a';
    extra.disposition = disposition.status === 'fulfilled' ? (disposition.value || 'None entered') : 'n/a';
    extraCache.set(hit.id, extra);
    if (![extra.apd, extra.dob, extra.disposition].includes('n/a')) saveExtra(String(hit.id), extra);
    return extra;
  }


  // Fill in DOB, disposition, APD, and User Status a few cases at a time, redrawing as they arrive.
  async function enrichAdvanced(hits, signal) {
    let next = 0;
    let redraw = null;
    const refresh = () => {
      clearTimeout(redraw);
      redraw = setTimeout(() => { const st = advState(); drawAdvanced(hits, st.note || ''); saveAdv({ hits }); }, 150);
    };
    const worker = async () => {
      while (next < hits.length) {
        const h = hits[next++];
        if (h.extra && h.extra.charges !== undefined) continue;
        h.extra = await loadExtra(h, signal);
        refresh();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async function runNameQuery(entry, signal, archived = true) {
    for (const q of SEARCH_MODES.name.queries(entry)) {
      const hits = (await askFilevine(q, signal, archived)).filter((h) => h.id && nameFits(h, entry));
      if (hits.length) return hits;
    }
    return [];
  }

  let advRequest = null;
  function openAdvanced(entry) {
    saveAdv({ open: true, min: false, box: null });
    const w = buildAdvanced();
    placeWindow(w, null);
    w.classList.remove('pd9-adv-enter');
    void w.offsetWidth; // restart the open animation
    w.classList.add('pd9-adv-enter');
    if (entry) { w.querySelector('input').value = entry; advSearch(entry); } else w.querySelector('input').focus();
  }

  function buildAdvanced() {
    let w = document.getElementById('pd9-adv');
    if (w) { w.classList.remove('pd9-min'); return w; }
    const st = advState();
    w = document.createElement('div');
    w.id = 'pd9-adv';
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', 'Advanced Name Search');
    w.innerHTML = `
      <div class="pd9-adv-head">
        <h3>Advanced Name Search</h3>
        <button type="button" class="pd9-adv-min" title="Minimize" aria-label="Minimize"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button type="button" class="pd9-adv-x" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="pd9-adv-body">
        <div class="pd9-adv-search">
          <input name="q" autocomplete="off" spellcheck="false" placeholder="Name, any order (john doe, doe john, joh do)">
          <label class="pd9-adv-hidearch"><input type="checkbox" name="hideArchived"> Hide archived</label>
          <button type="button" class="pd9-btn pd9-primary pd9-adv-go">Search</button>
        </div>
        <div class="pd9-adv-status" aria-live="polite"></div>
        <div class="pd9-adv-table-wrap"><table class="pd9-adv-table"><thead><tr>
          ${ADV_COLUMNS.map((c) => `<th aria-sort="none"><button type="button" data-col="${c.key}">${c.label}<span class="pd9-sort" aria-hidden="true"></span></button></th>`).join('')}
        </tr></thead><tbody></tbody></table></div>
      </div>`;
    document.body.appendChild(w);
    if (st.min) w.classList.add('pd9-min');
    const input = w.querySelector('input');
    if (st.entry) input.value = st.entry;
    if (st.hits) drawAdvanced(st.hits, st.note || '');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); advSearch(input.value.trim()); } });
    w.querySelector('.pd9-adv-go').addEventListener('click', () => advSearch(input.value.trim()));
    // "Hide archived" is off unless you turn it on; changing it reruns the search.
    const hideBox = w.querySelector('[name=hideArchived]');
    hideBox.checked = advState().hideArchived === true;
    hideBox.addEventListener('change', () => {
      saveAdv({ hideArchived: hideBox.checked });
      if (input.value.trim()) advSearch(input.value.trim());
    });
    w.querySelector('.pd9-adv-min').addEventListener('click', () => { const min = !w.classList.contains('pd9-min'); w.classList.toggle('pd9-min', min); saveAdv({ min }); });
    w.querySelector('.pd9-adv-head h3').addEventListener('click', () => { if (w.classList.contains('pd9-min')) { w.classList.remove('pd9-min'); saveAdv({ min: false }); } });
    w.querySelector('.pd9-adv-x').addEventListener('click', () => { if (advRequest) advRequest.abort(); w.remove(); saveAdv({ open: false }); });
    makeMovable(w);
    // Click a column title to sort; click again to flip the order.
    w.querySelector('thead').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-col]');
      if (!b) return;
      const cur = advState().sort || {};
      const dir = cur.col === b.dataset.col && cur.dir === 'asc' ? 'desc' : 'asc';
      saveAdv({ sort: { col: b.dataset.col, dir } });
      const st = advState();
      drawAdvanced(st.hits || [], st.note || '');
    });
    return w;
  }

  // Sort helpers: dates and case numbers sort by what they mean, not as text.
  const dateValue = (t) => { const m = String(t).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? +m[3] * 10000 + +m[1] * 100 + +m[2] : 0; };
  const caseValue = (t) => {
    const c = readCaseNumbers(t)[0];
    if (!c) return String(t);
    const y = +c.year > 50 ? 1900 + +c.year : 2000 + +c.year;
    return `${y}-${c.type}-${c.num.padStart(7, '0')}-${c.def}-${c.county}`;
  };
  const lastName = (t) => { const w = String(t).trim().split(/\s+/); return `${w[w.length - 1]} ${w.slice(0, -1).join(' ')}`.toLowerCase(); };

  const ADV_COLUMNS = [
    { key: 'name', label: 'Name', sort: (d) => lastName(d.name), link: true },
    { key: 'caseNo', label: 'Case #', sort: (d) => caseValue(d.caseNo), link: true },
    { key: 'type', label: 'Type' },
    { key: 'county', label: 'County' },
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Date', sort: (d) => dateValue(d.date) },
    { key: 'dob', label: 'DOB', sort: (d) => dateValue(d.dob) },
    { key: 'charges', label: 'Charges' },
    { key: 'disposition', label: 'Disposition' },
    { key: 'apd', label: 'APD', sort: (d) => lastName(d.apd || '') },
    { key: 'userStatus', label: 'User Status' },
    { key: 'attorney', label: 'Primary attorney' },
    { key: 'tags', label: 'Tags' },
  ];

  // ---------- move and resize the Advanced window ----------
  // Drag the title bar to move it. Drag the bottom-right corner to resize.
  // Double-click the title bar to put it back in the corner. Remembered per tab.
  // Default spot: just under the search bar at the top of Filevine, lined up
  // with the search box, wide enough to read every column.
  function underSearchBox() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const input = searchInput();
    const anchor = (input && (input.closest('.search') || input)) || document.getElementById('pd9-name-btn');
    const r = anchor ? anchor.getBoundingClientRect() : { left: 16, bottom: 64 };
    const header = input && input.closest('header, .app-header, [class*="header"]');
    const top = Math.round(Math.max(r.bottom, header ? header.getBoundingClientRect().bottom : 0) + 8);
    const width = Math.min(1180, vw - 32);
    const left = Math.min(Math.max(Math.round(r.left), 16), vw - width - 16);
    const height = Math.max(320, Math.min(640, vh - top - 16));
    return { left, top, width, height };
  }

  function placeWindow(w, box) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!box) box = underSearchBox();
    const width = Math.min(Math.max(box.width || 0, 560), vw - 16);
    const height = Math.min(Math.max(box.height || 0, 320), vh - 16);
    w.style.right = 'auto'; w.style.bottom = 'auto';
    w.style.width = `${width}px`;
    w.style.height = `${height}px`;
    // Keep at least the title bar on screen.
    w.style.left = `${Math.min(Math.max(box.left, 8 - width + 120), vw - 120)}px`;
    w.style.top = `${Math.min(Math.max(box.top, 8), vh - 48)}px`;
  }

  function makeMovable(w) {
    placeWindow(w, advState().box);
    const head = w.querySelector('.pd9-adv-head');
    const save = () => {
      if (w.classList.contains('pd9-min')) return;
      const r = w.getBoundingClientRect();
      saveAdv({ box: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } });
    };
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = w.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      // Switch to left/top positioning at the current spot, at the current size.
      placeWindow(w, { left: r.left, top: r.top, width: r.width, height: w.classList.contains('pd9-min') ? 200 : r.height });
      if (w.classList.contains('pd9-min')) { w.style.height = ''; w.style.width = ''; }
      head.setPointerCapture(e.pointerId);
      w.classList.add('pd9-dragging');
      const move = (ev) => {
        w.style.left = `${Math.min(Math.max(ev.clientX - dx, 8 - r.width + 120), window.innerWidth - 120)}px`;
        w.style.top = `${Math.min(Math.max(ev.clientY - dy, 8), window.innerHeight - 48)}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        w.classList.remove('pd9-dragging');
        save();
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      saveAdv({ box: null });
      placeWindow(w, null);
    });
    // Resizing uses the browser's own corner handle; remember the new size.
    let t = null;
    new ResizeObserver(() => {
      if (w.classList.contains('pd9-min') || !w.style.width) return;
      clearTimeout(t);
      t = setTimeout(save, 200);
    }).observe(w);
    w.addEventListener('pointerdown', (e) => {
      // Grabbing the resize corner: switch to left/top so the window grows toward the corner.
      const r = w.getBoundingClientRect();
      if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18 && !w.style.width) {
        placeWindow(w, { left: r.left, top: r.top, width: r.width, height: r.height });
      }
    }, true);
  }

  // ---------- Charges window ----------
  // Loads the case's Charges tab (/api/projects/<id>/custom/s1_charges886) and
  // shows every charge as a table. Column names come from Filevine's field
  // names, cleaned up. If the Charges tab can't be loaded, it shows the list
  // from Case Summary instead.
  const CHARGES_SECTION = 's1_charges886';
  const chargesCache = new Map();

  // Field names look like "chargedescription10930" or "f2_offensedate10930".
  // Break them into words using common charge-related words.
  const LABEL_WORDS = ['description', 'disposition', 'statute', 'severity', 'sentence', 'original', 'amended', 'offense',
    'charge', 'degree', 'number', 'arrest', 'finding', 'counts', 'count', 'level', 'class', 'filed', 'filing', 'status',
    'notes', 'plea', 'date', 'type', 'code', 'bond', 'court', 'action', 'reason', 'section', 'case', 'name', 'lesser',
    'included', 'enhancement', 'adjudication', 'adjudicated', 'withheld', 'dismissed', 'nolle', 'prossed', 'reduced', 'to'];
  function prettyLabel(key) {
    let k = key.replace(/^f\d*_/, '').replace(/\d+$/, '').toLowerCase();
    const out = [];
    while (k) {
      const w = LABEL_WORDS.find((x) => k.startsWith(x));
      if (w) { out.push(w); k = k.slice(w.length); continue; }
      const next = LABEL_WORDS.map((x) => k.indexOf(x)).filter((i) => i > 0).sort((a, b) => a - b)[0];
      const chunk = next ? k.slice(0, next) : k;
      out.push(chunk); k = k.slice(chunk.length);
    }
    const t = out.join(' ').replace(/_/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function cellText(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? isoToMdy(v) : v.trim();
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(', ');
    if (typeof v === 'object') {
      if (v.fullname) return v.fullname;
      if (v.dateValue) return isoToMdy(v.dateValue);
      if (v.name) return String(v.name);
      return '';
    }
    return '';
  }

  // The charge entries: the biggest list of objects whose field names end in a number.
  function findItems(json) {
    let best = [];
    (function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (Array.isArray(v)) {
        const rows = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).some((k) => /[a-z]\d{3,}$/i.test(k)));
        if (rows.length > best.length) best = rows;
        v.forEach((x) => walk(x, depth + 1));
        return;
      }
      Object.values(v).forEach((x) => walk(x, depth + 1));
    })(json, 0);
    return best;
  }

  async function loadCharges(projectId) {
    if (chargesCache.has(projectId)) return chargesCache.get(projectId);
    const json = await loadSection(projectId, CHARGES_SECTION);
    const items = findItems(json);
    // Columns: every field that has something in at least one charge, in Filevine's order.
    const keys = [];
    items.forEach((it) => Object.keys(it).forEach((k) => {
      if (k.startsWith('_') || keys.includes(k)) return;
      if (items.some((x) => cellText(x[k]))) keys.push(k);
    }));
    const table = { columns: keys.map(prettyLabel), rows: items.map((it) => keys.map((k) => cellText(it[k]))) };
    chargesCache.set(projectId, table);
    return table;
  }

  function showCharges(d, summaryCharges, projectId) {
    document.querySelectorAll('.pd9-charges-modal').forEach((m) => m.remove());
    const overlay = document.createElement('div');
    overlay.className = 'pd9-overlay pd9-charges-modal';
    overlay.innerHTML = `
      <div class="pd9-dialog pd9-charges-dialog" role="dialog" aria-modal="true" aria-labelledby="pd9-charges-title">
        <div class="pd9-head">
          <h2 id="pd9-charges-title">Charges</h2>
          <button type="button" class="pd9-x" aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="pd9-form">
          <p class="pd9-charges-case"></p>
          <div class="pd9-charges-body"><div class="pd9-adv-status"><span class="pd9-spin" aria-hidden="true"></span> Loading the Charges tab...</div></div>
        </div>
        <div class="pd9-foot"><span class="pd9-grow"></span>
          <button type="button" class="pd9-btn pd9-copy">Copy</button>
          <button type="button" class="pd9-btn pd9-primary pd9-done">Close</button>
        </div>
      </div>`;
    overlay.querySelector('.pd9-charges-case').textContent = `${d.name} | ${d.caseNo}`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector('.pd9-charges-body');
    let copyText = summaryCharges.join('\n');

    const showList = (why) => {
      body.textContent = '';
      if (why) { const p = document.createElement('p'); p.className = 'pd9-charges-note'; p.textContent = why; body.appendChild(p); }
      if (!summaryCharges.length) { const p = document.createElement('p'); p.textContent = 'No charges entered.'; body.appendChild(p); return; }
      const ol = document.createElement('ol');
      ol.className = 'pd9-charges-list';
      summaryCharges.forEach((c) => { const li = document.createElement('li'); li.textContent = c; ol.appendChild(li); });
      body.appendChild(ol);
      overlay.querySelector('h2').textContent = `Charges (${summaryCharges.length})`;
    };

    loadCharges(projectId).then((t) => {
      if (!overlay.isConnected) return;
      if (!t.rows.length) { showList(summaryCharges.length ? 'Nothing on the Charges tab. This list is from Case Summary.' : ''); return; }
      overlay.querySelector('h2').textContent = `Charges (${t.rows.length})`;
      body.textContent = '';
      const wrap = document.createElement('div');
      wrap.className = 'pd9-charges-wrap';
      const table = document.createElement('table');
      table.className = 'pd9-charges-table';
      const hr = document.createElement('tr');
      ['#', ...t.columns].forEach((c) => { const th = document.createElement('th'); th.textContent = c; hr.appendChild(th); });
      const thead = document.createElement('thead'); thead.appendChild(hr);
      const tbody = document.createElement('tbody');
      t.rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        [String(i + 1), ...r].forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
      copyText = [t.columns.join('\t'), ...t.rows.map((r) => r.join('\t'))].join('\n'); // pastes into Excel or Word as a table
    }).catch(() => { if (overlay.isConnected) showList('Could not load the Charges tab. This list is from Case Summary.'); });

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.pd9-x').addEventListener('click', close);
    overlay.querySelector('.pd9-done').addEventListener('click', close);
    overlay.querySelector('.pd9-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copyText); toast('Charges copied.'); } catch (e) { toast('Could not copy. Select the text instead.'); }
    });
    overlay.querySelector('.pd9-done').focus();
  }


  function drawAdvanced(hits, note) {
    const w = document.getElementById('pd9-adv');
    if (!w) return;
    const sort = advState().sort || { col: 'date', dir: 'desc' }; // newest first until you pick
    const col = ADV_COLUMNS.find((c) => c.key === sort.col) || ADV_COLUMNS[0];
    const keyOf = col.sort || ((d) => String(d[col.key] || '').toLowerCase());
    const rows = hits.map((h) => ({ h, d: readDetails(h) }));
    rows.sort((x, y) => {
      const a = keyOf(x.d), b = keyOf(y.d);
      const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
      return sort.dir === 'desc' ? -c : c;
    });

    // Header arrows and screen reader sort state
    w.querySelectorAll('thead th').forEach((th) => {
      const k = th.querySelector('button').dataset.col;
      const on = k === col.key;
      th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.pd9-sort').textContent = on ? (sort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
    });

    const body = w.querySelector('tbody');
    body.textContent = '';
    for (const { h, d } of rows) {
      const tr = document.createElement('tr');
      for (const c of ADV_COLUMNS) {
        const td = document.createElement('td');
        const text = d[c.key] || '';
        const charges = c.key === 'charges' ? text.split('\n').filter(Boolean) : null;
        if (c.link) {
          const a = document.createElement('a');
          a.textContent = text;
          wireCaseLink(a, h.id, `${d.caseNo}  ${d.name}`.trim());
          td.appendChild(a);
        } else if (charges && !/^(\.\.\.)$/.test(text)) {
          // A small "Charges (N)" button. Click for the full table from the Charges tab.
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pd9-charges-btn';
          btn.title = charges.length && text !== 'n/a' ? charges.join('\n') : 'Show charges';
          const n = text === 'n/a' ? 0 : charges.length;
          btn.textContent = n ? `View ${n} charge${n === 1 ? '' : 's'}` : 'View charges';
          btn.addEventListener('click', () => showCharges(d, text === 'n/a' ? [] : charges, h.id));
          td.appendChild(btn);
        } else td.textContent = text;
        if (c.key === 'status') td.className = /closed/i.test(text) ? 'pd9-closed' : 'pd9-open';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    w.querySelector('.pd9-adv-status').textContent = note;
  }

  async function advSearch(entry) {
    const w = document.getElementById('pd9-adv');
    if (!w) return;
    const status = w.querySelector('.pd9-adv-status');
    if (!nameWords(entry).length) { status.textContent = 'Type at least part of a name.'; return; }
    if (advRequest) advRequest.abort();
    const ctrl = new AbortController();
    advRequest = ctrl;
    // Clear the last results right away, so old rows never mix with the new search,
    // and show a few grey placeholder rows while Filevine works.
    const tb = w.querySelector('tbody');
    tb.textContent = '';
    for (let i = 0; i < 4; i++) {
      const tr = document.createElement('tr');
      tr.className = 'pd9-skel-row';
      ADV_COLUMNS.forEach(() => { const td = document.createElement('td'); td.innerHTML = '<span class="pd9-skel"></span>'; tr.appendChild(td); });
      tb.appendChild(tr);
    }
    saveAdv({ entry, hits: [], note: '' });
    const started = Date.now();
    const hideArchived = advState().hideArchived === true;
    const waitText = hideArchived ? 'Searching open cases' : 'Searching, including archived';
    status.innerHTML = `<span class="pd9-spin" aria-hidden="true"></span> <span class="pd9-adv-wait">${waitText}...</span>`;
    const tick = setInterval(() => {
      const t = status.querySelector('.pd9-adv-wait');
      if (t) t.textContent = `${waitText}... ${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
    try {
      const hits = await runNameQuery(entry, ctrl.signal, !hideArchived);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const note = hits.length ? `${hits.length} case${hits.length === 1 ? '' : 's'} found (${secs}s)` : `No case names match all of those words (${secs}s).`;
      drawAdvanced(hits, note);
      saveAdv({ entry, hits, note });
      enrichAdvanced(hits, ctrl.signal).catch(() => { /* stopped or failed; table keeps what it has */ });
    } catch (err) {
      if (err.name !== 'AbortError') status.textContent = 'Filevine did not answer. Try again in a moment.';
    } finally {
      clearInterval(tick);
      if (advRequest === ctrl) advRequest = null;
    }
  }

  // Bring it back after a reload or when Filevine redraws the page.
  function keepAdvanced() {
    if (advOpen && !document.getElementById('pd9-adv')) buildAdvanced();
  }

  // ---------- move and resize Filevine's note/task box ----------
  // Drag the top bar of the box (not the icons or buttons) to move it. Drag the
  // bottom-right corner grip to resize it. Double-click the top bar to put it back.
  // Remembered for next time.
  // The position lives in a class and CSS variables, never in the box's own style,
  // so Filevine's sizes stay untouched: when the box is minimized, the class comes
  // off and the minimized bar looks and sits exactly the way Filevine draws it.
  const COMPOSER_KEY = 'pd9-composer-box';

  let composerBoxCache;
  const composerBox = () => (composerBoxCache === undefined ? (composerBoxCache = store.get(COMPOSER_KEY, null)) : composerBoxCache);
  const setComposerBox = (box) => { composerBoxCache = box; store.set(COMPOSER_KEY, box); };
  let lastPlaced = null; // { form, open, box } so we only touch the box when something changed

  function clampBox(box) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(box.width, 380), vw - 16);
    const height = Math.min(Math.max(box.height, 260), vh - 16);
    return {
      width, height,
      left: Math.min(Math.max(box.left, 8 - width + 120), vw - 120),
      top: Math.min(Math.max(box.top, 8), vh - 48),
    };
  }
  function applyBox(form, box) {
    const b = clampBox(box);
    form.style.setProperty('--pd9-cl', `${b.left}px`);
    form.style.setProperty('--pd9-ct', `${b.top}px`);
    form.style.setProperty('--pd9-cw', `${b.width}px`);
    form.style.setProperty('--pd9-ch', `${b.height}px`);
    form.classList.add('pd9-placed');
  }

  function placeComposer(form) {
    const box = composerBox();
    const open = isVisible($(SEL.message, form));
    // Our extras only while it's open. Minimized: Filevine's own look, untouched.
    form.classList.toggle('pd9-movable', open);
    if (!box || !open) { form.classList.remove('pd9-placed'); return; }
    applyBox(form, box);
  }

  // Recheck right after the box is minimized or brought back (by Esc, N, or its own button).
  function refreshComposer(form) {
    [0, 120, 400].forEach((ms) => setTimeout(() => {
      if (!form.isConnected) return;
      placeComposer(form);
      lastPlaced = { form, open: isVisible($(SEL.message, form)), box: composerBox() };
    }, ms));
  }

  const composerReady = new WeakSet();
  function makeComposerMovable() {
    const form = $(SEL.docked);
    if (!form) return;
    const open = isVisible($(SEL.message, form));
    if (!lastPlaced || lastPlaced.form !== form || lastPlaced.open !== open || lastPlaced.box !== composerBox()) {
      placeComposer(form);
      lastPlaced = { form, open, box: composerBox() };
    }
    if (!form.querySelector(':scope > .pd9-composer-grip')) {
      const g = document.createElement('span');
      g.className = 'pd9-composer-grip';
      g.setAttribute('aria-hidden', 'true');
      g.title = 'Drag to resize';
      form.appendChild(g);
    }
    if (composerReady.has(form)) return;
    composerReady.add(form);

    const current = () => { const r = form.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const save = () => {
      if (!isVisible($(SEL.message, form))) return;
      const r = current();
      setComposerBox({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
      lastPlaced = { form, open: true, box: composerBox() };
    };
    const isHandle = (t) => t.closest('.header') && !t.closest('button, [role="button"], input, select, textarea, a');
    let lastHandleDown = 0;

    form.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !isVisible($(SEL.message, form))) return;
      const grip = e.target.closest && e.target.closest('.pd9-composer-grip');
      if (!grip && !isHandle(e.target)) return;
      e.preventDefault();
      if (!grip) lastHandleDown = Date.now();
      const start = current();
      applyBox(form, start); // from here on, we own the position
      const sx = e.clientX, sy = e.clientY;
      form.setPointerCapture(e.pointerId);
      form.classList.add('pd9-dragging');
      const move = (ev) => {
        const b = grip
          ? { ...start, width: start.width + ev.clientX - sx, height: start.height + ev.clientY - sy }
          : { ...start, left: start.left + ev.clientX - sx, top: start.top + ev.clientY - sy };
        applyBox(form, b);
      };
      const up = () => {
        form.removeEventListener('pointermove', move);
        form.removeEventListener('pointerup', up);
        form.removeEventListener('pointercancel', up);
        form.classList.remove('pd9-dragging');
        save();
      };
      form.addEventListener('pointermove', move);
      form.addEventListener('pointerup', up);
      form.addEventListener('pointercancel', up);
    }, true);

    // Its own minimize button (and anything else in the top bar) can change open/minimized.
    form.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.header')) refreshComposer(form); });

    form.addEventListener('dblclick', () => {
      // (While dragging, the click lands on the box itself, so go by where the press started.)
      if (Date.now() - lastHandleDown > 800) return;
      setComposerBox(null);
      placeComposer(form);
      lastPlaced = { form, open: true, box: null };
    });
  }

  // ---------- Jail Search (Osceola cases only) ----------
  // On a case whose number ends in OS, a "Jail Search" button sits next to
  // Vitals. It opens the Osceola County jail search for the name in the case
  // title (everything before the " | "), in a new tab.
  const JAIL_SEARCH_URL = 'https://legacy-apps.osceola.org/Apps/CorrectionsReports/Report/Search';

  function jailSearchFor() {
    const title = currentCaseName(); // "John Doe | 25-CF-001234-A-OS"
    const bar = title.indexOf('|');
    if (bar < 0) return null;
    const name = title.slice(0, bar).trim();
    const tail = title.slice(bar + 1).trim().replace(/[\s\-_]/g, '').toUpperCase();
    if (!name) return null;
    if (tail.endsWith('OS')) {
      return { name, county: 'Osceola', url: `${JAIL_SEARCH_URL}?${new URLSearchParams({ term: name })}` };
    }
    return null;
  }


  // The Court Case Number on the Case Summary tab, in the Clerk's format:
  // "2026-CF-001234-A-OS" -> "2026 CF 001234". Also reads a full UCN like
  // "492026CF001234AXXXOS" (49 = Osceola). Returns '' for non-Osceola numbers.
  function benchmarkCaseNumber(raw) {
    let t = String(raw || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!t) return '';
    if (/^\d{6}[A-Z]{2}/.test(t)) { // UCN: county code first
      if (!t.startsWith('49')) return '';
      t = t.slice(2);
    } else if (/(OR|OC)$/.test(t) && !/OS$/.test(t)) {
      return ''; // Orange County
    } else if (!/OS$/.test(t)) {
      // No county on the number: go by the case title instead.
      const title = currentCaseName();
      if (!/OS$/i.test(title.slice(title.indexOf('|') + 1).replace(/[^0-9A-Za-z]/g, ''))) return '';
    }
    const m = t.match(/^(\d{4}|\d{2})([A-Z]{2})(\d{1,6})/);
    if (!m) return '';
    let year = m[1];
    if (year.length === 2) {
      const yy = Number(year);
      year = String(yy <= (new Date().getFullYear() % 100) + 1 ? 2000 + yy : 1900 + yy);
    }
    return `${year} ${m[2]} ${m[3].padStart(6, '0')}`;
  }

  // Court Case Number for each case, read from Case Summary (the same request the tab makes).
  const courtNoCache = new Map(); // project id -> { at, value } or a pending promise
  function courtCaseNumber(pid, fresh) {
    const hit = courtNoCache.get(pid);
    if (hit && !fresh) return hit instanceof Promise ? hit : Promise.resolve(hit.value);
    const p = loadCaseSummary(pid)
      .then((obj) => String(pickField(obj, 'courtcasenumber') || '').trim())
      .catch(() => (hit && !(hit instanceof Promise) ? hit.value : ''))
      .then((value) => { courtNoCache.set(pid, { at: Date.now(), value }); return value; });
    courtNoCache.set(pid, p);
    return p;
  }
  const benchmarkUrl = (caseNo) => `https://courts.osceolaclerk.com/BenchmarkWeb/Home.aspx/Search#pd9case=${encodeURIComponent(caseNo)}`;

  let benchKey = '';
  function addBenchmarkButton() {
    const pid = inCase() ? projectId() : null;
    const hit = pid && courtNoCache.get(pid);
    const known = hit && !(hit instanceof Promise);
    const caseNo = known ? benchmarkCaseNumber(hit.value) : '';
    const key = `${pid}|${caseNo}|${known}`;
    const existing = document.getElementById('pd9-bench-btn');
    if (key === benchKey && (existing || !caseNo)) return;
    benchKey = key;
    if (pid && !hit) courtCaseNumber(pid).then(() => { benchKey = ''; addBenchmarkButton(); });
    if (existing && (existing.dataset.pid !== String(pid) || !caseNo)) existing.remove();
    if (!caseNo || document.getElementById('pd9-bench-btn')) {
      const b = document.getElementById('pd9-bench-btn');
      if (b) { b.dataset.caseNo = caseNo; b.title = `Look up ${caseNo} on the Osceola Clerk's site (new tab)`; }
      return;
    }
    const vitals = [...document.querySelectorAll('.vitals-toggle button, button')].find((b) => /^\s*vitals\s*$/i.test(b.querySelector('.vitals-btn-text')?.textContent || ''));
    if (!vitals) { benchKey = ''; return; }
    const btn = vitals.cloneNode(true);
    btn.id = 'pd9-bench-btn';
    btn.dataset.pid = String(pid);
    btn.dataset.caseNo = caseNo;
    btn.title = `Look up ${caseNo} on the Osceola Clerk's site (new tab)`;
    const icon = btn.querySelector('i');
    if (icon) {
      const hidden = icon.querySelector('.visually-hidden');
      if (hidden) hidden.textContent = 'slot-text:gavel';
      const tn = [...icon.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (tn) tn.nodeValue = 'gavel ';
    }
    const label = btn.querySelector('.vitals-btn-text') || btn.querySelector('.text-container');
    if (label) label.textContent = 'Benchmark';
    btn.style.marginRight = '8px';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Open the tab now (so the browser does not block it), then read the
      // Court Case Number again in case someone just changed it.
      const tab = window.open('about:blank', '_blank');
      const fresh = benchmarkCaseNumber(await Promise.race([courtCaseNumber(btn.dataset.pid, true), sleep(2500).then(() => '')])) || btn.dataset.caseNo;
      if (tab) { try { tab.opener = null; } catch (err) { /* ignore */ } tab.location.href = benchmarkUrl(fresh); }
      else window.open(benchmarkUrl(fresh), '_blank', 'noopener');
      benchKey = '';
    });
    const holder = vitals.closest('.vitals-toggle') || vitals;
    holder.before(btn);
  }

  let jailKey = '';
  function addJailButton() {
    const key = `${location.href}|${document.title}`;
    if (key === jailKey && (document.getElementById('pd9-jail-btn') || !jailSearchFor())) return;
    jailKey = key;
    const want = inCase() ? jailSearchFor() : null;
    const existing = document.getElementById('pd9-jail-btn');
    if (existing && (!want || existing.dataset.url !== want.url)) existing.remove();
    if (!want || document.getElementById('pd9-jail-btn')) return;
    const vitals = [...document.querySelectorAll('.vitals-toggle button, button')].find((b) => /^\s*vitals\s*$/i.test(b.querySelector('.vitals-btn-text')?.textContent || ''));
    if (!vitals) return;
    // Copy the Vitals button so it matches Filevine's look; copies don't carry Filevine's behavior.
    const btn = vitals.cloneNode(true);
    btn.id = 'pd9-jail-btn';
    btn.dataset.url = want.url;
    btn.title = `Search the ${want.county} County jail for ${want.name} (opens a new tab)`;
    const icon = btn.querySelector('i');
    if (icon) {
      const hidden = icon.querySelector('.visually-hidden');
      if (hidden) hidden.textContent = 'slot-text:search';
      const tn = [...icon.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (tn) tn.nodeValue = 'search ';
    }
    const label = btn.querySelector('.vitals-btn-text') || btn.querySelector('.text-container');
    if (label) label.textContent = 'Jail Search';
    btn.style.marginRight = '8px';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(btn.dataset.url, '_blank', 'noopener');
    });
    const holder = vitals.closest('.vitals-toggle') || vitals;
    holder.before(btn);
  }

  // ---------- Deposition recorder ----------
  // A "Record Depo" button sits next to Vitals on every case. It opens a small
  // recorder with a level meter. Stop saves an audio file named after the case
  // plus the date and time the recording started, and downloads it.
  // While recording, each 5 seconds of audio is also kept in this browser
  // (IndexedDB), so a crash or a closed tab does not lose the deposition.
  // Nothing is sent to Filevine.
  const DEPO_MIC_KEY = 'pd9-depo-mic';
  const DEPO_SLICE_MS = 5000;
  const DEPO_QUIET_DB = -55;
  const DEPO_QUIET_MS = 15000;
  const depo = {
    panel: null, stream: null, ctx: null, analyser: null, buf: null, tick: 0,
    rec: null, sid: '', mime: '', ext: '', startedAt: null, elapsedMs: 0, runStart: 0,
    chunks: [], blobUrl: '', fileName: '', saved: false, quietSince: 0, loudUntil: 0,
    peak: 0, history: [], wake: null, dbFailed: false,
  };

  // ----- local backup (IndexedDB) -----
  let depoDbP = null;
  function depoDb() {
    if (!depoDbP) {
      depoDbP = new Promise((res, rej) => {
        const r = indexedDB.open('pd9-depo', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('sessions', { keyPath: 'id' });
          db.createObjectStore('chunks', { autoIncrement: true }).createIndex('sid', 'sid');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => { depoDbP = null; rej(r.error); };
      });
    }
    return depoDbP;
  }
  async function depoTx(stores, mode, work) {
    const db = await depoDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(stores, mode);
      let out;
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
      work(tx, (v) => { out = v; });
    });
  }
  const depoPutSession = (s) => depoTx(['sessions'], 'readwrite', (tx) => tx.objectStore('sessions').put(s));
  const depoAddChunk = (sid, blob, recMs) => depoTx(['chunks', 'sessions'], 'readwrite', (tx) => {
    tx.objectStore('chunks').add({ sid, blob });
    const ss = tx.objectStore('sessions');
    const g = ss.get(sid);
    g.onsuccess = () => { if (g.result) ss.put({ ...g.result, updatedAt: Date.now(), recMs, chunks: (g.result.chunks || 0) + 1 }); };
  });
  const depoSessions = () => depoTx(['sessions'], 'readonly', (tx, done) => {
    const r = tx.objectStore('sessions').getAll();
    r.onsuccess = () => done(r.result || []);
  });
  const depoChunks = (sid) => depoTx(['chunks'], 'readonly', (tx, done) => {
    const r = tx.objectStore('chunks').index('sid').getAll(IDBKeyRange.only(sid));
    r.onsuccess = () => done((r.result || []).map((c) => c.blob));
  });
  const depoDrop = (sid) => depoTx(['chunks', 'sessions'], 'readwrite', (tx) => {
    tx.objectStore('sessions').delete(sid);
    const c = tx.objectStore('chunks').index('sid').openCursor(IDBKeyRange.only(sid));
    c.onsuccess = () => { const cur = c.result; if (cur) { cur.delete(); cur.continue(); } };
  });

  // ----- names and formats -----
  function depoFormat() {
    const MR = window.MediaRecorder;
    if (!MR) return null;
    // WebM (Opus) is what Chrome and Edge record best. depoFixLength() adds the
    // length to the file so players can show it and skip around.
    const options = [['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm']];
    for (const [mime, ext] of options) { try { if (MR.isTypeSupported(mime)) return { mime, ext }; } catch (e) { /* next */ } }
    return { mime: '', ext: 'webm' };
  }
  function depoStamp(d) {
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()} ${h}.${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  function depoBase(title, when) {
    const clean = (title || 'Deposition')
      .replace(/\s*\|\s*/g, ' - ')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'Deposition';
    return `${clean} - Depo ${depoStamp(when)}`;
  }
  const depoClock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const depoRecording = () => !!(depo.rec && depo.rec.state !== 'inactive');
  const depoElapsed = () => depo.elapsedMs + (depo.rec && depo.rec.state === 'recording' ? performance.now() - depo.runStart : 0);

  // MediaRecorder leaves the length out of WebM files, so most players cannot
  // show it or skip around. This writes a Duration into the file's Info block.
  async function depoFixLength(blob, ms) {
    try {
      if (!/webm/i.test(blob.type) || !ms) return blob;
      const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
      const vint = (at, keepMarker) => {
        const first = head[at];
        let len = 1;
        let mask = 0x80;
        while (len <= 8 && !(first & mask)) { len += 1; mask >>= 1; }
        if (len > 8 || at + len > head.length) throw new Error('bad vint');
        let v = keepMarker ? first : first & (mask - 1);
        for (let i = 1; i < len; i += 1) v = v * 256 + head[at + i];
        return { v, len };
      };
      const el = (at) => {
        const id = vint(at, true);
        const size = vint(at + id.len, false);
        const dataStart = at + id.len + size.len;
        return { id: id.v, start: at, idLen: id.len, dataStart, end: dataStart + size.v };
      };
      const ebml = el(0);
      if (ebml.id !== 0x1A45DFA3) return blob;
      const seg = el(ebml.end);
      if (seg.id !== 0x18538067) return blob;
      for (let at = seg.dataStart; at < head.length - 8;) {
        const e = el(at);
        if (e.id === 0x1F43B675) break; // first Cluster: no Info found
        if (e.id === 0x1549A966) {
          if (e.end > head.length) return blob;
          let scale = 1000000;
          const keep = [];
          for (let q = e.dataStart; q < e.end;) {
            const c = el(q);
            if (c.id === 0x2AD7B1) { scale = 0; for (let i = c.dataStart; i < c.end; i += 1) scale = scale * 256 + head[i]; }
            if (c.id !== 0x4489) keep.push(head.slice(c.start, c.end));
            q = c.end;
          }
          const dur = new Uint8Array(11);
          dur.set([0x44, 0x89, 0x88]);
          new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / (scale || 1000000));
          const bodyLen = keep.reduce((n, k) => n + k.length, 0) + dur.length;
          const size = new Uint8Array(8);
          size[0] = 0x01;
          for (let i = 7, v = bodyLen; i >= 1; i -= 1, v = Math.floor(v / 256)) size[i] = v % 256;
          const parts = [head.slice(0, e.start), head.slice(e.start, e.start + e.idLen), size, ...keep, dur, blob.slice(e.end)];
          return new Blob(parts, { type: blob.type });
        }
        at = e.end;
      }
    } catch (e) { /* keep the file as recorded */ }
    return blob;
  }

  function depoDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return url;
  }

  // ----- the panel -----
  function depoMsg(text, kind) {
    const el = depo.panel && $('.pd9-depo-msg', depo.panel);
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.dataset.kind = kind || '';
  }

  function depoDraw() {
    const p = depo.panel;
    if (!p) return;
    const rec = depoRecording();
    const paused = rec && depo.rec.state === 'paused';
    p.dataset.state = rec ? (paused ? 'paused' : 'recording') : (depo.saved ? 'saved' : 'ready');
    $('[data-act=rec]', p).hidden = rec;
    $('[data-act=rec]', p).textContent = depo.saved ? 'Start a new recording' : 'Start recording';
    $('[data-act=pause]', p).hidden = !rec;
    $('[data-act=pause]', p).textContent = paused ? 'Resume' : 'Pause';
    $('[data-act=stop]', p).hidden = !rec;
    $('[data-act=again]', p).hidden = !(depo.saved && depo.blobUrl);
    $('.pd9-depo-mic', p).disabled = rec;
    const name = $('.pd9-depo-name', p).value;
    const ext = depo.ext || (depoFormat() || {}).ext || 'webm';
    const file = depo.saved && !rec ? depo.fileName : `${depoBase(name, depo.startedAt && rec ? depo.startedAt : new Date())}.${ext}`;
    $('.pd9-depo-file', p).textContent = file;
    $('.pd9-depo-file', p).title = file;
  }

  async function depoListMics() {
    const sel = depo.panel && $('.pd9-depo-mic', depo.panel);
    if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const want = store.get(DEPO_MIC_KEY, '');
    const current = depo.stream && depo.stream.getAudioTracks()[0] && depo.stream.getAudioTracks()[0].getSettings().deviceId;
    sel.innerHTML = '';
    mics.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = m.deviceId;
      o.textContent = m.label || `Microphone ${i + 1}`;
      sel.appendChild(o);
    });
    sel.value = current || want || (mics[0] && mics[0].deviceId) || '';
  }

  async function depoOpenMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot record audio.');
    depoCloseMic();
    const id = store.get(DEPO_MIC_KEY, '');
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...audio, deviceId: { exact: id } } : audio });
    } catch (e) {
      if (!id || e.name === 'NotAllowedError') throw e;
      store.set(DEPO_MIC_KEY, ''); // the saved mic is gone, use the default one
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    }
    depo.stream = stream;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    depo.ctx = new Ctx();
    const src = depo.ctx.createMediaStreamSource(stream);
    depo.analyser = depo.ctx.createAnalyser();
    depo.analyser.fftSize = 2048;
    depo.buf = new Float32Array(depo.analyser.fftSize);
    src.connect(depo.analyser);
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      if (depoRecording()) { depoStop('The microphone was disconnected. The recording was stopped and saved.'); }
      else depoMsg('The microphone was disconnected.', 'bad');
    }));
    clearInterval(depo.tick);
    depo.tick = setInterval(depoMeter, 50);
    await depoListMics();
    depoMsg(depoRecording() ? 'Recording' : 'Ready. Talk to check the level.', '');
  }

  function depoCloseMic() {
    clearInterval(depo.tick);
    depo.tick = 0;
    if (depo.stream) depo.stream.getTracks().forEach((t) => t.stop());
    if (depo.ctx) depo.ctx.close().catch(() => {});
    depo.stream = depo.ctx = depo.analyser = null;
  }

  function depoMeter() {
    const p = depo.panel;
    if (!p || !depo.analyser) return;
    if (depo.ctx && depo.ctx.state === 'suspended') depo.ctx.resume().catch(() => {});
    depo.analyser.getFloatTimeDomainData(depo.buf);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < depo.buf.length; i += 1) { const v = depo.buf[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    const rms = Math.sqrt(sum / depo.buf.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    const level = Math.max(0, Math.min(1, (db + 60) / 60));
    depo.peak = Math.max(level, depo.peak - 0.01);
    $('.pd9-depo-fill', p).style.width = `${(level * 100).toFixed(1)}%`;
    $('.pd9-depo-peak', p).style.left = `${(depo.peak * 100).toFixed(1)}%`;
    $('.pd9-depo-mini-fill', p).style.width = `${(level * 100).toFixed(1)}%`;

    const now = performance.now();
    const recording = depoRecording() && depo.rec.state === 'recording';
    depo.history.push(recording ? level : -level); // negative = not being recorded (drawn grey)
    if (depo.history.length > 300) depo.history.shift();
    depoWave();

    const time = depoClock(depoElapsed());
    $$('.pd9-depo-time', p).forEach((t) => { if (t.textContent !== time) t.textContent = time; });

    // Warnings
    if (peak >= 0.99) depo.loudUntil = now + 2000;
    if (recording && db < DEPO_QUIET_DB) { if (!depo.quietSince) depo.quietSince = now; } else depo.quietSince = 0;
    const quiet = depo.quietSince && now - depo.quietSince > DEPO_QUIET_MS;
    p.classList.toggle('pd9-depo-quiet', !!quiet);
    if (!depoRecording()) return;
    if (depo.rec.state === 'paused') depoMsg('Paused. Nothing is being recorded.', 'warn');
    else if (quiet) depoMsg('No sound for 15 seconds. Check the microphone.', 'warn');
    else if (now < depo.loudUntil) depoMsg('Too loud. Move the microphone back a little.', 'warn');
    else if (depo.dbFailed) depoMsg('Recording. (The crash backup is off in this browser.)', 'warn');
    else depoMsg('Recording', 'rec');
  }

  function depoWave() {
    const c = depo.panel && $('.pd9-depo-wave', depo.panel);
    if (!c || depo.panel.classList.contains('pd9-depo-mini')) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const step = 3;
    const n = Math.floor(w / step);
    const hist = depo.history.slice(-n);
    const x0 = w - hist.length * step;
    hist.forEach((v, i) => {
      const lv = Math.abs(v);
      const bh = Math.max(2, lv * (h - 4));
      g.fillStyle = v < 0 ? 'rgba(160,170,185,.45)' : lv > 0.9 ? '#f04438' : lv > 0.75 ? '#fdb022' : '#32d583';
      g.fillRect(x0 + i * step, (h - bh) / 2, step - 1, bh);
    });
  }

  async function depoStart() {
    const p = depo.panel;
    const name = $('.pd9-depo-name', p).value.trim();
    if (!name) { depoMsg('Type a name for the file first.', 'bad'); $('.pd9-depo-name', p).focus(); return; }
    const fmt = depoFormat();
    if (!fmt) { depoMsg('This browser cannot record audio. Use Chrome or Edge.', 'bad'); return; }
    try { if (!depo.stream) await depoOpenMic(); } catch (e) { depoMicError(e); return; }
    if (depo.blobUrl) { URL.revokeObjectURL(depo.blobUrl); depo.blobUrl = ''; }
    if (depo.sid && depo.saved) depoDrop(depo.sid).catch(() => {});
    let rec;
    try {
      rec = new MediaRecorder(depo.stream, fmt.mime ? { mimeType: fmt.mime, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 96000 });
    } catch (e) {
      rec = new MediaRecorder(depo.stream);
    }
    depo.rec = rec;
    depo.mime = rec.mimeType || fmt.mime || 'audio/webm';
    depo.ext = /mp4/i.test(depo.mime) ? 'm4a' : 'webm';
    depo.chunks = [];
    depo.saved = false;
    depo.fileName = '';
    depo.startedAt = new Date();
    depo.elapsedMs = 0;
    depo.runStart = performance.now();
    depo.quietSince = 0;
    depo.dbFailed = false;
    depo.sid = `d${Date.now()}`;
    const sid = depo.sid;
    depoPutSession({ id: sid, name, ext: depo.ext, mime: depo.mime, startedAt: depo.startedAt.getTime(), updatedAt: Date.now(), chunks: 0, done: false })
      .catch(() => { depo.dbFailed = true; });
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data || !e.data.size) return;
      depo.chunks.push(e.data);
      if (!depo.dbFailed) depoAddChunk(sid, e.data, depoElapsed()).catch(() => { depo.dbFailed = true; });
    });
    rec.addEventListener('stop', () => depoFinish(sid));
    rec.addEventListener('error', () => depoStop('The recorder hit an error. What was recorded so far was saved.'));
    rec.start(DEPO_SLICE_MS);
    depoKeepAwake(true);
    depoDraw();
    depoMsg('Recording', 'rec');
  }

  function depoPause() {
    if (!depoRecording()) return;
    if (depo.rec.state === 'recording') {
      depo.rec.pause();
      depo.elapsedMs += performance.now() - depo.runStart;
    } else {
      depo.rec.resume();
      depo.runStart = performance.now();
    }
    depoDraw();
  }

  let depoStopNote = '';
  function depoStop(note) {
    if (!depoRecording()) return;
    depoStopNote = note || '';
    if (depo.rec.state === 'recording') depo.elapsedMs += performance.now() - depo.runStart;
    depo.rec.stop(); // the 'stop' event runs depoFinish
  }

  async function depoFinish(sid) {
    if (sid !== depo.sid) return;
    const name = depo.panel ? $('.pd9-depo-name', depo.panel).value.trim() : 'Deposition';
    const blob = await depoFixLength(new Blob(depo.chunks, { type: depo.mime }), depo.elapsedMs);
    depo.fileName = `${depoBase(name, depo.startedAt)}.${depo.ext}`;
    depo.blobUrl = depoDownload(blob, depo.fileName);
    depo.saved = true;
    depo.chunks = [];
    depoKeepAwake(false);
    // Keep the backup until the panel is closed, in case the download did not land.
    depoTx(['sessions'], 'readwrite', (tx) => tx.objectStore('sessions').put({
      id: sid, name, ext: depo.ext, mime: depo.mime, startedAt: depo.startedAt.getTime(), updatedAt: Date.now(), done: true,
    })).catch(() => {});
    depoDraw();
    depoMsg(depoStopNote || `Saved ${depoClock(depo.elapsedMs)} of audio. Check your Downloads folder.`, depoStopNote ? 'warn' : 'ok');
    depoStopNote = '';
    if (depo.panel && depo.panel.classList.contains('pd9-depo-mini')) depo.panel.classList.remove('pd9-depo-mini');
  }

  async function depoKeepAwake(on) {
    try {
      if (on && navigator.wakeLock && !depo.wake) depo.wake = await navigator.wakeLock.request('screen');
      if (!on && depo.wake) { await depo.wake.release(); depo.wake = null; }
    } catch (e) { depo.wake = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && depoRecording()) { depo.wake = null; depoKeepAwake(true); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (!depoRecording()) return;
    e.preventDefault();
    e.returnValue = 'A deposition is still recording.';
  });

  function depoMicError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError') depoMsg('Microphone blocked. Click the lock or mic icon in the address bar, allow the microphone, then try again.', 'bad');
    else if (n === 'NotFoundError') depoMsg('No microphone found. Plug one in and try again.', 'bad');
    else if (n === 'NotReadableError') depoMsg('Another app is using the microphone. Close it and try again.', 'bad');
    else depoMsg(`Could not open the microphone. ${(e && e.message) || ''}`.trim(), 'bad');
  }

  function depoClose() {
    if (depoRecording()) { depo.panel.classList.add('pd9-depo-mini'); toast('Still recording. Stop the recording before you close the recorder.'); return; }
    depoCloseMic();
    if (depo.blobUrl) URL.revokeObjectURL(depo.blobUrl);
    if (depo.sid && depo.saved) depoDrop(depo.sid).catch(() => {});
    if (depo.panel) depo.panel.remove();
    Object.assign(depo, { panel: null, blobUrl: '', sid: '', saved: false, history: [], startedAt: null, elapsedMs: 0, ext: '' });
  }

  function depoBuild() {
    const p = document.createElement('div');
    p.id = 'pd9-depo';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Deposition recorder');
    p.innerHTML = `
      <div class="pd9-depo-head">
        <span class="pd9-depo-dot" aria-hidden="true"></span>
        <b class="pd9-depo-title">Deposition recorder</b>
        <span class="pd9-depo-mini-meter" aria-hidden="true"><span class="pd9-depo-mini-fill"></span></span>
        <span class="pd9-depo-time pd9-depo-mini-time">00:00:00</span>
        <span class="pd9-depo-grow"></span>
        <button type="button" data-act="min" class="pd9-depo-icon" title="Make small" aria-label="Make small">&#8211;</button>
        <button type="button" data-act="close" class="pd9-depo-icon" title="Close" aria-label="Close">&#215;</button>
      </div>
      <div class="pd9-depo-body">
        <div class="pd9-depo-recover" hidden></div>
        <label class="pd9-depo-field"><span>Case</span><input class="pd9-depo-name" type="text" spellcheck="false" autocomplete="off"></label>
        <div class="pd9-depo-saveas">Saves as <span class="pd9-depo-file"></span></div>
        <label class="pd9-depo-field"><span>Microphone</span><select class="pd9-depo-mic"></select></label>
        <canvas class="pd9-depo-wave" aria-hidden="true"></canvas>
        <div class="pd9-depo-meter" aria-hidden="true"><div class="pd9-depo-fill"><div class="pd9-depo-grad"></div></div><div class="pd9-depo-peak"></div></div>
        <div class="pd9-depo-status"><span class="pd9-depo-time pd9-depo-big">00:00:00</span><span class="pd9-depo-msg" role="status" aria-live="polite"></span></div>
        <div class="pd9-depo-btns">
          <button type="button" data-act="rec" class="pd9-depo-rec"><span class="pd9-depo-recdot"></span>Start recording</button>
          <button type="button" data-act="pause" hidden>Pause</button>
          <button type="button" data-act="stop" class="pd9-depo-stop" hidden>Stop and save</button>
          <button type="button" data-act="again" hidden>Download again</button>
        </div>
      </div>`;
    // Keep Filevine and the Improver's hotkeys out of the recorder.
    ['keydown', 'keyup', 'keypress'].forEach((t) => p.addEventListener(t, (e) => { if (e.key !== 'Escape') e.stopPropagation(); }));
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) {
        const act = b.dataset.act;
        if (act === 'rec') depoStart();
        else if (act === 'pause') depoPause();
        else if (act === 'stop') depoStop();
        else if (act === 'again' && depo.blobUrl) {
          const a = document.createElement('a');
          a.href = depo.blobUrl; a.download = depo.fileName; a.click();
        } else if (act === 'min') p.classList.toggle('pd9-depo-mini');
        else if (act === 'close') depoClose();
        else if (act === 'recover-save' || act === 'recover-drop') depoRecoverAct(b);
        return;
      }
      if (p.classList.contains('pd9-depo-mini') && e.target.closest('.pd9-depo-head')) p.classList.remove('pd9-depo-mini');
    });
    $('.pd9-depo-name', p).addEventListener('input', depoDraw);
    $('.pd9-depo-mic', p).addEventListener('change', async (e) => {
      store.set(DEPO_MIC_KEY, e.target.value);
      try { await depoOpenMic(); } catch (err) { depoMicError(err); }
    });
    document.body.appendChild(p);
    return p;
  }

  async function openDepoRecorder(title) {
    if (!depo.panel) depo.panel = depoBuild();
    const p = depo.panel;
    p.classList.remove('pd9-depo-mini');
    const box = $('.pd9-depo-name', p);
    if (!depoRecording() && title) box.value = title;
    depoDraw();
    if (!depo.stream) {
      depoMsg('Asking for the microphone...', '');
      try { await depoOpenMic(); } catch (e) { depoMicError(e); }
    }
    depoDraw();
    depoCheckRecovery();
  }

  // ----- recovery after a crash or closed tab -----
  async function depoCheckRecovery() {
    let list;
    try { list = await depoSessions(); } catch (e) { return; }
    const now = Date.now();
    for (const s of list) {
      if (s.id === depo.sid) continue;
      // Saved fine, or another tab is still recording it.
      if (s.done) { if (now - s.updatedAt > 60000) depoDrop(s.id).catch(() => {}); continue; }
      if (now - s.updatedAt < 30000) continue;
      if (!s.chunks) { depoDrop(s.id).catch(() => {}); continue; }
      if (!depo.panel) depo.panel = depoBuild();
      const box = $('.pd9-depo-recover', depo.panel);
      const mins = Math.max(1, Math.round((s.recMs || s.updatedAt - s.startedAt) / 60000));
      box.innerHTML = `<b>A recording did not finish saving.</b>
        <div>${escapeHtml(s.name || 'Deposition')}, started ${new Date(s.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}, about ${mins} min.</div>
        <div class="pd9-depo-btns"><button type="button" data-act="recover-save" data-sid="${s.id}" class="pd9-depo-rec">Save it now</button><button type="button" data-act="recover-drop" data-sid="${s.id}">Discard</button></div>`;
      box.hidden = false;
      depo.panel.classList.remove('pd9-depo-mini');
      return;
    }
  }

  async function depoRecoverAct(btn) {
    const sid = btn.dataset.sid;
    const box = $('.pd9-depo-recover', depo.panel);
    if (btn.dataset.act === 'recover-drop') {
      if (!confirmDrop(btn)) return;
      await depoDrop(sid).catch(() => {});
      box.hidden = true;
      depoCheckRecovery();
      return;
    }
    const list = await depoSessions().catch(() => []);
    const s = list.find((x) => x.id === sid);
    const parts = await depoChunks(sid).catch(() => []);
    if (!s || !parts.length) { box.innerHTML = 'Nothing could be recovered.'; return; }
    const file = `${depoBase(s.name, new Date(s.startedAt))} (recovered).${s.ext || 'webm'}`;
    const whole = await depoFixLength(new Blob(parts, { type: s.mime || 'audio/webm' }), s.recMs || Math.max(0, (s.updatedAt || s.startedAt) - s.startedAt));
    const url = depoDownload(whole, file);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    await depoTx(['sessions'], 'readwrite', (tx) => tx.objectStore('sessions').put({ ...s, done: true, updatedAt: Date.now() })).catch(() => {});
    box.innerHTML = `Saved <b>${escapeHtml(file)}</b>. Check your Downloads folder.`;
  }

  // "Discard" needs a second click, so a recording is not thrown away by accident.
  function confirmDrop(btn) {
    if (btn.dataset.sure) return true;
    btn.dataset.sure = '1';
    btn.textContent = 'Click again to discard';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Discard'; } }, 4000);
    return false;
  }

  // Case windows are frames: their button asks the main page to open the recorder,
  // so the recording keeps going when the window closes.
  window.addEventListener('message', (e) => {
    if (IN_FRAME || e.origin !== location.origin || !e.data || e.data.pd9 !== 'depo') return;
    openDepoRecorder(String(e.data.title || ''));
  });
  if (!IN_FRAME) setTimeout(() => { depoSessions().then((l) => { if (l.some((s) => !s.done && s.chunks && Date.now() - s.updatedAt > 30000)) depoCheckRecovery(); }).catch(() => {}); }, 4000);

  let depoKey = '';
  function addDepoButton() {
    const key = `${location.href}|${document.title}`;
    if (key === depoKey && document.getElementById('pd9-depo-btn')) return;
    depoKey = key;
    const existing = document.getElementById('pd9-depo-btn');
    if (!inCase()) { if (existing) existing.remove(); return; }
    if (existing) return;
    const vitals = [...document.querySelectorAll('.vitals-toggle button, button')].find((b) => /^\s*vitals\s*$/i.test(b.querySelector('.vitals-btn-text')?.textContent || ''));
    if (!vitals) return;
    const btn = vitals.cloneNode(true);
    btn.id = 'pd9-depo-btn';
    btn.title = 'Record a deposition. The audio file downloads when you stop.';
    const icon = btn.querySelector('i');
    if (icon) {
      const hidden = icon.querySelector('.visually-hidden');
      if (hidden) hidden.textContent = 'slot-text:mic';
      const tn = [...icon.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (tn) tn.nodeValue = 'mic ';
    }
    const label = btn.querySelector('.vitals-btn-text') || btn.querySelector('.text-container');
    if (label) label.textContent = 'Record Depo';
    btn.style.marginRight = '8px';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const title = currentCaseName();
      if (IN_FRAME) { try { window.top.postMessage({ pd9: 'depo', title }, location.origin); } catch (err) { /* ignore */ } return; }
      openDepoRecorder(title);
    });
    const holder = vitals.closest('.vitals-toggle') || vitals;
    holder.before(btn);
  }

  // ---------- Calendar: next event for each case ----------
  // Filevine's calendar (the same request the main Calendar page uses):
  //   GET /api/calendar/displayableevents/<from>/<to>?timezoneOffset=<minutes>
  // Every event is grouped by case, and each case shows its soonest event.
  const UPCOMING_DAYS = 120;

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const firstKey = (o, names) => names.find((k) => o && o[k] != null && o[k] !== '');
  const isDateText = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

  // Calendar entries. Filevine's reply looks like:
  //   data: [ { ownerName, events: [ { title, start, allDay, location, calendarEventType,
  //                                    projectID, project: { projectName, ... } } ] } ]
  // (one entry per calendar shown). We take the biggest list of objects that carry a date.
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
    })(json, 0);
    return best;
  }

  function readEvent(ev) {
    const dateKey = firstKey(ev, ['start', 'startDate', 'startDateTime', 'startTime', 'eventDate', 'date', 'dueDate', 'deadlineDate'])
      || Object.keys(ev).find((k) => isDateText(ev[k]) && !/created|modified|updated|end/i.test(k));
    const proj = ev.project && typeof ev.project === 'object' ? ev.project : null;
    const pidKey = Object.keys(ev).find((k) => /^project_?id$/i.test(k) || /^projectid\d*$/i.test(k));
    const projectId = (pidKey && ev[pidKey]) || (proj && (proj.id || proj.projectId)) || null;
    const projectName = ev[firstKey(ev, ['projectName', 'projectTitle', 'projectDisplayName'])] || (proj && (proj.name || proj.title || proj.projectName)) || '';
    const title = ev[firstKey(ev, ['title', 'name', 'subject', 'summary', 'eventTitle', 'eventName', 'description'])] || '';
    const allDay = !!(ev.allDay || ev.isAllDay || ev.allDayEvent);
    const raw = dateKey ? String(ev[dateKey]) : '';
    // A date with no time (or midnight on an all-day event) is shown as a date only.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) || (allDay && /T00:00:00/.test(raw));
    const when = dateOnly ? new Date(`${raw.slice(0, 10)}T00:00:00`) : new Date(raw);
    return {
      projectId: projectId ? String(projectId) : null, projectName: htmlToText(projectName), title: htmlToText(title), when, dateOnly,
      location: htmlToText(ev.location || ''), type: htmlToText(ev.calendarEventType || ''),
    };
  }

  // Filevine refuses ranges much over 6 weeks ("Start and end range too broad"),
  // so ask in 42-day pieces, all at once, and put them together.
  const UPCOMING_CHUNK_DAYS = 42;

  async function loadUpcoming() {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const chunks = [];
    for (let start = 0; start < UPCOMING_DAYS; start += UPCOMING_CHUNK_DAYS) {
      const a = new Date(from); a.setDate(a.getDate() + start);
      const b = new Date(from); b.setDate(b.getDate() + Math.min(start + UPCOMING_CHUNK_DAYS, UPCOMING_DAYS));
      chunks.push(`/api/calendar/displayableevents/${ymd(a)}/${ymd(b)}?timezoneOffset=${new Date().getTimezoneOffset()}`);
    }
    const replies = await Promise.all(chunks.map(async (url) => {
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (json && json.success === false) throw new Error(json.message || 'calendar error');
      return json;
    }));
    // The same event can show up in two pieces if it sits on the boundary; keep one copy.
    const seen = new Set();
    const events = replies.flatMap((j) => findEvents(j)).filter((ev) => {
      const id = ev.id || ev.eventId || ev.uniqueId || JSON.stringify(ev);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(readEvent)
      .filter((e) => e.projectId && !isNaN(e.when) && e.when >= from);
    // Group by case; keep the soonest event and count the rest.
    const byCase = new Map();
    for (const e of events.sort((a, b) => a.when - b.when)) {
      const cur = byCase.get(e.projectId);
      if (cur) cur.more += 1; else byCase.set(e.projectId, { ...e, more: 0 });
    }
    // Fill in names for cases the calendar didn't name, from the Project Hub list if it's showing.
    for (const row of document.querySelectorAll('.ag-row[row-id]')) {
      const c = byCase.get(row.getAttribute('row-id'));
      const a = row.querySelector('[col-id="ProjectName"] a');
      if (c && !c.projectName && a) c.projectName = a.textContent.trim();
    }
    const list = [...byCase.values()];
    list.forEach((c) => { if (!c.projectName) c.projectName = `Case ${c.projectId}`; });
    return list;
  }

  // ---------- Project Hub: "Next Event" column ----------
  // Adds a column at the end of the Project Hub table with each case's next
  // calendar date and time. One calendar lookup for the whole list, reused for
  // 5 minutes. Click its header to see the list sorted by next event (see below).
  const NEXT_COL = 'pd9NextEvent';
  const NEXT_COL_WIDTH = 165;
  let hubEvents = null;      // Map: case id -> soonest event
  let hubEventsAt = 0;
  let hubEventsLoading = false;

  function loadHubEvents() {
    if (hubEventsLoading || (hubEvents && Date.now() - hubEventsAt < 5 * 60 * 1000)) return;
    hubEventsLoading = true;
    loadUpcoming()
      .then((list) => { hubEvents = new Map(list.map((e) => [e.projectId, e])); hubEventsAt = Date.now(); })
      .catch(() => { hubEvents = hubEvents || new Map(); hubEventsAt = Date.now() - 4 * 60 * 1000; }) // try again in a minute
      .finally(() => { hubEventsLoading = false; showHubEvents(); const ov = document.getElementById('pd9-hub-sorted'); if (ov) drawOwnTable(ov); });
  }

  const shortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  // Event name without " for ..." and everything after it ("Pretrial for Doe, John" -> "Pretrial").
  const shortTitle = (t) => { const full = String(t || '').trim(); return full.replace(/\s+for\b[\s\S]*$/i, '').trim() || full; };

  // "10/3/2026 9:00 AM", or just the date for all-day events.
  const eventStamp = (e) => (e.dateOnly ? shortDate(e.when) : `${shortDate(e.when)} ${e.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  const px = (el, prop) => parseFloat(el.style[prop]) || 0;

  // The columns we add, in order. Only the date column sorts.
  const HUB_EXTRA = [
    { id: NEXT_COL, label: 'Next Event', width: NEXT_COL_WIDTH, text: (e) => eventStamp(e), sorts: true },
    { id: 'pd9NextTitle', label: 'Event', width: 220, text: (e) => shortTitle(e.title) },
  ];
  const isOurs = (el) => HUB_EXTRA.some((c) => c.id === el.getAttribute('col-id'));

  function showHubEvents() {
    if (!onHub()) return;
    const headerRow = $('.ag-header-row-column') || $('.ag-header-row');
    const body = $('.ag-center-cols-container');
    if (!headerRow || !body || !headerRow.querySelector('.ag-header-cell[col-id]')) return; // table not loaded yet
    loadHubEvents();

    // Where Filevine's own columns end; ours go after, one after another.
    const theirs = [...headerRow.querySelectorAll('.ag-header-cell[col-id]')].filter((c) => !isOurs(c));
    let left = Math.max(...theirs.map((c) => px(c, 'left') + px(c, 'width')));
    const lefts = HUB_EXTRA.map((c) => { const at = left; left += c.width; return at; });
    const total = left;

    // Header cells: copies of Filevine's last header, relabeled (copies don't carry its sorting).
    HUB_EXTRA.forEach((c, i) => {
      let head = headerRow.querySelector(`[col-id="${c.id}"]`);
      if (!head) {
        head = theirs[theirs.length - 1].cloneNode(true);
        head.setAttribute('col-id', c.id);
        head.removeAttribute('aria-sort');
        head.removeAttribute('aria-description');
        head.classList.remove('ag-header-cell-sortable');
        head.querySelectorAll('.ag-header-icon, .ag-header-cell-resize, input').forEach((el) => el.remove());
        const t = head.querySelector('.ag-header-cell-text');
        if (t) t.textContent = c.label;
        if (c.sorts) {
          head.title = 'Click to sort the list by next event';
          head.style.cursor = 'pointer';
          head.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openNextEventSort(); }, true);
        }
        headerRow.appendChild(head);
      }
      if (px(head, 'left') !== lefts[i]) { head.style.left = `${lefts[i]}px`; head.style.width = `${c.width}px`; }
    });

    // Make room: widen the table so the new columns aren't cut off.
    const widen = (el, extra = 0) => { if (el && px(el, 'width') < total + extra) el.style.width = `${total + extra}px`; };
    widen(headerRow);
    widen($('.ag-header-container'), 8);
    widen(body);
    widen($('.ag-body-horizontal-scroll-container'));

    // Cells. Rows get reused as you scroll, so match by case id each time.
    for (const row of body.querySelectorAll('.ag-row[row-id]')) {
      const pid = row.getAttribute('row-id');
      const model = row.querySelector('.ag-cell[col-id="Created"]') || row.querySelector('.ag-cell:last-child');
      const e = hubEvents && hubEvents.get(pid);
      HUB_EXTRA.forEach((c, i) => {
        let cell = row.querySelector(`[col-id="${c.id}"]`);
        if (!cell) {
          if (!model) return;
          cell = model.cloneNode(false);
          cell.setAttribute('col-id', c.id);
          cell.removeAttribute('aria-colindex');
          row.appendChild(cell);
        }
        if (px(cell, 'left') !== lefts[i]) { cell.style.left = `${lefts[i]}px`; cell.style.width = `${c.width}px`; }
        const text = !hubEvents ? (i === 0 ? '...' : '') : e ? c.text(e) : '';
        if (cell.dataset.pid !== pid || cell.textContent !== text) {
          cell.dataset.pid = pid;
          cell.textContent = text;
          cell.title = e ? [e.title, e.location].filter(Boolean).join(' | ') : '';
        }
      });
    }
  }


  // ---------- Project Hub: our own table ----------
  // Columns: Case Number | Defendant (Last, First) | Last Activity | Next Event | Tags.
  // Data:
  //   the list:   POST /api/projectHub/search (the same request the Project Hub makes),
  //               using the filters in the Project Hub's address
  //   the names:  each client's contact card, GET /api/v2/org/<org>/project/<case>/person/<client>
  //               (real first and last name fields, no guessing)
  //   the events: the calendar (same as the Next Event column)
  // It sits over Filevine's table. "Filevine's table" switches back (remembered).
  const HUB_VIEW_KEY = 'pd9-hub-own-table';
  const HUB_SORT_KEY = 'pd9-hub-own-sort';
  const nameCache = new Map(); // client id -> "Last, First" (kept in memory only)
  let hubTable = null; // { href, rows, loading }

  // Filevine's own "Show archived" and "Pinned only" toggles in the filter bar.
  function hubToggle(label) {
    const span = [...document.querySelectorAll('.filters-and-pin label .form-field-label')].find((el) => el.textContent.trim().toLowerCase() === label);
    const input = span && span.closest('label').querySelector('input[type=checkbox]');
    return input ? input.checked : null;
  }
  const hubFilterKey = () => `${location.href}|${hubToggle('show archived')}|${hubToggle('pinned only')}`;

  function hubParams() {
    const q = new URLSearchParams((location.hash.split('?')[1]) || '');
    const num = (k) => (q.get(k) && !isNaN(+q.get(k)) ? +q.get(k) : null);
    const list = (k) => q.getAll(k).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    return {
      query: q.get('q') || q.get('query') || q.get('search') || '',
      orgID: num('org') || num('orgID'),
      includeArchived: q.has('archived') ? q.get('archived') !== 'false' : false,
      filterByPhaseID: num('phase') || num('phaseID'),
      filterByPhaseNames: list('phaseNames'),
      filterByFirstPrimaryUserID: num('primary'),
      filterByIsPrimary: q.get('isPrimary') === 'true',
      filterByIsPinned: q.get('pinned') === 'true',
      filterByIsFollowing: q.get('following') === 'true',
      filterByProjectTypeID: num('type') || num('projectType'),
      filterByHashtags: list('hashtags'),
      filterByRoles: list('roles'),
      ...(hubToggle('show archived') !== null ? { includeArchived: hubToggle('show archived') } : {}),
      ...(hubToggle('pinned only') !== null ? { filterByIsPinned: hubToggle('pinned only') } : {}),
      filterByMinimumAccessLevel: 0,
      includeAggregateCounts: false,
      sort: q.get('sort') || 'ProjectName',
      direction: q.get('direction') || 'Ascending',
    };
  }

  async function loadHubList(saved) {
    const base = saved ? { ...saved } : hubParams();
    if (!saved && onHub() && base.orgID) store.set(SWITCH_PARAMS_KEY, base); // remember "my cases" for the case switcher
    if (!base.orgID) {
      const any = hubEvents && [...hubEvents.values()][0];
      base.orgID = null;
      if (any && any.orgID) base.orgID = any.orgID;
    }
    const hits = [];
    for (let skip = 0; skip < 2000; skip += 200) {
      const res = await fetch('/api/projectHub/search', {
        method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, skip, take: 200 }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const data = json && json.data;
      if (!data || !Array.isArray(data.hits)) throw new Error(json && json.message ? json.message : 'unexpected reply');
      hits.push(...data.hits);
      if (!data.hasMore || !data.hits.length) break;
    }
    return hits.map((h) => ({
      id: String(h.projectID || h.id),
      orgID: h.orgID,
      clientID: h.clientID,
      caseNo: (String(h.projectName || '').split('|')[1] || h.number || '').trim(),
      clientName: htmlToText(h.clientName || String(h.projectName || '').split('|')[0]),
      picture: h.pictureUrl && !/default/i.test(h.pictureUrl) ? h.pictureUrl : '',
      lastActivity: h.lastActivity ? new Date(h.lastActivity) : null,
      // Tags with their Filevine color (tagsV2 has the color; hashtags is just the names).
      tags: (h.tagsV2 && h.tagsV2.length
        ? h.tagsV2.filter((t) => !t.isArchived).map((t) => ({ name: t.name, color: t.colorNumber }))
        : (h.hashtags || []).map((t) => ({ name: t, color: null })))
        .map((t) => ({ name: String(t.name).startsWith('#') ? t.name : `#${t.name}`, color: t.color })),
      // Every tag on the case with its id (archived and automatic ones too), for editing tags.
      allTags: h.tagsV2 && h.tagsV2.length && h.tagsV2.every((t) => t.id)
        ? h.tagsV2.map((t) => ({ id: t.id, name: t.name, color: t.colorNumber, isArchived: !!t.isArchived, isAutoTag: !!t.isAutoTag }))
        : null,
    }));
  }

  async function loadName(r) {
    if (!r.clientID || !r.orgID) return null;
    if (nameCache.has(r.clientID)) return nameCache.get(r.clientID);
    const res = await fetch(`/api/v2/org/${encodeURIComponent(r.orgID)}/project/${encodeURIComponent(r.id)}/person/${encodeURIComponent(r.clientID)}`,
      { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const p = findObjectsWith(await res.json(), 'lastName')[0];
    const last = p && String(p.lastName || '').trim();
    const first = p && String(p.firstName || '').trim();
    const name = last ? (first ? `${last}, ${first}` : last) : null;
    nameCache.set(r.clientID, name);
    return name;
  }

  // Cases ticked for adding an activity to several at once (this page only).
  const bulkPicked = new Set();
  let bulkLastIndex = null;

  // ---------- PD9 table: columns, look, and saved view ----------
  const HUB_LAYOUT_KEY = 'pd9-hub-own-layout'; // { order: [...], widths: {...} }
  const nextOf = (r) => hubEvents && hubEvents.get(r.id);
  const OWN_COLS = [
    { key: 'caseNo', label: 'Case Number', width: 190, sort: (r) => caseValue(r.caseNo) },
    { key: 'defendant', label: 'Defendant', width: 230, sort: (r) => (r.defendant || r.clientName || '').toLowerCase() },
    { key: 'lastActivity', label: 'Last Activity', width: 130, sort: (r) => (r.lastActivity ? r.lastActivity.getTime() : 0) },
    { key: 'next', label: 'Next Event', width: 170, sort: (r) => { const e = nextOf(r); return e ? e.when.getTime() : null; } },
    { key: 'event', label: 'Event', width: 220, sort: (r) => { const e = nextOf(r); return e && e.title ? shortTitle(e.title).toLowerCase() : null; } },
    { key: 'tags', label: 'Tags', width: 260, sort: (r) => (r.tags.length ? r.tags.map((t) => t.name).join(' ').toLowerCase() : null) },
    { key: 'charges', label: 'Charges', width: 150, sort: (r) => { const n = knownCharges(r.id); return n ? n.length : null; } },
  ];

  // ---------- Pinned cases (PD9 table) ----------
  // Your own pins, kept by Tampermonkey. Pinned cases stay at the top of the table.
  const PIN_KEY = 'pd9-hub-pins';
  const pinSet = () => new Set((store.get(PIN_KEY, []) || []).map(String));
  function togglePin(id) {
    const pins = pinSet();
    if (pins.has(String(id))) pins.delete(String(id)); else pins.add(String(id));
    store.set(PIN_KEY, [...pins]);
  }

  // Charges we already know from Case Summary (from the search panels' cache), or null.
  function knownCharges(id) {
    const x = extraCache.get(id) || extraCache.get(String(id));
    if (!x || x.charges === undefined || x.charges === 'n/a') return null;
    return String(x.charges).split('\n').filter(Boolean);
  }

  function ownLayout() {
    const saved = store.get(HUB_LAYOUT_KEY, null) || {};
    const known = OWN_COLS.map((c) => c.key);
    const order = (saved.order || []).filter((k) => known.includes(k));
    known.forEach((k) => { if (!order.includes(k)) order.push(k); }); // new columns go at the end
    return { order, widths: saved.widths || {} };
  }
  const saveLayout = (layout) => store.set(HUB_LAYOUT_KEY, layout);

  // Use Filevine's font so the table feels native; the rest is our own look.
  function matchFilevineLook(ov) {
    const cell = $('.ag-center-cols-container .ag-cell') || $('.ag-header-cell');
    if (cell) ov.style.setProperty('--pd9-font', getComputedStyle(cell).fontFamily);
  }


  // "Sep 29" this year, "Sep 29, 2025" otherwise; with the weekday for upcoming dates ("Fri, Oct 3").
  function niceDate(d, weekday = false) {
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString([], { ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  // ---------- client avatar circles (like Filevine's Project Hub) ----------
  // Same initials (first and last name) and, where possible, the same color
  // Filevine uses. Colors Filevine has already shown are remembered; for the
  // rest, the script works out Filevine's color rule from the ones it has seen.
  const AVATAR_KEY = 'pd9-avatar-colors';
  let avatarRule = null; // { by: 'clientID' | 'id', mod, add } once worked out
  function learnAvatarColors() {
    if (!hubTable || !hubTable.rows) return;
    const byId = new Map(hubTable.rows.map((r) => [r.id, r]));
    const known = store.get(AVATAR_KEY, null) || {};
    let added = false;
    for (const row of document.querySelectorAll('.ag-row[row-id]')) {
      const av = row.querySelector('[col-id="ProjectName"] .fvs-avatar');
      const m = av && av.className.match(/fvs-avatar--color-(\d+)/);
      const r = byId.get(row.getAttribute('row-id'));
      if (!m || !r || !r.clientID) continue;
      if (known[r.clientID] !== +m[1]) { known[r.clientID] = +m[1]; added = true; }
    }
    if (added) store.set(AVATAR_KEY, known);
    // Find the simple rule that explains every color seen (needs a few examples).
    const seen = hubTable.rows.filter((r) => r.clientID && known[r.clientID]);
    if (seen.length >= 4 && !avatarRule) {
      for (const by of ['clientID', 'id']) for (let mod = 6; mod <= 16; mod++) for (const add of [0, 1]) {
        if (seen.every((r) => (+r[by] % mod) + add === known[r.clientID])) { avatarRule = { by, mod, add }; return; }
      }
    }
  }
  function avatarColor(r) {
    const known = store.get(AVATAR_KEY, null) || {};
    if (r.clientID && known[r.clientID]) return known[r.clientID];
    if (avatarRule) return (+r[avatarRule.by] % avatarRule.mod) + avatarRule.add;
    let h = 0;
    for (const ch of String(r.clientName || r.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return (h % 12) + 1;
  }
  function avatarFor(r) {
    const el = document.createElement('span');
    el.className = 'pd9-av';
    el.setAttribute('aria-hidden', 'true');
    if (r.picture) {
      const img = document.createElement('img');
      img.src = r.picture;
      img.alt = '';
      img.loading = 'lazy';
      el.appendChild(img);
      return el;
    }
    const words = String(r.clientName || '').trim().split(/\s+/).filter(Boolean);
    el.textContent = ((words[0] || '?')[0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
    el.style.setProperty('--pd9-av', `var(--t-color-object-${avatarColor(r)}-primary, #1f7a77)`);
    return el;
  }

  // A tag chip, tinted with the color Filevine gives that tag.
  function tagChip(tag) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pd9-tag';
    if (tag.color != null) chip.style.setProperty('--pd9-tag', `var(--t-color-object-${tag.color}-primary, #1f7a77)`);
    chip.textContent = tag.name.replace(/^#/, '');
    chip.dataset.tag = tag.name.toLowerCase();
    const on = tagFilter().tags.includes(chip.dataset.tag);
    chip.classList.toggle('pd9-tag-on', on);
    chip.setAttribute('aria-pressed', String(on));
    const alt = /Mac/i.test(navigator.platform) ? 'Option' : 'Alt';
    chip.title = on ? `Stop filtering by ${tag.name}` : `Click: only cases tagged ${tag.name}\n${alt}+click: hide cases tagged ${tag.name}`;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) toggleTagExclude(chip.dataset.tag); else toggleTagFilter(chip.dataset.tag);
    });
    return chip;
  }

  // ---------- tag filter for the PD9 table (saved) ----------
  const TAG_FILTER_KEY = 'pd9-hub-own-tagfilter';
  // tags: must have (All or Any of them). not: must NOT have any of these.
  const tagFilter = () => { const f = store.get(TAG_FILTER_KEY, null) || {}; return { tags: f.tags || [], not: f.not || [], mode: f.mode === 'any' ? 'any' : 'all' }; };
  function setTagFilter(f) {
    store.set(TAG_FILTER_KEY, f);
    const ov = document.getElementById('pd9-hub-sorted');
    if (ov) drawOwnTable(ov);
  }
  function toggleTagFilter(tag) {
    const f = tagFilter();
    f.not = f.not.filter((t) => t !== tag);
    f.tags = f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag];
    setTagFilter(f);
  }
  function toggleTagExclude(tag) {
    const f = tagFilter();
    f.tags = f.tags.filter((t) => t !== tag);
    f.not = f.not.includes(tag) ? f.not.filter((t) => t !== tag) : [...f.not, tag];
    setTagFilter(f);
  }
  function passesTagFilter(r) {
    const f = tagFilter();
    if (!f.tags.length && !f.not.length) return true;
    const mine = r.tags.map((t) => t.name.toLowerCase());
    if (f.not.some((t) => mine.includes(t))) return false; // has a tag you excluded
    if (!f.tags.length) return true;
    return f.mode === 'any' ? f.tags.some((t) => mine.includes(t)) : f.tags.every((t) => mine.includes(t));
  }

  // The funnel in the Tags header: every tag in the list, with counts.
  function openTagMenu(anchor, ov) {
    const old = ov.querySelector('.pd9-tag-menu');
    if (old) { old.remove(); return; }
    const counts = new Map();
    const colors = new Map();
    for (const r of hubTable.rows) for (const t of r.tags) {
      const k = t.name.toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!colors.has(k)) colors.set(k, { name: t.name, color: t.color });
    }
    const menu = document.createElement('div');
    menu.className = 'pd9-tag-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Filter by tags');
    const f = tagFilter();
    menu.innerHTML = `
      <div class="pd9-tm-head">
        <input type="search" class="pd9-tm-find" placeholder="Find a tag" aria-label="Find a tag">
        <div class="pd9-tm-mode" role="radiogroup" aria-label="Match">
          <button type="button" data-mode="all" role="radio" aria-checked="${f.mode === 'all'}" title="Cases with every checked tag">All</button>
          <button type="button" data-mode="any" role="radio" aria-checked="${f.mode === 'any'}" title="Cases with any checked tag">Any</button>
        </div>
      </div>
      <div class="pd9-tm-list"></div>
      <div class="pd9-tm-foot"><button type="button" class="pd9-tm-clear">Clear</button></div>`;
    const list = menu.querySelector('.pd9-tm-list');
    const sorted = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
    const drawList = () => {
      const q = menu.querySelector('.pd9-tm-find').value.trim().toLowerCase().replace(/^#/, '');
      const cur = tagFilter();
      list.textContent = '';
      for (const k of sorted) {
        if (q && !k.replace(/^#/, '').includes(q)) continue;
        const row = document.createElement('label');
        row.className = 'pd9-tm-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = cur.tags.includes(k);
        cb.addEventListener('change', () => { toggleTagFilter(k); drawList(); });
        const chip = document.createElement('span');
        chip.className = 'pd9-tag pd9-tag-static';
        const c = colors.get(k);
        if (c.color != null) chip.style.setProperty('--pd9-tag', `var(--t-color-object-${c.color}-primary, #1f7a77)`);
        chip.textContent = c.name.replace(/^#/, '');
        const n = document.createElement('span');
        n.className = 'pd9-tm-count';
        n.textContent = counts.get(k);
        const excluded = cur.not.includes(k);
        if (excluded) { row.classList.add('pd9-tm-not'); chip.classList.add('pd9-tag-not'); }
        const notBtn = document.createElement('button');
        notBtn.type = 'button';
        notBtn.className = 'pd9-tm-notbtn';
        notBtn.textContent = 'Not';
        notBtn.setAttribute('aria-pressed', String(excluded));
        notBtn.title = excluded ? `Stop hiding cases tagged ${c.name}` : `Hide cases tagged ${c.name}`;
        notBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleTagExclude(k); drawList(); });
        row.append(cb, chip, n, notBtn);
        list.appendChild(row);
      }
      if (!list.children.length) list.innerHTML = '<p class="pd9-tm-empty">No tags match.</p>';
    };
    menu.querySelector('.pd9-tm-find').addEventListener('input', drawList);
    menu.querySelectorAll('.pd9-tm-mode button').forEach((b) => b.addEventListener('click', () => {
      setTagFilter({ ...tagFilter(), mode: b.dataset.mode });
      menu.querySelectorAll('.pd9-tm-mode button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    menu.querySelector('.pd9-tm-clear').addEventListener('click', () => { setTagFilter({ ...tagFilter(), tags: [], not: [] }); drawList(); });
    drawList();
    const r = anchor.getBoundingClientRect();
    const o = ov.getBoundingClientRect();
    menu.style.top = `${r.bottom - o.top + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left - o.left, o.width - 288))}px`;
    ov.appendChild(menu);
    menu.querySelector('.pd9-tm-find').focus();
    const away = (e) => {
      if (!menu.isConnected) { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); return; }
      if (!menu.contains(e.target) && !e.target.closest('.pd9-tag-funnel')) { menu.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); }
    };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); menu.remove(); anchor.focus(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
  }


  function cellFor(key, r, td) {
    const e = nextOf(r);
    switch (key) {
      case 'caseNo': {
        const a = document.createElement('a');
        a.href = `#/project/${encodeURIComponent(r.id)}/activity`;
        a.textContent = r.caseNo || `Case ${r.id}`;
        // Window mode: open in a case window. Otherwise: open in the case tab.
        // All cases share one case tab, so after the first, switching cases there
        // skips reloading all of Filevine. Ctrl+click still opens a fresh tab.
        a.target = CASE_TAB;
        // Middle click opens a new tab the browser's normal way (the link's address).
        a.addEventListener('mouseenter', () => { if (windowMode()) prefetchCase(r.id); });
        a.addEventListener('mouseleave', () => clearTimeout(prefetchTimer));
        a.addEventListener('click', (ev) => {
          if (ev.button !== 0) return;
          if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { ev.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; } // a fresh tab
          if (!windowMode()) return; // the shared case tab, as the link says
          ev.preventDefault();
          openCaseWindow(r.id, `${r.caseNo || ''}  ${r.defendant || r.clientName || ''}`.trim());
        });
        td.appendChild(a);
        break;
      }
      case 'defendant': {
        const wrap = document.createElement('span');
        wrap.className = 'pd9-who';
        wrap.appendChild(avatarFor(r));
        const nm = document.createElement('span');
        nm.className = 'pd9-who-name';
        nm.textContent = r.defendant || r.clientName || '';
        wrap.appendChild(nm);
        td.appendChild(wrap);
        if (!r.defendant) td.classList.add('pd9-own-pending');
        break;
      }
      case 'lastActivity': td.textContent = r.lastActivity ? niceDate(r.lastActivity) : ''; break;
      case 'next': {
        if (!hubEvents) { td.innerHTML = '<span class="pd9-skel-line"></span>'; break; }
        if (!e) { td.innerHTML = '<span class="pd9-none">None scheduled</span>'; break; }
        const days = Math.round((new Date(e.when).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
        const tile = document.createElement('span');
        tile.className = `pd9-when${days <= 2 ? ' pd9-soon' : ''}`;
        const d1 = document.createElement('span');
        d1.className = 'pd9-when-day';
        d1.textContent = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : niceDate(e.when, true);
        const d2 = document.createElement('span');
        d2.className = 'pd9-when-time';
        d2.textContent = e.dateOnly ? 'All day' : e.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        tile.append(d1, d2);
        td.appendChild(tile);
        td.title = `${eventStamp(e)}${e.title ? `\n${e.title}` : ''}${e.location ? `\n${e.location}` : ''}`;
        break;
      }
      case 'event':
        td.textContent = e ? shortTitle(e.title) : '';
        if (e) td.title = [e.title, e.location].filter(Boolean).join('\n'); // full name on hover
        break;
      case 'tags': {
        r.tags.forEach((t) => td.appendChild(tagChip(t)));
        td.classList.add('pd9-own-tags');
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'pd9-tag-add';
        plus.title = 'Add or remove tags';
        plus.setAttribute('aria-label', `Edit tags for ${r.caseNo || 'this case'}`);
        plus.textContent = '+';
        plus.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openTagEditor(plus, [r], plus.closest('#pd9-hub-sorted')); });
        td.appendChild(plus);
        break;
      }
      case 'charges': {
        // Same as Advanced Search: click for the full table from the Charges tab.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pd9-charges-btn';
        const known = knownCharges(r.id);
        btn.textContent = known && known.length ? `View ${known.length} charge${known.length === 1 ? '' : 's'}` : 'View charges';
        if (known && known.length) btn.title = known.join('\n');
        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const d = { name: r.defendant || r.clientName || '', caseNo: r.caseNo || '' };
          let list = knownCharges(r.id);
          if (!list) {
            // Get the Case Summary list too, as a backup if the Charges tab is empty.
            btn.disabled = true;
            const was = btn.textContent;
            btn.textContent = 'Loading...';
            try {
              const obj = await loadCaseSummary(r.id);
              list = String(pickField(obj, 'charges') || '').split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
            } catch (e) { list = []; }
            btn.disabled = false;
            btn.textContent = list.length ? `View ${list.length} charge${list.length === 1 ? '' : 's'}` : was;
            if (list.length) btn.title = list.join('\n');
          }
          showCharges(d, list, r.id);
        });
        td.appendChild(btn);
        break;
      }
      default: break;
    }
  }

  // ---------- Add and remove tags from the PD9 table ----------
  // Uses the same calls as Filevine's own Edit Tags: the org's tag list
  // (/api/tagsv2/<org>/index) and saving the case's full tag list
  // (/api/projects/<id>/hashtags). Saving sends every tag the case keeps, so
  // the script first reads the case's current tags and never drops one by accident.
  const orgTagCache = new Map(); // org -> { at, list }
  async function loadOrgTags(orgId) {
    const hit = orgTagCache.get(orgId);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list;
    const byId = new Map();
    const tries = [{ orgId: +orgId, ArchivedStatus: 'Exclude' }, { orgId: +orgId, ArchivedStatus: 'None' }, { orgId: +orgId }];
    for (const body of tries) {
      try {
        const res = await fetch(`/api/tagsv2/${encodeURIComponent(orgId)}/index`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) continue;
        const json = await res.json();
        const docs = (json && json.data && json.data.documents) || [];
        docs.filter((t) => t && t.id && !t.isArchived).forEach((t) => byId.set(t.id, { id: t.id, name: t.name, color: t.colorNumber, desc: t.description || '', count: t.projectCount || 0 }));
        if (byId.size) break;
      } catch (e) { /* try the next way */ }
    }
    // Add tags seen on your cases, in case the list above came back short.
    for (const r of (hubTable && hubTable.rows) || []) (r.allTags || []).forEach((t) => { if (!t.isArchived && !byId.has(t.id)) byId.set(t.id, { id: t.id, name: t.name, color: t.color, desc: '', count: 0 }); });
    const list = [...byId.values()].map((t) => ({ ...t, name: String(t.name).startsWith('#') ? t.name : `#${t.name}` }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    orgTagCache.set(orgId, { at: Date.now(), list });
    return list;
  }
  // The case's tags right now (with ids), straight from Filevine if possible.
  async function currentCaseTags(r) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(r.id)}/hashtags`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        const tags = json && json.data && (json.data.tags || (Array.isArray(json.data) ? json.data : null));
        if (Array.isArray(tags) && tags.every((t) => t.id)) return tags.map((t) => ({ id: t.id, name: t.name, color: t.colorNumber, isArchived: !!t.isArchived, isAutoTag: !!t.isAutoTag }));
      }
    } catch (e) { /* use what the Project Hub gave us */ }
    if (r.allTags) return r.allTags;
    throw new Error('Could not read this case\'s current tags, so nothing was changed. Use Edit Tags on the case instead.');
  }
  async function saveCaseTags(r, tags) {
    const res = await fetch(`/api/projects/${encodeURIComponent(r.id)}/hashtags`, {
      method: 'POST', credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIDs: [...new Set(tags.map((t) => t.id))] }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) throw new Error((json && json.message) || `Filevine said no (error ${res.status}).`);
    const saved = (json.data && json.data.tags) || tags;
    r.allTags = saved.map((t) => ({ id: t.id, name: t.name, color: t.colorNumber != null ? t.colorNumber : t.color, isArchived: !!t.isArchived, isAutoTag: !!t.isAutoTag }));
    r.tags = r.allTags.filter((t) => !t.isArchived).map((t) => ({ name: String(t.name).startsWith('#') ? t.name : `#${t.name}`, color: t.color }));
    return r;
  }
  async function changeCaseTag(r, tag, add) {
    const now = await currentCaseTags(r);
    const has = now.some((t) => t.id === tag.id);
    if (add === has) return r; // nothing to do
    const next = add ? [...now, tag] : now.filter((t) => t.id !== tag.id);
    await saveCaseTags(r, next);
    if (add && !r.allTags.some((t) => t.id === tag.id)) throw new Error(`Filevine didn't keep ${tag.name}.`);
    return r;
  }

  // The little tag editor: tags on the case (click x to remove), and a search box to add more.
  // `rows` is one case, or several (from "Add tag" with cases selected).
  function openTagEditor(anchor, rows, ov) {
    document.querySelectorAll('.pd9-tag-edit').forEach((m) => m.remove());
    const many = rows.length > 1;
    const r0 = rows[0];
    const box = document.createElement('div');
    box.className = 'pd9-tag-edit';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', many ? `Add a tag to ${rows.length} cases` : `Tags for ${r0.caseNo}`);
    box.innerHTML = `
      <div class="pd9-te-title">${many ? `Add a tag to ${rows.length} cases` : `Tags: ${escapeAttr(r0.caseNo || '')}`}</div>
      ${many ? '' : '<div class="pd9-te-on"></div>'}
      <input type="search" class="pd9-te-find" placeholder="Find a tag to add" aria-label="Find a tag to add" autocomplete="off">
      <ul class="pd9-te-list" role="listbox"></ul>
      <div class="pd9-te-note" aria-live="polite"></div>`;
    document.body.appendChild(box);
    const rect = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
    box.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 340)}px`;
    const find = box.querySelector('.pd9-te-find');
    const list = box.querySelector('.pd9-te-list');
    const note = box.querySelector('.pd9-te-note');
    const onBox = box.querySelector('.pd9-te-on');
    let all = [];
    let busy = false;
    let active = 0;
    const say = (t, bad) => { note.textContent = t || ''; note.classList.toggle('pd9-te-bad', !!bad); };
    const drawOn = () => {
      if (!onBox) return;
      onBox.textContent = '';
      const shown = (r0.allTags || r0.tags.map((t) => ({ ...t, id: null }))).filter((t) => !t.isArchived);
      if (!shown.length) { onBox.innerHTML = '<span class="pd9-te-none">No tags yet</span>'; return; }
      shown.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'pd9-te-chip';
        if (t.color != null) chip.style.setProperty('--pd9-tag', `var(--t-color-object-${t.color}-primary, #1f7a77)`);
        chip.textContent = String(t.name).replace(/^#/, '');
        if (t.id && !t.isAutoTag) {
          const x = document.createElement('button');
          x.type = 'button';
          x.setAttribute('aria-label', `Remove ${t.name}`);
          x.title = `Remove ${t.name}`;
          x.textContent = '×';
          x.addEventListener('click', () => apply(t, false));
          chip.appendChild(x);
        } else if (t.isAutoTag) chip.title = 'Added automatically by Filevine';
        onBox.appendChild(chip);
      });
    };
    const drawList = () => {
      const q = find.value.trim().toLowerCase().replace(/^#/, '');
      const have = new Set(many ? [] : (r0.allTags || []).map((t) => t.id));
      const items = all.filter((t) => !have.has(t.id) && (!q || t.name.toLowerCase().replace(/^#/, '').includes(q))).slice(0, 40);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.textContent = '';
      items.forEach((t, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.className = i === active ? 'pd9-te-active' : '';
        const dot = document.createElement('span');
        dot.className = 'pd9-te-dot';
        if (t.color != null) dot.style.setProperty('--pd9-tag', `var(--t-color-object-${t.color}-primary, #1f7a77)`);
        const nm = document.createElement('span');
        nm.textContent = t.name;
        li.append(dot, nm);
        if (t.desc) li.title = t.desc;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); apply(t, true); });
        list.appendChild(li);
      });
      if (!items.length) list.innerHTML = `<li class="pd9-te-empty">${all.length ? 'No matching tag' : 'Loading tags...'}</li>`;
      list._items = items;
    };
    async function apply(tag, add) {
      if (busy) return;
      busy = true;
      box.classList.add('pd9-te-busy');
      let done = 0, failed = 0, lastErr = '';
      for (const r of rows) {
        say(many ? `${add ? 'Adding' : 'Removing'} ${tag.name}: ${done + failed + 1} of ${rows.length}...` : `${add ? 'Adding' : 'Removing'} ${tag.name}...`);
        try { await changeCaseTag(r, tag, add); done++; } catch (e) { failed++; lastErr = e.message; }
      }
      busy = false;
      box.classList.remove('pd9-te-busy');
      say(failed ? `${failed} didn't save. ${lastErr}` : (many ? `Added ${tag.name} to ${done} case${done === 1 ? '' : 's'}.` : ''), !!failed);
      if (done) {
        try { if (typeof saveHubTableCache === 'function') saveHubTableCache(); } catch (e) { /* not needed */ }
        if (ov && ov.isConnected) drawOwnTable(ov);
      }
      find.value = '';
      drawOn();
      drawList();
      find.focus();
    }
    find.addEventListener('input', () => { active = 0; drawList(); });
    find.addEventListener('keydown', (e) => {
      const items = list._items || [];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; drawList(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) apply(items[active], true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!box.contains(e.target) && e.target !== anchor) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    drawOn();
    drawList();
    find.focus();
    loadOrgTags(r0.orgID || 221).then((l) => { all = l; drawList(); }).catch(() => say('Could not load the tag list.', true));
  }

  // On a wide screen the table fills the space. Spread the extra width over the
  // real columns only, so the checkbox column stays narrow.
  function fitHubColumns(table) {
    const wrap = table && table.closest('.pd9-hs-wrap');
    if (!wrap) return;
    const cols = [...table.querySelectorAll('col')];
    const pick = cols[0];
    const rest = cols.slice(1);
    rest.forEach((c) => { if (!c.dataset.base) c.dataset.base = String(parseFloat(c.style.width) || 100); });
    const pickW = parseFloat(pick.style.width) || 50;
    const base = rest.reduce((n, c) => n + Number(c.dataset.base), 0);
    const room = wrap.clientWidth - pickW;
    const factor = room > base ? room / base : 1;
    rest.forEach((c) => { c.style.width = `${Math.floor(Number(c.dataset.base) * factor)}px`; });
    table.style.width = `${pickW + rest.reduce((n, c) => n + parseFloat(c.style.width), 0)}px`;
  }
  window.addEventListener('resize', () => { const t = document.querySelector('#pd9-hub-sorted .pd9-hs-wrap table'); if (t) fitHubColumns(t); });

  function drawOwnTable(ov) {
    if (!hubTable || !hubTable.rows) return;
    learnAvatarColors();
    const layout = ownLayout();
    const cols = layout.order.map((k) => OWN_COLS.find((c) => c.key === k));
    const sort = store.get(HUB_SORT_KEY, null) || { col: 'next', dir: 'asc' };
    const col = OWN_COLS.find((c) => c.key === sort.col) || OWN_COLS[3];
    // Hook for the separate PD9 Manager script: it sets data-pd9-county="OS" on the page
    // to show only cases whose number ends in that county code. Nothing happens without it.
    const county = (document.documentElement.getAttribute('data-pd9-county') || '').toUpperCase();
    const inCounty = (r) => !county || String(r.caseNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').endsWith(county);
    const pins = pinSet();
    const rows = hubTable.rows.filter((r) => passesTagFilter(r) && inCounty(r)).sort((a, b) => {
      const pa = pins.has(String(a.id)), pb = pins.has(String(b.id));
      if (pa !== pb) return pa ? -1 : 1; // pinned cases always on top
      const x = col.sort(a), y = col.sort(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // nothing to sort on: always at the bottom
      if (y === null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? c : -c;
    });

    const wrap = ov.querySelector('.pd9-hs-wrap');
    const keepScroll = [wrap.scrollTop, wrap.scrollLeft];
    wrap.textContent = '';
    const table = document.createElement('table');
    const colgroup = document.createElement('colgroup');
    const pickW = Math.min(200, Math.max(44, +layout.widths._pick || 50));
    const pickCol = document.createElement('col'); pickCol.style.width = `${pickW}px`; colgroup.appendChild(pickCol);
    cols.forEach((c) => { const el = document.createElement('col'); el.style.width = `${layout.widths[c.key] || c.width}px`; el.dataset.key = c.key; colgroup.appendChild(el); });
    table.style.width = `${pickW + cols.reduce((n, c) => n + (layout.widths[c.key] || c.width), 0)}px`;

    const head = document.createElement('tr');
    // Select all (the rows showing, so it respects the tag filter).
    const allTh = document.createElement('th');
    allTh.className = 'pd9-pick';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.setAttribute('aria-label', 'Select all cases showing');
    const shownIds = rows.map((r) => r.id);
    const picked = shownIds.filter((id) => bulkPicked.has(id)).length;
    all.checked = picked > 0 && picked === shownIds.length;
    all.indeterminate = picked > 0 && picked < shownIds.length;
    all.addEventListener('change', () => { shownIds.forEach((id) => (all.checked ? bulkPicked.add(id) : bulkPicked.delete(id))); drawOwnTable(ov); });
    allTh.appendChild(all);
    // This column can be resized too: drag its right edge.
    const pickGrip = document.createElement('span');
    pickGrip.className = 'pd9-col-grip';
    pickGrip.setAttribute('aria-hidden', 'true');
    pickGrip.title = 'Drag to resize';
    pickGrip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = parseFloat(pickCol.style.width);
      const startT = parseFloat(table.style.width);
      pickGrip.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const w = Math.min(200, Math.max(44, startW + ev.clientX - startX));
        pickCol.style.width = `${w}px`;
        table.style.width = `${startT + w - startW}px`;
      };
      const up = () => {
        pickGrip.removeEventListener('pointermove', move);
        pickGrip.removeEventListener('pointerup', up);
        const l = ownLayout();
        l.widths._pick = Math.round(parseFloat(pickCol.style.width));
        saveLayout(l);
        fitHubColumns(table);
      };
      pickGrip.addEventListener('pointermove', move);
      pickGrip.addEventListener('pointerup', up);
    });
    allTh.appendChild(pickGrip);
    head.appendChild(allTh);
    cols.forEach((c) => {
      const th = document.createElement('th');
      th.dataset.key = c.key;
      th.draggable = true;
      th.setAttribute('aria-sort', c.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label;
      const arrow = document.createElement('span');
      arrow.className = 'pd9-sort-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = c.key === col.key ? (sort.dir === 'asc' ? '\u2191' : '\u2193') : '\u2195';
      b.appendChild(arrow);
      if (c.key === col.key) th.classList.add('pd9-sorted');
      b.title = 'Click to sort. Drag to move. Drag the right edge to resize.';
      b.addEventListener('click', () => {
        store.set(HUB_SORT_KEY, { col: c.key, dir: c.key === col.key && sort.dir === 'asc' ? 'desc' : 'asc' });
        drawOwnTable(ov);
      });
      th.appendChild(b);
      if (c.key === 'tags') {
        const active = tagFilter().tags.length + tagFilter().not.length;
        const fb = document.createElement('button');
        fb.type = 'button';
        fb.className = 'pd9-tag-funnel' + (active ? ' pd9-funnel-on' : '');
        fb.title = active ? `Filtering by ${active} tag${active === 1 ? '' : 's'}` : 'Filter by tags';
        fb.setAttribute('aria-label', fb.title);
        fb.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' + (active ? `<span>${active}</span>` : '');
        fb.addEventListener('click', (e) => { e.stopPropagation(); openTagMenu(fb, ov); });
        th.appendChild(fb);
      }

      // Resize: drag the right edge.
      const grip = document.createElement('span');
      grip.className = 'pd9-col-grip';
      grip.setAttribute('aria-hidden', 'true');
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        th.draggable = false;
        const colEl = colgroup.querySelector(`col[data-key="${c.key}"]`);
        const startX = e.clientX;
        const startW = parseFloat(colEl.style.width);
        const startT = parseFloat(table.style.width);
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const w = Math.max(70, startW + ev.clientX - startX);
          colEl.style.width = `${w}px`;
          colEl.dataset.base = String(w);
          table.style.width = `${startT + w - startW}px`;
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          th.draggable = true;
          const l = ownLayout();
          l.widths[c.key] = Math.round(parseFloat(colEl.style.width));
          saveLayout(l);
          // If the table is now narrower than the screen, spread the gap over the other columns.
          const wrapEl = table.closest('.pd9-hs-wrap');
          if (wrapEl && parseFloat(table.style.width) < wrapEl.clientWidth) fitHubColumns(table);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
      });
      th.appendChild(grip);

      // Reorder: drag a header onto another.
      th.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.key); e.dataTransfer.effectAllowed = 'move'; th.classList.add('pd9-dragging-col'); });
      th.addEventListener('dragend', () => th.classList.remove('pd9-dragging-col'));
      th.addEventListener('dragover', (e) => { e.preventDefault(); th.classList.add('pd9-drop-target'); });
      th.addEventListener('dragleave', () => th.classList.remove('pd9-drop-target'));
      th.addEventListener('drop', (e) => {
        e.preventDefault();
        th.classList.remove('pd9-drop-target');
        const from = e.dataTransfer.getData('text/plain');
        if (!from || from === c.key) return;
        const l = ownLayout();
        l.order = l.order.filter((k) => k !== from);
        l.order.splice(l.order.indexOf(c.key), 0, from);
        saveLayout(l);
        drawOwnTable(ov);
      });
      head.appendChild(th);
    });

    const thead = document.createElement('thead'); thead.appendChild(head);
    const tbody = document.createElement('tbody');
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (bulkPicked.has(r.id)) tr.classList.add('pd9-picked');
      const pick = document.createElement('td');
      pick.className = 'pd9-pick';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = bulkPicked.has(r.id);
      cb.setAttribute('aria-label', `Select ${r.caseNo}`);
      cb.addEventListener('click', (e) => {
        // Shift+click selects everything between this and the last one you clicked.
        if (e.shiftKey && bulkLastIndex != null) {
          const [a, b] = [Math.min(bulkLastIndex, i), Math.max(bulkLastIndex, i)];
          rows.slice(a, b + 1).forEach((x) => (cb.checked ? bulkPicked.add(x.id) : bulkPicked.delete(x.id)));
        } else if (cb.checked) bulkPicked.add(r.id); else bulkPicked.delete(r.id);
        bulkLastIndex = i;
        drawOwnTable(ov);
      });
      pick.appendChild(cb);
      const pinned = pins.has(String(r.id));
      if (pinned) tr.classList.add('pd9-pinned-row');
      if (pinned && !(rows[i + 1] && pins.has(String(rows[i + 1].id)))) tr.classList.add('pd9-pin-last');
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = `pd9-pin-btn${pinned ? ' pd9-pin-on' : ''}`;
      pinBtn.title = pinned ? 'Unpin' : 'Pin to the top';
      pinBtn.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${r.caseNo || ''}`);
      pinBtn.setAttribute('aria-pressed', String(pinned));
      pinBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2h-4v5l-1 1-1-1v-5H7v-2l3-3z" fill="' + (pinned ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      pinBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePin(r.id); drawOwnTable(ov); });
      pick.appendChild(pinBtn);
      tr.appendChild(pick);
      for (const c of cols) { const td = document.createElement('td'); td.dataset.key = c.key; cellFor(c.key, r, td); tr.appendChild(td); }
      tbody.appendChild(tr);
    });
    table.append(colgroup, thead, tbody);
    wrap.appendChild(table);
    fitHubColumns(table);
    [wrap.scrollTop, wrap.scrollLeft] = keepScroll;
    const named = hubTable.rows.filter((r) => r.defendant !== undefined).length;
    const soon = rows.filter((r) => { const e = nextOf(r); return e && e.when - Date.now() < 3 * 864e5; }).length;
    const tf = tagFilter();
    const status = ov.querySelector('.pd9-hs-status');
    const nPins = rows.filter((r) => pins.has(String(r.id))).length;
    status.textContent = (tf.tags.length || tf.not.length || county ? `${rows.length} of ${hubTable.rows.length} projects` : `${rows.length} projects`) + (nPins ? `, ${nPins} pinned` : '') + (soon ? `, ${soon} with an event in the next 3 days` : '');
    let act = ov.querySelector('.pd9-bulk-bar');
    if (!act) { act = document.createElement('span'); act.className = 'pd9-bulk-bar'; ov.querySelector('.pd9-hs-bar').appendChild(act); }
    act.textContent = '';
    const nPicked = hubTable.rows.filter((r) => bulkPicked.has(r.id)).length;
    if (nPicked) {
      const label = document.createElement('span');
      label.className = 'pd9-bulk-count';
      label.textContent = `${nPicked} selected`;
      const mk = (text, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; };
      const pickedRows = () => hubTable.rows.filter((r) => bulkPicked.has(r.id));
      act.append(label,
        mk('Add note', 'pd9-bulk-btn pd9-bulk-primary', () => openBulkComposer('note', pickedRows())),
        mk('Add task', 'pd9-bulk-btn', () => openBulkComposer('task', pickedRows())),
        mk('Add tag', 'pd9-bulk-btn', (e) => openTagEditor(e.currentTarget, pickedRows(), ov)),
        mk('Clear', 'pd9-bulk-link', () => { bulkPicked.clear(); drawOwnTable(ov); }));
    }
    let chips = ov.querySelector('.pd9-hs-filters');
    if (!chips) { chips = document.createElement('span'); chips.className = 'pd9-hs-filters'; status.after(chips); }
    chips.textContent = '';
    const shownName = (t) => (hubTable.rows.flatMap((r) => r.tags).find((g) => g.name.toLowerCase() === t) || { name: t }).name;
    const addGroup = (label, list, cls, remove) => {
      if (!list.length) return;
      const lead = document.createElement('span');
      lead.className = 'pd9-hs-lead';
      lead.textContent = label;
      chips.appendChild(lead);
      for (const t of list) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = `pd9-hs-chip ${cls}`;
        x.textContent = shownName(t).replace(/^#/, '');
        x.title = `Remove ${shownName(t)}`;
        x.addEventListener('click', () => remove(t));
        chips.appendChild(x);
      }
    };
    addGroup(tf.tags.length > 1 ? `Tagged (${tf.mode === 'all' ? 'all' : 'any'} of):` : 'Tagged:', tf.tags, '', toggleTagFilter);
    addGroup('Not tagged:', tf.not, 'pd9-hs-chip-not', toggleTagExclude);
    if (tf.tags.length || tf.not.length) {
      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'pd9-hs-clear';
      clr.textContent = 'Clear';
      clr.addEventListener('click', () => setTagFilter({ ...tf, tags: [], not: [] }));
      chips.appendChild(clr);
    }
    const bar = ov.querySelector('.pd9-hs-progress');
    if (bar) { bar.style.width = `${Math.round((named / Math.max(rows.length, 1)) * 100)}%`; bar.hidden = named >= rows.length; }
  }

  async function buildOwnTable(ov) {
    const href = hubFilterKey();
    hubTable = { href, rows: null };
    ov.querySelector('.pd9-hs-status').textContent = 'Loading the case list...';
    loadHubEvents();
    let rows;
    try { rows = await loadHubList(); } catch (err) {
      if (hubTable && hubTable.href === href) ov.querySelector('.pd9-hs-status').textContent = `Could not load the case list (${err.message}). Use "Filevine's table".`;
      return;
    }
    if (!hubTable || hubTable.href !== href) return;
    hubTable.rows = rows;
    publishSwitchList(rows);
    drawOwnTable(ov);
    // Real first and last names, a few at a time; redraw as they come in.
    let next = 0;
    let redraw = null;
    const worker = async () => {
      while (next < rows.length && hubTable && hubTable.href === href) {
        const r = rows[next++];
        try { r.defendant = await loadName(r); } catch (e) { r.defendant = null; }
        clearTimeout(redraw);
        redraw = setTimeout(() => { if (ov.isConnected) drawOwnTable(ov); }, 120);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    if (hubTable && hubTable.href === href) publishSwitchList(rows); // now with Last, First names
    if (ov.isConnected) drawOwnTable(ov);
  }

  // The "Alternate table" checkbox above the table switches between ours and Filevine's.
  function showOwnTable(force) {
    if (!onHub()) { hubTable = null; return; }
    const grid = $('.ag-root-wrapper');
    if (!grid) return;
    const host = grid.parentElement;
    const useOwn = force === true || (force !== false && store.get(HUB_VIEW_KEY, true));
    let ov = document.getElementById('pd9-hub-sorted');
    let toggle = document.getElementById('pd9-hub-toggle');
    if (!toggle) {
      // Copy Filevine's own "Pinned only" toggle so it looks and sits like the others.
      const pinned = [...document.querySelectorAll('.filters-and-pin label')].find((l) => /pinned only/i.test(l.textContent));
      if (pinned) {
        toggle = pinned.cloneNode(true);
        toggle.querySelector('.form-field-label').textContent = 'Alternate table';
      } else {
        toggle = document.createElement('label');
        toggle.innerHTML = '<input type="checkbox"> Alternate table';
        toggle.classList.add('pd9-hub-toggle-plain');
      }
      toggle.id = 'pd9-hub-toggle';
      toggle.title = 'PD9 table: case number, defendant (last, first), next event, and tags. Your columns and sort are saved.';
      toggle.querySelector('input').addEventListener('change', (e) => {
        e.target.setAttribute('aria-checked', String(e.target.checked));
        store.set(HUB_VIEW_KEY, e.target.checked);
        if (!e.target.checked) { const o = document.getElementById('pd9-hub-sorted'); if (o) o.remove(); hubTable = null; }
        showOwnTable(e.target.checked);
      });
      const pinnedNow = [...document.querySelectorAll('.filters-and-pin label')].find((l) => l !== toggle && /pinned only/i.test(l.textContent));
      if (pinnedNow) pinnedNow.after(toggle); else host.parentElement.insertBefore(toggle, host);
    }
    const box = toggle.querySelector('input');
    if (box.checked !== useOwn) { box.checked = useOwn; box.setAttribute('aria-checked', String(useOwn)); }
    if (!document.getElementById('pd9-win-toggle')) {
      const w = toggle.cloneNode(true);
      w.id = 'pd9-win-toggle';
      w.classList.remove('pd9-hub-toggle-plain');
      if (toggle.classList.contains('pd9-hub-toggle-plain')) w.classList.add('pd9-hub-toggle-plain');
      (w.querySelector('.form-field-label') || w.lastChild).textContent = w.querySelector('.form-field-label') ? 'Window mode' : ' Window mode';
      w.title = 'Open cases from the PD9 table in movable windows. When off, cases open in a new tab.';
      const wb = w.querySelector('input');
      wb.checked = windowMode();
      wb.setAttribute('aria-checked', String(wb.checked));
      wb.addEventListener('change', (e) => {
        store.set(WIN_MODE_KEY, e.target.checked);
        e.target.setAttribute('aria-checked', String(e.target.checked));
        if (e.target.checked) makeSpare(); else document.querySelectorAll('.pd9-win-spare').forEach((x) => x.remove());
      });
      toggle.after(w);
    }
    if (!useOwn) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'pd9-hub-sorted';
      ov.innerHTML = '<div class="pd9-hs-bar"><span class="pd9-hs-status"></span><span class="pd9-hs-track"><span class="pd9-hs-progress"></span></span></div><div class="pd9-hs-wrap"></div>';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(ov);
      matchFilevineLook(ov);
      buildOwnTable(ov);
    } else if (!hubTable || hubTable.href !== hubFilterKey()) {
      buildOwnTable(ov); // filters changed
    }
  }

  document.addEventListener('pd9-redraw-table', () => { const ov = document.getElementById('pd9-hub-sorted'); if (ov) drawOwnTable(ov); });

  // Clicking the Next Event header in Filevine's table opens our table sorted by it.
  function openNextEventSort() {
    store.set(HUB_VIEW_KEY, true);
    store.set(HUB_SORT_KEY, { col: 'next', dir: 'asc' });
    const ov = document.getElementById('pd9-hub-sorted');
    if (ov) drawOwnTable(ov); else showOwnTable(true);
  }


  const CASE_TAB = 'pd9-case-tab';

  // ---------- Window mode: cases in movable windows ----------
  // Each window holds the case in a frame. Drag the title bar to move, drag the
  // corner to resize, minimize to the bar at the bottom, open as many as you like.
  // Windows stay open while you move around Filevine and come back after a reload.
  const WIN_MODE_KEY = 'pd9-window-mode';
  const WIN_LIST_KEY = 'pd9-case-windows';
  const windowMode = () => store.get(WIN_MODE_KEY, false);
  let winZ = 100010;

  // Case windows belong to the Project Hub tab that made them. A new tab opened from
  // that tab gets a copy of its session storage, so the list is marked with this
  // tab's own name and a new tab (with a different name) never brings them back.
  function hubTabId() {
    if (!/^pd9-hub-/.test(window.name || '')) window.name = `pd9-hub-${Math.random().toString(36).slice(2)}`;
    return window.name;
  }
  const winState = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(WIN_LIST_KEY) || 'null');
      if (!saved || Array.isArray(saved) || saved.tab !== window.name) return []; // not this tab's windows
      return saved.list || [];
    } catch (e) { return []; }
  };
  function saveWindows() {
    const list = [...document.querySelectorAll('.pd9-win:not(.pd9-win-spare)')].map((w) => {
      const r = w.getBoundingClientRect();
      return { id: w.dataset.pid, title: w.dataset.title, href: w.dataset.href || '', auto: w.dataset.auto || '', min: w.classList.contains('pd9-win-min'), max: w.classList.contains('pd9-win-max'),
        box: w.dataset.box ? JSON.parse(w.dataset.box) : { left: r.left, top: r.top, width: r.width, height: r.height }, z: +w.style.zIndex || 0 };
    });
    try { sessionStorage.setItem(WIN_LIST_KEY, JSON.stringify({ tab: hubTabId(), list })); } catch (e) { /* ignore */ }
  }

  // Where the bar sits along the bottom: its center, as a share of the screen width.
  const TASKBAR_KEY = 'pd9-taskbar-x';
  function placeTaskbar(bar, x) {
    const half = (bar.offsetWidth / 2) / window.innerWidth;
    const min = Math.min(0.5, half + 8 / window.innerWidth), max = Math.max(0.5, 1 - half - 8 / window.innerWidth);
    const v = Math.min(Math.max(Number.isFinite(x) ? x : 0.5, min), max);
    bar.dataset.x = String(v);
    bar.style.left = `${(v * 100).toFixed(2)}%`;
  }
  function taskbar() {
    let bar = document.getElementById('pd9-taskbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pd9-taskbar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Open case windows');
      document.body.appendChild(bar);
      window.addEventListener('resize', () => placeTaskbar(bar, store.get(TASKBAR_KEY, 0.5)));
    }
    return bar;
  }
  function drawTaskbar() {
    const bar = taskbar();
    const wins = [...document.querySelectorAll('.pd9-win:not(.pd9-win-spare)')];
    bar.hidden = !wins.length;
    bar.textContent = '';
    requestAnimationFrame(() => placeTaskbar(bar, store.get(TASKBAR_KEY, 0.5)));
    const top = wins.filter((w) => !w.classList.contains('pd9-win-min')).sort((a, b) => b.style.zIndex - a.style.zIndex)[0];
    // Grip: drag to slide the bar left or right along the bottom. Double-click to center it.
    const grip = document.createElement('span');
    grip.className = 'pd9-task-grip';
    grip.title = 'Drag to move the bar. Double-click to center it.';
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = bar.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      grip.setPointerCapture(e.pointerId);
      bar.classList.add('pd9-task-dragging');
      const move = (ev) => placeTaskbar(bar, (ev.clientX - dx) / window.innerWidth);
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        bar.classList.remove('pd9-task-dragging');
        store.set(TASKBAR_KEY, +bar.dataset.x);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => { placeTaskbar(bar, 0.5); store.set(TASKBAR_KEY, 0.5); });
    bar.appendChild(grip);
    // Home: minimize every window and show the page underneath.
    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'pd9-task-home';
    home.title = 'Minimize all windows';
    home.setAttribute('aria-label', 'Minimize all windows');
    home.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    home.addEventListener('click', () => {
      document.querySelectorAll('.pd9-win:not(.pd9-win-spare)').forEach((w) => { w.classList.add('pd9-win-min'); w.classList.remove('pd9-win-focus'); });
      drawTaskbar();
      saveWindows();
    });
    bar.appendChild(home);
    const sep = document.createElement('span');
    sep.className = 'pd9-task-sep';
    sep.setAttribute('aria-hidden', 'true');
    bar.appendChild(sep);
    for (const w of wins) {
      const item = document.createElement('span');
      item.className = 'pd9-task' + (w === top ? ' pd9-task-active' : '') + (w.classList.contains('pd9-win-min') ? ' pd9-task-min' : '');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd9-task-name';
      b.textContent = w.dataset.title;
      b.title = w.dataset.title;
      b.addEventListener('click', () => {
        if (w.classList.contains('pd9-win-min')) { w.classList.remove('pd9-win-min'); focusWindow(w); }
        else if (w === top) minimizeWindow(w);
        else focusWindow(w);
      });
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'pd9-task-x';
      x.title = 'Close this window';
      x.setAttribute('aria-label', `Close ${w.dataset.title}`);
      x.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeWindow(w); });
      item.append(b, x);
      bar.appendChild(item);
    }
  }

  function focusWindow(w) {
    w.style.zIndex = ++winZ;
    document.querySelectorAll('.pd9-win:not(.pd9-win-spare)').forEach((x) => x.classList.toggle('pd9-win-focus', x === w));
    drawTaskbar();
    saveWindows();
  }
  function minimizeWindow(w) { w.classList.add('pd9-win-min'); w.classList.remove('pd9-win-focus'); drawTaskbar(); saveWindows(); }
  function closeWindow(w) { recycleWindow(w); drawTaskbar(); saveWindows(); }
  function toggleMax(w) { w.classList.toggle('pd9-win-max'); placeWin(w); saveWindows(); }

  // ---------- Case window zoom (for Windows display scaling like 125%) ----------
  // With Windows set to 125% or 150%, the screen has fewer page pixels, so Filevine
  // inside a case window gets squeezed into its narrow layout. "Auto" draws the
  // window's contents smaller by the same amount, so they lay out like at 100%.
  const WIN_ZOOM_KEY = 'pd9-win-zoom';
  const WIN_ZOOM_CHOICES = [['auto', 'Auto'], ['1', '100%'], ['0.9', '90%'], ['0.8', '80%'], ['0.75', '75%'], ['0.67', '67%']];
  const onWindowsPc = () => {
    try { if (navigator.userAgentData && navigator.userAgentData.platform) return /windows/i.test(navigator.userAgentData.platform); } catch (e) { /* fall back */ }
    return /win/i.test(navigator.platform || '') || /windows/i.test(navigator.userAgent || '');
  };
  function winZoom() {
    const pick = String(store.get(WIN_ZOOM_KEY, 'auto'));
    if (pick !== 'auto') return Math.min(1, Math.max(0.5, +pick || 1));
    const dpr = window.devicePixelRatio || 1;
    if (!onWindowsPc() || dpr < 1.05) return 1;
    return Math.max(0.67, Math.round((1 / dpr) * 100) / 100);
  }
  function applyWinZoom() {
    if (IN_FRAME) return;
    document.documentElement.style.setProperty('--pd9-z', String(winZoom()));
  }
  applyWinZoom();
  // Moving the browser to another screen, or changing browser zoom, changes the scaling.
  window.addEventListener('resize', () => applyWinZoom());

  function placeWin(w) {
    if (w.classList.contains('pd9-win-max')) { ['left', 'top', 'width', 'height'].forEach((k) => { w.style[k] = ''; }); return; }
    const b = JSON.parse(w.dataset.box);
    const vw = window.innerWidth, vh = window.innerHeight;
    b.width = Math.min(Math.max(b.width, 360), vw - 16);
    b.height = Math.min(Math.max(b.height, 240), vh - 68);
    b.left = Math.min(Math.max(b.left, 8 - b.width + 120), vw - 120);
    // Keep the bottom (and its resize corner) above the bar at the bottom of the screen.
    b.top = Math.min(Math.max(b.top, 8), Math.max(8, vh - 60 - b.height));
    w.dataset.box = JSON.stringify(b);
    Object.assign(w.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  }

  // While dragging or resizing, frames would swallow the mouse; turn them off for a moment.
  const shield = (on) => document.documentElement.classList.toggle('pd9-win-busy', on);

  // A spare window that has already loaded Filevine, kept out of sight. Opening a
  // case uses it and just switches it to that case, which is much faster than
  // starting Filevine from scratch. A new spare warms up in the background.
  // Keep a couple of spares ready, warming one at a time so they don't slow each other down.
  const SPARE_POOL = 2;
  function makeSpare() {
    if (IN_FRAME || !windowMode() || !onHub()) return;
    const spares = document.querySelectorAll('.pd9-win-spare');
    if (spares.length >= SPARE_POOL || [...spares].some((x) => x.dataset.warm !== '1')) return; // full, or one still warming
    const w = openCaseWindow('', 'Spare', null, true);
    const frame = w.querySelector('iframe');
    frame.addEventListener('load', () => setTimeout(() => { w.dataset.warm = '1'; makeSpare(); }, 1500), { once: true });
  }

  // Closing a window keeps its Filevine running as a spare (if there's room),
  // so the next case opens instantly instead of loading Filevine again.
  function recycleWindow(w) {
    if (!windowMode() || document.querySelectorAll('.pd9-win-spare').length >= SPARE_POOL) { w.remove(); return; }
    const f = w.querySelector('iframe');
    w.className = 'pd9-win pd9-win-spare';
    w.setAttribute('aria-hidden', 'true');
    w.style.zIndex = '';
    delete w.dataset.prefetch;
    delete w.dataset.key;
    delete w.dataset.href;
    delete w.dataset.auto;
    w.dataset.pid = '';
    w.dataset.warm = '1';
    try { f.contentWindow.location.hash = '#/'; } catch (e) { w.remove(); }
  }

  // Hovering a case link in Window mode starts loading that case in a spare,
  // so by the time you click, it's often already there.
  let prefetchTimer = null;
  function prefetchCase(id) {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      if (!windowMode() || document.querySelector(`.pd9-win:not(.pd9-win-spare)[data-pid="${CSS.escape(String(id))}"]`)) return;
      if (document.querySelector(`.pd9-win-spare[data-prefetch="${CSS.escape(String(id))}"]`)) return;
      const spare = document.querySelector('.pd9-win-spare[data-warm="1"]:not([data-prefetch])') || document.querySelector('.pd9-win-spare[data-warm="1"]');
      if (!spare) return;
      spare.dataset.prefetch = String(id);
      try { spare.querySelector('iframe').contentWindow.location.hash = `#/project/${encodeURIComponent(id)}/activity`; } catch (e) { /* ignore */ }
    }, 120);
  }
  setInterval(() => { if (!STAFF && !IN_FRAME && windowMode() && onHub()) makeSpare(); }, 15000);
  setTimeout(() => { if (!STAFF && !IN_FRAME && windowMode() && onHub()) makeSpare(); }, 2500); // start warming soon after the page loads

  function openCaseWindow(id, title, restore, spare = false) {
    const existing = document.querySelector(`.pd9-win:not(.pd9-win-spare)[data-pid="${CSS.escape(String(id))}"]`);
    if (existing && !restore) { existing.classList.remove('pd9-win-min'); focusWindow(existing); return existing; }
    const warm = !restore && !spare && (document.querySelector(`.pd9-win-spare[data-prefetch="${CSS.escape(String(id))}"]`)
      || document.querySelector('.pd9-win-spare[data-warm="1"]:not([data-prefetch])') || document.querySelector('.pd9-win-spare[data-warm="1"]'));
    if (warm) {
      const n0 = document.querySelectorAll('.pd9-win:not(.pd9-win-spare)').length;
      warm.classList.remove('pd9-win-spare');
      delete warm.dataset.warm;
      warm.dataset.pid = id;
      warm.dataset.title = title || `Case ${id}`;
      warm.setAttribute('aria-label', warm.dataset.title);
      warm.querySelector('.pd9-win-title').textContent = warm.dataset.title;
      const f = warm.querySelector('iframe');
      f.title = warm.dataset.title;
      const already = warm.dataset.prefetch === String(id);
      delete warm.dataset.prefetch;
      if (!already) {
        try { f.contentWindow.location.hash = `#/project/${encodeURIComponent(id)}/activity`; } catch (e) { f.src = `${location.origin}${location.pathname}#/project/${encodeURIComponent(id)}/activity`; }
      }
      warm.dataset.box = JSON.stringify({ left: 80 + (n0 % 8) * 32, top: 70 + (n0 % 8) * 32, width: Math.min(1100, window.innerWidth - 160), height: Math.min(760, window.innerHeight - 140) });
      placeWin(warm);
      focusWindow(warm);
      setTimeout(makeSpare, 4000);
      return warm;
    }
    const n = document.querySelectorAll('.pd9-win:not(.pd9-win-spare)').length;
    const w = document.createElement('section');
    w.className = 'pd9-win';
    w.dataset.pid = id;
    w.dataset.title = title || `Case ${id}`;
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', w.dataset.title);
    const box = restore && restore.box ? restore.box : {
      left: 80 + (n % 8) * 32, top: 70 + (n % 8) * 32,
      width: Math.min(1100, window.innerWidth - 160), height: Math.min(760, window.innerHeight - 140),
    };
    w.dataset.box = JSON.stringify(box);
    w.innerHTML = `
      <header class="pd9-win-head">
        <span class="pd9-win-title"></span>
        <button type="button" class="pd9-win-btn pd9-win-new" title="Open in a new tab" aria-label="Open in a new tab"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="pd9-win-btn pd9-win-minbtn" title="Minimize" aria-label="Minimize"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 17h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button type="button" class="pd9-win-btn pd9-win-maxbtn" title="Maximize" aria-label="Maximize"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
        <button type="button" class="pd9-win-btn pd9-win-x" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </header>
      <div class="pd9-win-body"><iframe title="" loading="eager"></iframe></div>
      <span class="pd9-win-grip" aria-hidden="true"></span>`;
    w.querySelector('.pd9-win-title').textContent = w.dataset.title;
    const frame = w.querySelector('iframe');
    frame.name = 'pd9-case-window'; // so the script knows to run inside it
    frame.title = w.dataset.title;
    frame.src = spare ? `${location.origin}${location.pathname}#/` : (restore && restore.href) || `${location.origin}${location.pathname}#/project/${encodeURIComponent(id)}/activity`;
    if (spare) { w.classList.add('pd9-win-spare'); w.setAttribute('aria-hidden', 'true'); }
    document.body.appendChild(w);
    if (restore && restore.max) w.classList.add('pd9-win-max');
    if (restore && restore.auto) w.dataset.auto = restore.auto;
    if (restore && restore.min) w.classList.add('pd9-win-min');
    placeWin(w);

    const head = w.querySelector('.pd9-win-head');
    w.addEventListener('pointerdown', () => focusWindow(w), true);
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(w); });
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || w.classList.contains('pd9-win-max')) return;
      e.preventDefault();
      const b = JSON.parse(w.dataset.box);
      const dx = e.clientX - b.left, dy = e.clientY - b.top;
      head.setPointerCapture(e.pointerId);
      shield(true);
      const move = (ev) => { b.left = ev.clientX - dx; b.top = ev.clientY - dy; w.dataset.box = JSON.stringify(b); placeWin(w); };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); shield(false); saveWindows(); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    const grip = w.querySelector('.pd9-win-grip');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || w.classList.contains('pd9-win-max')) return;
      e.preventDefault();
      const b = JSON.parse(w.dataset.box);
      const sx = e.clientX, sy = e.clientY, sw = b.width, sh = b.height;
      grip.setPointerCapture(e.pointerId);
      shield(true);
      const move = (ev) => { b.width = sw + ev.clientX - sx; b.height = sh + ev.clientY - sy; w.dataset.box = JSON.stringify(b); placeWin(w); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); shield(false); saveWindows(); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    w.querySelector('.pd9-win-minbtn').addEventListener('click', () => minimizeWindow(w));
    w.querySelector('.pd9-win-maxbtn').addEventListener('click', () => toggleMax(w));
    w.querySelector('.pd9-win-x').addEventListener('click', () => closeWindow(w));
    w.querySelector('.pd9-win-new').addEventListener('click', () => window.open(w.dataset.href || frame.src, '_blank', 'noopener'));
    if (spare) return w;
    if (restore && restore.z) w.style.zIndex = restore.z, winZ = Math.max(winZ, restore.z);
    else focusWindow(w);
    drawTaskbar();
    saveWindows();
    setTimeout(makeSpare, 4000);
    return w;
  }

  // Keep each window's name in step with what it's showing. If you click into a
  // different case inside a window, its title bar and the bottom bar follow along.
  function frameTitle(docTitle) {
    const t = docTitle.replace(/\s*\|\s*Filevine\s*$/i, '').trim();
    const bar = t.indexOf('|');
    return bar < 0 ? t : `${t.slice(bar + 1).trim()}  ${t.slice(0, bar).trim()}`; // "case number  Name", like the table
  }
  function syncWindowTitles() {
    let changed = false;
    for (const w of document.querySelectorAll('.pd9-win:not(.pd9-win-spare)')) {
      const frame = w.querySelector('iframe');
      let href, docTitle;
      try { href = frame.contentWindow.location.href; docTitle = frame.contentWindow.document.title || ''; } catch (e) { continue; }
      if (!href || href === 'about:blank') continue;
      const key = `${href}|${docTitle}`;
      if (w.dataset.key === key) continue;
      w.dataset.key = key;
      w.dataset.href = href;
      const m = href.match(/#\/project\/(\d+)/);
      const pid = m ? m[1] : '';
      const moved = pid !== w.dataset.pid;
      // Use the page's own title once the window has moved to another case (or page),
      // and keep updating it as that page finishes loading its name.
      if (moved) { w.dataset.pid = pid; w.dataset.auto = '1'; }
      if (w.dataset.auto === '1' && docTitle) {
        const title = frameTitle(docTitle) || (pid ? `Case ${pid}` : 'Filevine');
        if (title !== w.dataset.title) {
          w.dataset.title = title;
          w.setAttribute('aria-label', title);
          w.querySelector('.pd9-win-title').textContent = title;
          frame.title = title;
        }
      }
      changed = true;
    }
    if (changed) { drawTaskbar(); saveWindows(); }
  }
  setInterval(() => { if (!IN_FRAME && document.querySelector('.pd9-win')) syncWindowTitles(); }, 1000);

  // Clicking inside a case window (its frame) brings that window to the front.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const f = document.activeElement;
      const w = f && f.tagName === 'IFRAME' && f.closest('.pd9-win');
      if (w && !w.classList.contains('pd9-win-focus')) focusWindow(w);
    }, 0);
  });

  let windowsRestored = false;
  function keepCaseWindows() {
    // Windows, ready windows, and the bar only show on the Project Hub. Elsewhere in
    // this tab they're hidden (and come back when you return to the hub).
    document.documentElement.classList.toggle('pd9-off-hub', !onHub());
    if (windowsRestored || !onHub()) return;
    windowsRestored = true;
    winState().sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((x) => openCaseWindow(x.id, x.title, x));
    const top = [...document.querySelectorAll('.pd9-win:not(.pd9-win-spare):not(.pd9-win-min)')].sort((a, b) => b.style.zIndex - a.style.zIndex)[0];
    if (top) focusWindow(top);
  }

  // ---------- Share real activity across Filevine tabs ----------
  // Filevine can log you out of the whole session because one tab sat idle, even
  // while you were busy in another. When you really type, click, or scroll in
  // any Filevine tab, every other Filevine tab is told you're active. If you step
  // away from all of them, the timeout still works exactly as your office set it.
  const ACTIVE_KEY = 'pd9-last-real-activity';
  let lastShared = 0;
  const shareActivity = (e) => {
    if (!e.isTrusted) return; // only real activity from you, never our own nudges
    const now = Date.now();
    if (now - lastShared < 15000) return; // at most every 15 seconds
    lastShared = now;
    try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch (err) { /* ignore */ }
  };
  ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((t) => window.addEventListener(t, shareActivity, { capture: true, passive: true }));
  let lastMove = 0;
  window.addEventListener('mousemove', (e) => { if (Date.now() - lastMove > 5000) { lastMove = Date.now(); shareActivity(e); } }, { capture: true, passive: true });

  // Another tab saw you: let this tab's idle timer know too. Uses harmless events
  // (mouse move and scroll) that don't click or type anything.
  let lastNudge = 0;
  window.addEventListener('storage', (e) => {
    if (e.key !== ACTIVE_KEY || !e.newValue) return;
    if (Date.now() - +e.newValue > 60000 || Date.now() - lastNudge < 15000) return;
    lastNudge = Date.now();
    const opts = { bubbles: true, cancelable: false, clientX: 1, clientY: 1 };
    document.dispatchEvent(new MouseEvent('mousemove', opts));
    window.dispatchEvent(new MouseEvent('mousemove', opts));
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  // ---------- Add a note or task to several cases at once ----------
  // How it works: for each case, a small window loads that case's page, and the
  // script fills in Filevine's own note or task box there and clicks Save, the
  // same as you would. So every activity is created exactly like one made by
  // hand in the Activity tab: same fields, tags, due date, and author.
  // One case at a time, with a live view of each and a ✓ or ✗ when it's done.
  const BULK_FRAME = 'pd9-bulk-worker';

  function openBulkComposer(type, cases) {
    if (!cases.length) return;
    document.querySelectorAll('.pd9-bulk-modal').forEach((m) => m.remove());
    const overlay = document.createElement('div');
    overlay.className = 'pd9-overlay pd9-bulk-modal';
    const knownTags = [...new Set((hubTable && hubTable.rows || []).flatMap((r) => r.tags.map((t) => t.name.replace(/^#/, ''))))].sort();
    overlay.innerHTML = `
      <div class="pd9-dialog pd9-bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="pd9-bulk-title">
        <div class="pd9-bc-head">
          <div class="pd9-bc-types" role="tablist" aria-label="Activity type">
            <button type="button" role="tab" data-type="note" title="Note"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg></button>
            <button type="button" role="tab" data-type="task" title="Task"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.5l2.5 2.5L16 9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
          <h2 id="pd9-bulk-title"></h2>
          <button type="button" class="pd9-x" aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="pd9-bc-cases"></div>
        <div class="pd9-bc-form">
          <div class="pd9-bc-tpls"><span class="pd9-bc-label">Templates:</span></div>
          <label class="pd9-bc-field"><span class="pd9-bc-label">Subject</span><input type="text" name="subject" autocomplete="off"></label>
          <label class="pd9-bc-field"><span class="pd9-bc-label">Message</span><textarea name="body" rows="8" placeholder="Type your note. #hashtags become tags."></textarea></label>
          <div class="pd9-bc-field"><span class="pd9-bc-label">Tags</span><div class="pd9-bc-tags"><input type="text" name="tag" list="pd9-bc-taglist" placeholder="Add a tag and press Enter" autocomplete="off"></div>
            <datalist id="pd9-bc-taglist">${knownTags.map((t) => `<option value="${escapeAttr(t)}">`).join('')}</datalist></div>
          <div class="pd9-bc-task">
            <label class="pd9-bc-field"><span class="pd9-bc-label">Due date</span><input type="date" name="due"></label>
            <p class="pd9-bc-note">Assigned the way Filevine assigns a new task (usually to you).</p>
          </div>
        </div>
        <div class="pd9-bc-run" hidden>
          <ol class="pd9-bc-list"></ol>
          <div class="pd9-bc-live"><span class="pd9-bc-label">Working in:</span><div class="pd9-bc-frame"></div></div>
        </div>
        <div class="pd9-foot">
          <span class="pd9-bc-hint">Ctrl+Enter to save</span><span class="pd9-grow"></span>
          <button type="button" class="pd9-btn pd9-bc-cancel">Cancel</button>
          <button type="button" class="pd9-btn pd9-primary pd9-bc-go"></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const q = (sel) => overlay.querySelector(sel);
    let kind = type;
    let running = false;
    let stopAsked = false;
    const tags = [];

    // Default due date: next business day, like the T shortcut.
    const d0 = dueDateString().split('/');
    q('[name=due]').value = `${d0[2]}-${d0[0]}-${d0[1]}`;

    const caseList = q('.pd9-bc-cases');
    caseList.innerHTML = '<span class="pd9-bc-label">Cases:</span>';
    cases.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'pd9-bc-case';
      chip.textContent = `${c.caseNo}  ${c.defendant || c.clientName || ''}`.trim();
      caseList.appendChild(chip);
    });

    const setKind = (k) => {
      kind = k;
      overlay.querySelectorAll('.pd9-bc-types button').forEach((b) => {
        const on = b.dataset.type === k;
        b.setAttribute('aria-selected', String(on));
        b.classList.toggle('pd9-on', on);
      });
      q('.pd9-bc-task').hidden = k !== 'task';
      q('h2').textContent = `New ${k} in ${cases.length} case${cases.length === 1 ? '' : 's'}`;
      q('.pd9-bc-go').textContent = `Save to ${cases.length} case${cases.length === 1 ? '' : 's'}`;
    };
    overlay.querySelectorAll('.pd9-bc-types button').forEach((b) => b.addEventListener('click', () => { if (!running) setKind(b.dataset.type); }));
    setKind(type);

    // Templates, same as the note box.
    for (const tpl of TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd9-bc-tpl';
      b.textContent = tpl.label;
      b.addEventListener('click', () => {
        const body = q('[name=body]');
        if ((body.value.trim() || q('[name=subject]').value.trim()) && !confirm('Replace what is already in the box?')) return;
        q('[name=subject]').value = tpl.subject;
        const text = tpl.body.replace(/\{date\}/g, new Date().toLocaleDateString());
        const at = text.indexOf('{|}');
        body.value = text.replace('{|}', '');
        tagList(tpl.tag).forEach((t) => addTag(t));
        body.focus();
        body.setSelectionRange(at < 0 ? body.value.length : at, at < 0 ? body.value.length : at);
      });
      q('.pd9-bc-tpls').appendChild(b);
    }

    // Tags as chips.
    const tagBox = q('.pd9-bc-tags');
    const tagInput = q('[name=tag]');
    function drawTags() {
      tagBox.querySelectorAll('.pd9-bc-chip').forEach((c) => c.remove());
      tags.forEach((t) => {
        const c = document.createElement('span');
        c.className = 'pd9-bc-chip';
        c.textContent = `#${t}`;
        const x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', `Remove ${t}`);
        x.textContent = '\u2715';
        x.addEventListener('click', () => { tags.splice(tags.indexOf(t), 1); drawTags(); });
        c.appendChild(x);
        tagBox.insertBefore(c, tagInput);
      });
    }
    function addTag(raw) {
      const t = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '');
      if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) { tags.push(t); drawTags(); }
    }
    tagInput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tagInput.value.trim()) { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; }
      else if (e.key === 'Backspace' && !tagInput.value && tags.length) { tags.pop(); drawTags(); }
    });
    tagInput.addEventListener('change', () => { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } });

    const close = () => {
      if (running && !confirm('Stop after the case it is working on now?')) return;
      stopAsked = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running) { e.preventDefault(); e.stopPropagation(); go(); }
    };
    document.addEventListener('keydown', onKey, true);
    q('.pd9-x').addEventListener('click', close);
    q('.pd9-bc-cancel').addEventListener('click', close);
    q('.pd9-bc-go').addEventListener('click', () => go());
    q(kind === 'task' ? '[name=subject]' : '[name=body]').focus();

    let finished = false;
    async function go() {
      if (running || finished) return; // after a run, the button becomes Done or Retry instead
      if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; }
      const subject = q('[name=subject]').value.trim();
      const body = q('[name=body]').value.replace(/\s+$/, '');
      if (!body && !subject) { toast('Type a subject or a message first.'); return; }
      const dueIso = q('[name=due]').value; // yyyy-mm-dd
      const due = kind === 'task' && dueIso ? `${dueIso.slice(5, 7)}/${dueIso.slice(8, 10)}/${dueIso.slice(0, 4)}` : '';
      const job = { type: kind, subject, body, tags: tags.slice(), due };

      running = true;
      stopAsked = false;
      q('.pd9-bc-form').hidden = true;
      q('.pd9-bc-cases').hidden = true;
      q('.pd9-bc-run').hidden = false;
      q('.pd9-bc-go').disabled = true;
      q('.pd9-bc-go').textContent = 'Saving...';
      q('.pd9-bc-cancel').textContent = 'Stop';
      overlay.querySelectorAll('.pd9-bc-types button').forEach((b) => { b.disabled = true; });

      const list = q('.pd9-bc-list');
      list.textContent = '';
      const items = cases.map((c) => {
        const li = document.createElement('li');
        li.className = 'pd9-bc-item pd9-wait';
        li.innerHTML = '<span class="pd9-bc-state" aria-hidden="true"></span><a target="_blank" rel="noopener"></a><span class="pd9-bc-msg">Waiting</span>';
        const a = li.querySelector('a');
        a.href = `#/project/${encodeURIComponent(c.id)}/activity`;
        a.textContent = `${c.caseNo}  ${c.defendant || c.clientName || ''}`.trim();
        list.appendChild(li);
        return { c, li };
      });

      let ok = 0, bad = 0;
      for (const it of items) {
        if (stopAsked || !overlay.isConnected) { it.li.className = 'pd9-bc-item pd9-skip'; it.li.querySelector('.pd9-bc-msg').textContent = 'Not done (stopped)'; continue; }
        it.li.className = 'pd9-bc-item pd9-busy';
        it.li.querySelector('.pd9-bc-msg').textContent = 'Opening the case...';
        it.li.scrollIntoView({ block: 'nearest' });
        const res = await runInCase(it.c.id, { ...job, caseNo: it.c.caseNo }, q('.pd9-bc-frame'), (msg) => { it.li.querySelector('.pd9-bc-msg').textContent = msg; });
        it.li.className = `pd9-bc-item ${res.ok ? 'pd9-ok' : 'pd9-bad'}`;
        it.li.querySelector('.pd9-bc-msg').textContent = res.ok ? 'Saved' : `Not saved: ${res.error}`;
        if (res.ok) ok++; else bad++;
      }
      running = false;
      finished = true;
      if (!overlay.isConnected) return;
      q('.pd9-bc-frame').textContent = '';
      q('.pd9-bc-live').hidden = true;
      q('.pd9-bc-cancel').textContent = 'Close';
      const go2 = q('.pd9-bc-go');
      go2.disabled = false;
      if (bad) {
        go2.textContent = `Retry ${bad} not saved`;
        go2.onclick = (e) => {
          e.stopImmediatePropagation();
          const failed = items.filter((it) => !it.li.classList.contains('pd9-ok')).map((it) => it.c);
          overlay.remove();
          document.removeEventListener('keydown', onKey, true);
          openBulkComposer(job.type, failed);
          const m = document.querySelector('.pd9-bulk-modal');
          if (m) { m.querySelector('[name=subject]').value = job.subject; m.querySelector('[name=body]').value = job.body; }
        };
      } else {
        go2.textContent = 'Done';
        go2.onclick = (e) => { e.stopImmediatePropagation(); close(); };
        bulkPicked.clear();
        const ov = document.getElementById('pd9-hub-sorted');
        if (ov) drawOwnTable(ov);
      }
      toast(`${ok} saved${bad ? `, ${bad} not saved` : ''}.`);
    }
  }

  // Load one case in a small window and ask the script running there to do the work.
  // The same window is reused for the next case (it just switches cases), so only
  // the first case pays for starting Filevine.
  function runInCase(projectId, job, holder, say) {
    return new Promise((resolve) => {
      let frame = holder.querySelector('iframe');
      const url = `#/project/${encodeURIComponent(projectId)}/activity`;
      let done = false;
      const finish = (res) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(res);
      };
      const onMsg = (e) => {
        if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin || !e.data || !e.data.pd9bulk) return;
        const m = e.data;
        if (m.pd9bulk === 'ready' && String(m.pid) === String(projectId)) frame.contentWindow.postMessage({ pd9bulk: 'go', job }, location.origin);
        else if (m.pd9bulk === 'progress') say(m.text);
        else if (m.pd9bulk === 'done') finish({ ok: !!m.ok, error: m.error || '' });
      };
      window.addEventListener('message', onMsg);
      const timer = setTimeout(() => finish({ ok: false, error: 'the case took too long to load' }), 60000);
      if (frame) {
        try { frame.contentWindow.location.hash = url; } catch (e) { frame.src = location.origin + location.pathname + url; }
      } else {
        frame = document.createElement('iframe');
        frame.name = BULK_FRAME;
        frame.title = 'Working in this case';
        frame.src = location.origin + location.pathname + url;
        holder.appendChild(frame);
      }
    });
  }


  // Inside the worker window: fill Filevine's own box and save.
  if (IN_FRAME && window.name === BULK_FRAME) {
    const tell = (m) => { try { window.parent.postMessage({ pd9bulk: m.type, ...m.data }, location.origin); } catch (e) { /* ignore */ } };
    window.addEventListener('message', async (e) => {
      if (e.source !== window.parent || e.origin !== location.origin || !e.data || e.data.pd9bulk !== 'go') return;
      const job = e.data.job;
      try {
        // Safety check: never type into the wrong case. The page title must show this case number.
        const plain = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (job.caseNo && !(await waitFor(() => plain(document.title).includes(plain(job.caseNo)), 20000))) {
          throw new Error('the case page did not switch to this case');
        }
        tell({ type: 'progress', data: { text: `Opening the ${job.type} box...` } });
        const form = await openFloating(job.type);
        if (!form) throw new Error(`the ${job.type} box did not open`);
        if (job.type === 'task' && !(await waitFor(() => $(SEL.dueDate, form), 4000))) throw new Error('the task fields did not appear');
        await sleep(job.type === 'task' ? 900 : 200); // let the default due date settle first

        tell({ type: 'progress', data: { text: 'Filling it in...' } });
        const subj = $(SEL.subject, form);
        if (subj && job.subject) setInputValue(subj, job.subject);
        // Tags go at the bottom as hashtags, which Filevine turns into tags (same as the templates).
        const tagLine = job.tags.length ? `\n\n${job.tags.map((t) => `#${t}`).join(' ')} ` : '';
        const text = (job.body || '') + tagLine;
        if (text.trim()) {
          const liveBox = () => $(SEL.message, form);
          const landed = await fillMessage(liveBox(), text, liveBox);
          if (!landed) throw new Error('the message did not go in');
        }
        if (job.type === 'task' && job.due) {
          let stuck = false;
          for (let attempt = 0; attempt < 3 && !stuck; attempt++) {
            const input = $(SEL.dueDate, form);
            if (!input) break;
            input.focus();
            input.select();
            document.execCommand('insertText', false, job.due);
            if (input.value !== job.due) setInputValue(input, job.due);
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const box = $(SEL.message, form);
            if (box) box.focus(); else input.blur();
            await sleep(500);
            stuck = ($(SEL.dueDate, form) || {}).value === job.due;
          }
          if (!stuck) throw new Error('the due date would not set');
        }
        await sleep(500); // give Filevine a moment to turn hashtags into tags

        tell({ type: 'progress', data: { text: 'Saving...' } });
        const save = await waitFor(() => { const b = findSaveButton(form); return b && !b.disabled ? b : null; }, 5000);
        if (!save) throw new Error('the Save button was not ready');
        save.click();
        // Saved when Filevine empties or closes the box.
        const saved = await waitFor(() => {
          const box = $(SEL.message, form);
          return !document.contains(form) || !box || !isVisible(box) || !box.textContent.trim();
        }, 15000);
        if (!saved) throw new Error('Filevine did not confirm the save');
        try { localStorage.removeItem(draftKey(form)); } catch (err) { /* ignore */ }
        tell({ type: 'done', data: { ok: true } });
      } catch (err) {
        tell({ type: 'done', data: { ok: false, error: err.message || String(err) } });
      }
    });
    // Say we're ready once the case page can make activities. Again each time
    // the window is switched to another case.
    let announcing = 0;
    const announce = async () => {
      const mine = ++announcing;
      await sleep(300);
      const pid = (location.hash.match(/\/project\/(\d+)/) || [])[1];
      const ready = await waitFor(() => inCase() && $(SEL.createBtn), 45000);
      if (mine !== announcing) return; // switched again meanwhile
      tell(ready ? { type: 'ready', data: { pid } } : { type: 'done', data: { ok: false, error: 'the case page did not finish loading' } });
    };
    window.addEventListener('hashchange', announce);
    announce();
  }

  // ---------- Case switcher (Ctrl+Space, or the Switch case button) ----------
  // A Spotlight-style box. Type part of a name or a case number the short way
  // (26cf1234, 2026cf1234, 261234, or just 1234) and press Enter to switch this
  // tab (or this case window) to that case. Your cases come from the Project Hub,
  // using the filters you last had there. Anything else falls back to Filevine's
  // full search.
  const SWITCH_PARAMS_KEY = 'pd9-switch-hub-filters';
  const SWITCH_LIST_KEY = 'pd9-switch-case-list';
  const RECENT_KEY = 'pd9-recent-cases';
  let switchList = null; // [{ id, caseNo, name, c, lastActivity }]
  let switchListAt = 0;

  function rememberRecent(id) {
    const list = (store.get(RECENT_KEY, null) || []).filter((x) => x !== String(id));
    list.unshift(String(id));
    store.set(RECENT_KEY, list.slice(0, 20));
  }

  // The case list is shared through Tampermonkey's storage: the Project Hub tab
  // writes its PD9 table there, so every other tab (your case tab, case windows)
  // searches it instantly, with no waiting on Filevine.
  function readSwitchCache() {
    if (onHub() && hubTable && hubTable.rows) { // on the Project Hub itself: use the table as it is right now
      switchList = hubTable.rows.map(switchRow);
      switchListAt = Date.now();
      return;
    }
    const c = store.get(SWITCH_LIST_KEY, null);
    if (c && c.rows && c.at > switchListAt) { switchList = c.rows; switchListAt = c.at; }
  }
  const switchRow = (r) => ({ id: r.id, caseNo: r.caseNo, name: r.clientName, last: r.defendant || '', lastActivity: r.lastActivity ? r.lastActivity.getTime() : 0 });
  function publishSwitchList(rows) {
    if (!rows || !rows.length) return;
    switchList = rows.map(switchRow);
    switchListAt = Date.now();
    store.set(SWITCH_LIST_KEY, { at: switchListAt, rows: switchList });
  }

  // Ask Filevine for the list only when there's no fresh copy (older than 10 minutes).
  async function loadSwitchList(force = false) {
    readSwitchCache();
    if (!force && switchList && Date.now() - switchListAt < 10 * 60 * 1000) return switchList;
    const params = store.get(SWITCH_PARAMS_KEY, null);
    if (!params) return switchList || [];
    const rows = await loadHubList(params);
    const old = new Map((switchList || []).map((r) => [r.id, r.last]));
    rows.forEach((r) => { if (!r.defendant && old.get(r.id)) r.defendant = old.get(r.id); }); // keep names we already had
    publishSwitchList(rows);
    return switchList;
  }


  // How well a case matches what was typed. 0 = no match. Higher is better.
  function switchScore(row, typed) {
    const t = typed.trim();
    if (!t) return 0;
    const flat = t.toUpperCase().replace(/[\s\-_|]+/g, '');
    const c = row.c || (row.c = readCaseNumbers(row.caseNo)[0] || null);
    // Case number, typed the short way: 26CF1234, 2026CF1234, 26CF12 (still typing), 26CF1234A, 261234, 1234.
    const m = flat.match(/^(\d{2}|\d{4})([A-Z]{1,2})(\d*)([A-Z]{0,3})$/);
    if (m && c) {
      const [, y, type, num, rest] = m;
      if (twoDigitYear(y) !== c.year || !c.type.startsWith(type)) return 0;
      if (rest && !(c.def + c.county).startsWith(rest)) return 0;
      if (!num) return 40;
      const n = stripZeros(num);
      return c.num === n ? 100 : c.num.startsWith(n) ? 70 : 0;
    }
    if (/^\d{3,}$/.test(flat) && c) {
      if (c.num === stripZeros(flat)) return 90;
      if ((c.year + c.num) === flat || (c.year + c.num.padStart(6, '0')) === flat) return 100;
      if (c.num.startsWith(stripZeros(flat))) return 60;
      if ((c.year + c.num).startsWith(flat)) return 55;
      return 0;
    }
    // Name: every typed word starts a word in the name, any order.
    const want = nameWords(t);
    const have = nameWords(`${row.name || ''} ${row.last || ''}`);
    if (!want.length || !want.every((w) => have.some((h) => h.startsWith(w)))) return 0;
    return 50 + (have[0] && have[0].startsWith(want[0]) ? 5 : 0);
  }

  function openSwitcher() {
    if (document.getElementById('pd9-switch')) { document.querySelector('#pd9-switch input').select(); return; }
    const back = document.createElement('div');
    back.id = 'pd9-switch';
    back.innerHTML = `
      <div class="pd9-sw-panel" role="dialog" aria-modal="true" aria-label="Switch case">
        <div class="pd9-sw-input">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="text" autocomplete="off" spellcheck="false" placeholder="Switch to a case: name or number (26cf1234)" role="combobox" aria-expanded="true" aria-controls="pd9-sw-list" aria-autocomplete="list">
          <span class="pd9-sw-spin" hidden aria-hidden="true"></span>
        </div>
        <div class="pd9-sw-list" id="pd9-sw-list" role="listbox"></div>
        <div class="pd9-sw-foot"><span><kbd>\u2191</kbd><kbd>\u2193</kbd> move</span><span><kbd>Enter</kbd> switch</span><span><kbd>${/Mac/i.test(navigator.platform) ? '\u2318' : 'Ctrl'}</kbd><kbd>Enter</kbd> new tab</span><span><kbd>Esc</kbd> close</span></div>
      </div>`;
    document.body.appendChild(back);
    const input = back.querySelector('input');
    const list = back.querySelector('.pd9-sw-list');
    const spin = back.querySelector('.pd9-sw-spin');
    let items = [];
    let sel = 0;
    let others = [];
    let otherFor = '';
    let otherTimer = null;
    let otherReq = null;

    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (otherReq) otherReq.abort(); };
    const go = (it, newTab) => {
      if (!it) return;
      const hash = `#/project/${encodeURIComponent(it.id)}/activity`;
      close();
      rememberRecent(it.id);
      if (newTab) window.open(location.origin + location.pathname + hash, '_blank', 'noopener');
      else location.hash = hash;
    };

    const nextLabel = (id) => {
      const e = hubEvents && hubEvents.get(String(id));
      return e ? `${niceDate(e.when, true)}${e.dateOnly ? '' : ` ${e.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}${e.title ? `  ${shortTitle(e.title)}` : ''}` : '';
    };

    const draw = () => {
      const typed = input.value;
      const rows = switchList || [];
      let groups;
      if (!typed.trim()) {
        const recent = (store.get(RECENT_KEY, null) || []).map((id) => rows.find((r) => r.id === id)).filter(Boolean).slice(0, 6);
        const soon = rows.filter((r) => hubEvents && hubEvents.get(r.id) && !recent.includes(r))
          .sort((a, b) => hubEvents.get(a.id).when - hubEvents.get(b.id).when).slice(0, 6);
        groups = [['Recent', recent], ['Coming up', soon]];
      } else {
        const scored = rows.map((r) => ({ r, s: switchScore(r, typed) })).filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || b.r.lastActivity - a.r.lastActivity).slice(0, 30).map((x) => x.r);
        const mine = new Set(scored.map((r) => r.id));
        groups = [['Your cases', scored], ['Other cases', others.filter((o) => !mine.has(o.id))]];
      }
      items = groups.flatMap(([, g]) => g);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.textContent = '';
      let i = 0;
      for (const [title, g] of groups) {
        if (!g.length) continue;
        const h = document.createElement('div');
        h.className = 'pd9-sw-group';
        h.textContent = title;
        list.appendChild(h);
        for (const it of g) {
          const idx = i++;
          const row = document.createElement('div');
          row.className = 'pd9-sw-row' + (idx === sel ? ' pd9-sw-sel' : '') + (String(it.id) === projectId() ? ' pd9-sw-here' : '');
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(idx === sel));
          row.id = `pd9-sw-${idx}`;
          const cn = document.createElement('span'); cn.className = 'pd9-sw-case'; cn.textContent = it.caseNo || `Case ${it.id}`;
          const nm = document.createElement('span'); nm.className = 'pd9-sw-name'; nm.textContent = it.last || it.name || '';
          const nx = document.createElement('span'); nx.className = 'pd9-sw-next'; nx.textContent = String(it.id) === projectId() ? 'Open now' : nextLabel(it.id);
          row.append(cn, nm, nx);
          row.addEventListener('mousemove', () => { if (sel !== idx) { sel = idx; draw(); } });
          row.addEventListener('click', (e) => go(it, e.ctrlKey || e.metaKey));
          list.appendChild(row);
        }
      }
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'pd9-sw-empty';
        empty.textContent = !store.get(SWITCH_PARAMS_KEY, null) && !typed.trim()
          ? 'Open the Project Hub once so I know which cases are yours. Typing still searches all of Filevine.'
          : typed.trim() ? (otherFor === typed.trim() && !otherReq ? 'No matching cases.' : 'Searching...') : 'Start typing a name or case number.';
        list.appendChild(empty);
      }
      input.setAttribute('aria-activedescendant', items.length ? `pd9-sw-${sel}` : '');
      const cur = list.querySelector('.pd9-sw-sel');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    };

    // Filevine's full search, for cases that aren't in your list (a beat after you stop typing).
    const searchOthers = () => {
      clearTimeout(otherTimer);
      const typed = input.value.trim();
      others = [];
      otherFor = '';
      if (otherReq) { otherReq.abort(); otherReq = null; }
      if (typed.length < 3) { spin.hidden = true; draw(); return; }
      const mineNow = (switchList || []).filter((r) => switchScore(r, typed) >= 90).length;
      if (mineNow) { spin.hidden = true; otherFor = typed; draw(); return; } // an exact hit in your cases: no need to search everywhere
      otherTimer = setTimeout(async () => {
        const flat = typed.toUpperCase().replace(/[\s\-_|]+/g, '');
        const isCase = /\d/.test(flat) && readCaseQuery(flat).length;
        const ctrl = new AbortController();
        otherReq = ctrl;
        spin.hidden = false;
        try {
          const queries = isCase ? [caseSearchTerms(readCaseQuery(flat))] : SEARCH_MODES.name.queries(typed);
          let hits = [];
          for (const q of queries) {
            hits = (await askFilevine(q, ctrl.signal)).filter((h) => h.id && (isCase ? titleFitsCase(h.title, flat) : nameFits(h, typed)));
            if (hits.length) break;
          }
          if (otherReq !== ctrl) return;
          others = hits.slice(0, 15).map((h) => ({ id: String(h.id), caseNo: (h.title.split('|')[1] || '').trim(), name: h.clientName || h.title.split('|')[0].trim() }));
        } catch (e) { /* stopped or failed: show what we have */ }
        if (otherReq === ctrl) { otherReq = null; otherFor = typed; spin.hidden = true; draw(); }
      }, 450);
    };

    const onKey = (e) => {
      if (!back.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(items[sel], e.ctrlKey || e.metaKey); }
    };
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', () => { sel = 0; draw(); searchOthers(); });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    readSwitchCache(); // instant: the Project Hub's list, no waiting on Filevine
    input.focus();
    draw();
    loadHubEvents(); // next events (shared with the Project Hub column)
    if (!switchList || Date.now() - switchListAt > 10 * 60 * 1000) {
      spin.hidden = false; // refreshing an old list in the background; the old one stays searchable meanwhile
      loadSwitchList(true).then(() => { if (back.isConnected) draw(); }).catch(() => {}).finally(() => { spin.hidden = true; });
    }
    const waitEvents = setInterval(() => { if (!back.isConnected) clearInterval(waitEvents); else if (hubEvents && !hubEventsLoading) { clearInterval(waitEvents); draw(); } }, 400);
  }

  // Ctrl+Space opens it (on a Mac too: Control, not Command), anywhere except while writing a note.
  document.addEventListener('keydown', (e) => {
    if (STAFF || e.code !== 'Space' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (composerOf(document.activeElement)) return; // leave the note box alone
    e.preventDefault();
    e.stopImmediatePropagation();
    openSwitcher();
  }, true);

  // ---------- Dark mode ----------
  // Filevine ships its own dark theme (fv-dark) but doesn't offer it to us. This
  // turns it on, then tunes it: a deep slate palette, softer text, a brighter
  // teal, and dark styles for the older parts of Filevine and the Improver's own
  // windows. Turn it on or off in the account menu (under Improver Options) or
  // with Alt+Shift+D.
  const DARK_KEY = 'pd9-dark';
  const DARK_SKIP = /\/docwebviewer\//i.test(location.pathname); // Filevine's file viewer: leave files as they are
  const darkOn = () => !!store.get(DARK_KEY, false);
  let lightTheme = null; // Filevine's own theme name, to put back
  function setThemeAttr(dark) {
    const root = document.documentElement;
    const st = root.getAttribute('style') || '';
    const m = st.match(/--theme-name:\s*([^;]+);?/);
    const cur = m ? m[1].trim() : '';
    if (cur && cur !== 'fv-dark') lightTheme = cur;
    const want = dark ? 'fv-dark' : (lightTheme || 'fv-light');
    // Filevine's theme only applies when the style starts with "--theme-name: ...".
    if (st.startsWith(`--theme-name: ${want}`)) return;
    const rest = st.replace(/--theme-name:\s*[^;]+;?\s*/, '').trim();
    root.setAttribute('style', `--theme-name: ${want};${rest ? ` ${rest}` : ''}`);
  }
  function applyDark() {
    if (DARK_SKIP) return;
    const on = darkOn();
    document.documentElement.classList.toggle('pd9-dark', on);
    if (on || document.documentElement.classList.contains('pd9-was-dark')) setThemeAttr(on);
    document.documentElement.classList.toggle('pd9-was-dark', on);
    $$('[data-pd9-dark] .pd9-dark-state').forEach((el) => { el.textContent = on ? 'On' : 'Off'; });
  }
  function toggleDark() {
    store.set(DARK_KEY, !darkOn());
    applyDark();
    toast(darkOn() ? 'Dark mode on (Alt+Shift+D to switch)' : 'Dark mode off');
  }
  // Filevine sometimes rewrites its theme (when it loads, or in a case window): keep ours.
  new MutationObserver(() => {
    if (darkOn() && !DARK_SKIP) setThemeAttr(true);
    if (!IN_FRAME && !document.documentElement.style.getPropertyValue('--pd9-z')) applyWinZoom(); // keep the case-window zoom too
  })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  document.addEventListener('keydown', (e) => {
    if (DARK_SKIP) return;
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyD' || /^d$/i.test(e.key))) { e.preventDefault(); toggleDark(); }
  }, true);
  // Another tab (or the main page, for a case window) changed it: follow along.
  window.addEventListener('focus', () => applyDark());
  setInterval(() => { if (document.documentElement.classList.contains('pd9-dark') !== darkOn()) applyDark(); }, 2000);
  applyDark();

  function addSwitchButton() {
    if (document.getElementById('pd9-switch-btn')) return;
    const input = searchInput();
    if (!input) return;
    const host = document.getElementById('pd9-name-btn') || input.closest('.search') || input.closest('.fvs-autocomplete') || input.parentElement;
    const btn = document.createElement('button');
    btn.id = 'pd9-switch-btn';
    btn.type = 'button';
    btn.className = 'pd9-head-btn';
    btn.title = 'Switch case (Ctrl+Space)';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Switch case</span><kbd class="pd9-kbd">${/Mac/i.test(navigator.platform) ? '\u2303Space' : 'Ctrl Space'}</kbd>`;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSwitcher(); });
    host.after(btn);
  }

  // ---------- Esc: snap back, then minimize, then close the note/task box ----------
  // If you moved or resized the box, the first Esc puts it back in Filevine's
  // normal spot. The next Esc minimizes it (your text stays in it). Esc again,
  // while it's minimized, closes it (the text is kept as a draft, so "Restore
  // note" brings it back). Runs after Filevine's own Esc handling, so an open
  // tag list or date picker closes first.
  const MIN_BTN = '[data-testid="activity-creator-minimize-button"]';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('.pd9-overlay, #pd9-switch')) return; // one of our windows is open: it handles Esc
    const active = document.activeElement;
    let form = composerOf(active);
    if (!form) {
      // Focus isn't in a box: act on the floating one, if it's showing (open or minimized).
      const docked = $(SEL.docked);
      if (!docked || !isVisible(docked) || isTyping(e)) return;
      form = docked;
    }
    const open = isVisible($(SEL.message, form));
    // 1) Moved or resized? Snap it back to Filevine's normal spot first.
    if (open && form.classList.contains('pd9-placed')) {
      e.preventDefault();
      setComposerBox(null);
      refreshComposer(form);
      return;
    }
    // 2) Then minimize, 3) then close.
    const minimize = $(MIN_BTN, form);
    if (open && minimize && isVisible(minimize)) {
      e.preventDefault();
      saveDraft(form);
      minimize.click();
      refreshComposer(form);
      if (active && form.contains(active)) active.blur(); // so the next Esc isn't typed into a hidden box
      return;
    }
    const close = $(SEL.closeBtn, form);
    if (!close) return;
    e.preventDefault();
    const box = $(SEL.message, form);
    const subj = $(SEL.subject, form);
    const hadText = (box && box.textContent.trim()) || (subj && subj.value.trim());
    saveDraft(form);
    close.click();
    if (hadText) toast('Closed. Click "Restore note" to bring it back.');
  });


  // ---------- Filing Cabinet: quick preview ----------
  // An eye button on each file opens it in a panel on the right, using Filevine's
  // own viewer (/docwebviewer/view/<id>), without leaving the file list.
  // While the panel is open: the arrow keys go to the previous/next file, Esc closes.
  const DOCPREV_W_KEY = 'pd9-docprev-width';
  const docRows = () => $$('.ag-center-cols-container .ag-row[row-id^="doc-"], .ag-pinned-left-cols-container .ag-row[row-id^="doc-"]')
    .filter((r, i, all) => all.findIndex((x) => x.getAttribute('row-id') === r.getAttribute('row-id')) === i)
    .filter((r) => $('.namecell-text', r))
    .sort((a, b) => (+a.getAttribute('aria-rowindex') || 0) - (+b.getAttribute('aria-rowindex') || 0));
  const docIdOf = (row) => (row.getAttribute('row-id') || '').replace(/^doc-/, '');
  const docNameOf = (row) => (($('.namecell-text', row) || {}).textContent || '').trim();
  const docViewUrl = (id) => `${location.origin}/docwebviewer/view/${encodeURIComponent(id)}`;
  let docPrevId = null;

  function addDocPreview() {
    if (!/#\/project\/\d+\/docs/.test(location.hash)) { closeDocPreview(); return; }
    for (const row of docRows()) {
      const slot = $('.after-namecell-text', row) || $('.namecell', row);
      if (!slot || $('.pd9-doc-eye', slot)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd9-doc-eye';
      b.title = 'Preview here (arrow keys flip through the files)';
      b.setAttribute('aria-label', `Preview ${docNameOf(row)}`);
      b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      // Keep the click away from Filevine, which would open the file in a new tab.
      ['pointerdown', 'mousedown', 'mouseup', 'dblclick'].forEach((t) => b.addEventListener(t, (e) => e.stopPropagation()));
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = b.closest('.ag-row');
        if (r) openDocPreview(docIdOf(r), docNameOf(r));
      });
      slot.prepend(b);
    }
    markPreviewedRow();
  }
  function markPreviewedRow() {
    $$('.pd9-doc-current').forEach((r) => { if (r.getAttribute('row-id') !== `doc-${docPrevId}`) r.classList.remove('pd9-doc-current'); });
    if (docPrevId) $$(`.ag-row[row-id="doc-${CSS.escape(docPrevId)}"]`).forEach((r) => r.classList.add('pd9-doc-current'));
  }

  function openDocPreview(id, name) {
    if (!id) return;
    let panel = document.getElementById('pd9-docprev');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'pd9-docprev';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'File preview');
      panel.innerHTML = `
        <span class="pd9-dp-edge" title="Drag to resize" aria-hidden="true"></span>
        <header class="pd9-dp-head">
          <button type="button" class="pd9-dp-btn pd9-dp-prev" title="Previous file (Up or Left arrow)" aria-label="Previous file"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button type="button" class="pd9-dp-btn pd9-dp-next" title="Next file (Down or Right arrow)" aria-label="Next file"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <span class="pd9-dp-title"></span>
          <span class="pd9-dp-count"></span>
          <button type="button" class="pd9-dp-btn pd9-dp-tab" title="Open in a new tab" aria-label="Open in a new tab"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button type="button" class="pd9-dp-btn pd9-dp-x" title="Close (Esc)" aria-label="Close preview"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </header>
        <div class="pd9-dp-body"><div class="pd9-dp-msg" hidden></div></div>`;
      document.body.appendChild(panel);
      const w = +store.get(DOCPREV_W_KEY, 0);
      if (w) panel.style.width = `${Math.min(Math.max(w, 360), window.innerWidth - 120)}px`;
      $('.pd9-dp-x', panel).addEventListener('click', closeDocPreview);
      $('.pd9-dp-prev', panel).addEventListener('click', () => stepDocPreview(-1));
      $('.pd9-dp-next', panel).addEventListener('click', () => stepDocPreview(1));
      $('.pd9-dp-tab', panel).addEventListener('click', () => { if (docPrevId) window.open(docViewUrl(docPrevId), '_blank'); });
      // Drag the left edge to resize.
      const edge = $('.pd9-dp-edge', panel);
      edge.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        edge.setPointerCapture(e.pointerId);
        panel.classList.add('pd9-dp-resizing');
        const move = (ev) => { panel.style.width = `${Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth - 120)}px`; };
        const up = () => {
          edge.removeEventListener('pointermove', move);
          edge.removeEventListener('pointerup', up);
          panel.classList.remove('pd9-dp-resizing');
          store.set(DOCPREV_W_KEY, Math.round(panel.getBoundingClientRect().width));
        };
        edge.addEventListener('pointermove', move);
        edge.addEventListener('pointerup', up);
      });
      document.addEventListener('keydown', docPrevKeys, true);
    }
    docPrevId = String(id);
    showDocFrame(panel, docPrevId);
    $('.pd9-dp-title', panel).textContent = name || `File ${id}`;
    $('.pd9-dp-title', panel).title = name || '';
    const rows = docRows();
    const at = rows.findIndex((r) => docIdOf(r) === docPrevId);
    $('.pd9-dp-count', panel).textContent = at >= 0 ? `${at + 1} of ${rows.length}` : '';
    $('.pd9-dp-prev', panel).disabled = at <= 0;
    $('.pd9-dp-next', panel).disabled = at < 0 || at >= rows.length - 1;
    markPreviewedRow();
    const row = rows[at];
    if (row) row.scrollIntoView({ block: 'nearest' });
    // Load the files around this one in the background, so stepping to them is instant.
    const near = [rows[at + 1], rows[at - 1], rows[at + 2]].filter(Boolean).map(docIdOf);
    keepDocFrames(panel, [docPrevId, ...near]);
    preloadDocFrames(panel, near);
  }

  // Each file gets its own viewer frame. Frames for nearby files stay loaded
  // (hidden), so going to the next or previous file just shows the one that's
  // already there instead of starting the viewer again.
  const DOC_FRAMES_MAX = 5;
  function docFrame(panel, id, make) {
    let f = $(`iframe[data-doc="${CSS.escape(id)}"]`, panel);
    if (f || !make) return f;
    f = document.createElement('iframe');
    f.name = 'fv-doc-preview';
    f.title = 'File preview';
    f.dataset.doc = id;
    f.dataset.used = String(Date.now());
    f.addEventListener('load', () => {
      let ok = true;
      try { const href = f.contentWindow.location.href; ok = !!href && href !== 'about:blank'; } catch (e) { ok = false; }
      f.dataset.state = ok ? 'ok' : 'blocked';
      if (ok) { try { f.contentWindow.document.addEventListener('keydown', docPrevKeys, true); } catch (e) { /* not allowed */ } }
      if (f.classList.contains('pd9-dp-on')) showDocMsg(panel, f);
    });
    f.src = docViewUrl(id);
    $('.pd9-dp-body', panel).appendChild(f);
    return f;
  }
  function showDocMsg(panel, f) {
    const msg = $('.pd9-dp-msg', panel);
    if (f.dataset.state !== 'blocked') { msg.hidden = true; return; }
    msg.hidden = false;
    msg.innerHTML = '<p>Filevine won\'t show this file inside the page.</p><button type="button">Open it in a new tab</button>';
    $('button', msg).addEventListener('click', () => window.open(docViewUrl(f.dataset.doc), '_blank'));
  }
  function showDocFrame(panel, id) {
    const f = docFrame(panel, id, true);
    f.dataset.used = String(Date.now());
    $$('iframe', panel).forEach((x) => x.classList.toggle('pd9-dp-on', x === f));
    showDocMsg(panel, f);
  }
  function keepDocFrames(panel, keep) {
    const frames = $$('iframe', panel).filter((x) => !keep.includes(x.dataset.doc))
      .sort((a, b) => +a.dataset.used - +b.dataset.used);
    while (frames.length && $$('iframe', panel).length > DOC_FRAMES_MAX) frames.shift().remove();
  }
  // One at a time, after the file you're looking at has loaded, so they don't slow it down.
  function preloadDocFrames(panel, ids) {
    const cur = docFrame(panel, docPrevId, false);
    const go = () => {
      const want = docPrevId;
      let chain = Promise.resolve();
      ids.forEach((id) => {
        chain = chain.then(() => new Promise((done) => {
          if (!panel.isConnected || docPrevId !== want || docFrame(panel, id, false)) { done(); return; }
          const f = docFrame(panel, id, true);
          f.addEventListener('load', () => setTimeout(done, 300), { once: true });
          setTimeout(done, 15000);
        }));
      });
    };
    if (cur && cur.dataset.state) go(); else if (cur) cur.addEventListener('load', () => setTimeout(go, 500), { once: true });
  }
  function stepDocPreview(d) {
    const rows = docRows();
    const at = rows.findIndex((r) => docIdOf(r) === docPrevId);
    const next = rows[at + d];
    if (next) openDocPreview(docIdOf(next), docNameOf(next));
  }
  function docPrevKeys(e) {
    if (!document.getElementById('pd9-docprev')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName || ''))) return;
    // Up/Down work everywhere. Left/Right work too, except inside the file itself,
    // where Filevine's viewer may use them to turn pages.
    const inViewer = t && t.ownerDocument && t.ownerDocument !== document;
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: inViewer ? 0 : 1, ArrowLeft: inViewer ? 0 : -1 }[e.key];
    if (step && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); stepDocPreview(step); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDocPreview(); }
  }
  function closeDocPreview() {
    const panel = document.getElementById('pd9-docprev');
    if (!panel) return;
    panel.remove();
    document.removeEventListener('keydown', docPrevKeys, true);
    docPrevId = null;
    markPreviewedRow();
  }


  // ---------- Task triage (staff edition) ----------
  // On the Tasks page: a flag on every task (grey until you set it) to sort out
  // what matters, since due dates are often set wrong.
  //   Red = do first, Yellow = do soon, Green = can wait.
  // Sort by Filevine's due date, newest created first, or priority. Show only one
  // color. Select several tasks and flag them all at once. Hover a task and press
  // 1 (red), 2 (yellow), 3 (green), or 0 (clear) to flag it from the keyboard.
  // Flags are kept on this computer for you (Filevine doesn't have a place for them).
  const TRIAGE_KEY = 'pd9-task-flags';
  const TRIAGE_VIEW_KEY = 'pd9-task-triage-view';
  const FLAGS = [
    { id: 'red', label: 'Red', hint: 'Do first', key: '1' },
    { id: 'yellow', label: 'Yellow', hint: 'Do soon', key: '2' },
    { id: 'green', label: 'Green', hint: 'Can wait', key: '3' },
  ];
  const FLAG_RANK = { red: 0, yellow: 1, green: 2, '': 3 };
  const onTasksPage = () => /#\/tasks\b/i.test(location.hash);
  const triageView = () => ({ sort: 'due', show: 'all', ...(store.get(TRIAGE_VIEW_KEY, null) || {}) });
  const setTriageView = (patch) => store.set(TRIAGE_VIEW_KEY, { ...triageView(), ...patch });
  let triageSelecting = false;
  const triagePicked = new Set();
  let triageHover = null;

  function flagStore() {
    const all = store.get(TRIAGE_KEY, null) || {};
    return all;
  }
  function setFlag(keys, flag) {
    const all = flagStore();
    const now = Date.now();
    for (const k of keys) { if (flag) all[k] = { f: flag, at: now }; else delete all[k]; }
    // Forget flags nobody has touched in 6 months (finished tasks drop off the list).
    for (const [k, v] of Object.entries(all)) if (now - (v.at || 0) > 182 * 864e5) delete all[k];
    store.set(TRIAGE_KEY, all);
  }

  // What we know about a task card: a stable key (case + when it was made + subject + text),
  // the created time, and the case.
  function taskInfo(li) {
    if (li._pd9t) return li._pd9t;
    const link = $('.activity-item-project-link a, a.project-link', li);
    const pid = link ? ((link.getAttribute('href') || '').match(/\/project\/(\d+)/) || [])[1] || '' : '';
    const byline = $$('.byline-container .tertiary-text', li).map((el) => el.textContent.trim());
    const stamp = byline.find((t) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) || '';
    const subject = (($('.byline-container .subject', li) || {}).textContent || '').trim();
    const body = (($('.activity-text-body', li) || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const m = stamp.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})\s*([AP]M))?/i);
    let created = null;
    if (m) {
      let h = +(m[4] || 0);
      if (m[6]) { if (/pm/i.test(m[6]) && h < 12) h += 12; if (/am/i.test(m[6]) && h === 12) h = 0; }
      created = new Date(+m[3], +m[1] - 1, +m[2], h, +(m[5] || 0));
    }
    const info = { key: `${pid}|${stamp}|${subject}|${body}`, created, pid };
    if (pid && stamp) li._pd9t = info; // only keep it once the card has finished drawing
    return info;
  }
  const flagOf = (li) => { const f = flagStore()[taskInfo(li).key]; return f ? f.f : ''; };

  function flagIcon(color) {
    return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 21V4M6 4h10l-2 4 2 4H6" fill="${color ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function openFlagMenu(anchor, keys, after) {
    document.querySelectorAll('.pd9-flag-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'pd9-flag-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = FLAGS.map((f) => `<button type="button" role="menuitem" data-flag="${f.id}"><span class="pd9-fdot pd9-f-${f.id}"></span><b>${f.label}</b><span>${f.hint}</span><kbd class="pd9-kbd">${f.key}</kbd></button>`).join('')
      + '<button type="button" role="menuitem" data-flag=""><span class="pd9-fdot"></span><b>No flag</b><span>Clear</span><kbd class="pd9-kbd">0</kbd></button>';
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 230))}px`;
    menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 200)}px`;
    const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
    const pick = (flag) => { setFlag(keys, flag); close(); if (after) after(); drawTriage(); };
    const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      const f = FLAGS.find((x) => x.key === e.key);
      if (f) { e.preventDefault(); e.stopPropagation(); pick(f.id); } else if (e.key === '0') { e.preventDefault(); e.stopPropagation(); pick(''); }
    };
    menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-flag]'); if (b) { e.stopPropagation(); pick(b.dataset.flag); } });
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); }, 0);
    menu.querySelector('button').focus();
  }

  // Keep Filevine from opening the task when you use our controls.
  const stopForFilevine = (el) => ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown'].forEach((t) => el.addEventListener(t, (e) => {
    if (t === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  }));

  function decorateTask(li) {
    const left = $('.item-left', li);
    if (!left) return;
    if (!$('.pd9-flag-btn', li)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd9-flag-btn';
      stopForFilevine(b);
      b.addEventListener('click', (e) => { e.preventDefault(); openFlagMenu(b, [taskInfo(li).key]); });
      left.appendChild(b);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pd9-tri-pick';
      stopForFilevine(cb);
      cb.addEventListener('change', () => { const k = taskInfo(li).key; if (cb.checked) triagePicked.add(k); else triagePicked.delete(k); drawTriage(); });
      left.prepend(cb);
      li.addEventListener('mouseenter', () => { triageHover = li; });
      li.addEventListener('mouseleave', () => { if (triageHover === li) triageHover = null; });
    }
    const f = flagOf(li);
    const btn = $('.pd9-flag-btn', li);
    const meta = FLAGS.find((x) => x.id === f);
    if (btn.dataset.flag !== f) {
      btn.dataset.flag = f;
      btn.innerHTML = flagIcon(f);
      btn.title = meta ? `${meta.label}: ${meta.hint}. Click to change (or hover and press 1, 2, 3, 0).` : 'Not flagged. Click to flag (or hover and press 1, 2, 3).';
      btn.setAttribute('aria-label', meta ? `Flag: ${meta.label}. Change` : 'Set flag');
    }
    li.dataset.pd9Flag = f;
    const cb = $('.pd9-tri-pick', li);
    cb.checked = triagePicked.has(taskInfo(li).key);
    cb.setAttribute('aria-label', `Select task: ${(($('.byline-container .subject', li) || $('.project-name', li) || {}).textContent || '').trim()}`);
  }

  // Quick search: every word typed must appear somewhere in the task card.
  let triageQuery = '';
  const taskText = (li) => (li.textContent || '').replace(/\s+/g, ' ').toLowerCase();
  const matchesQuery = (li) => {
    const words = triageQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const t = taskText(li);
    return words.every((w) => t.includes(w));
  };

  function drawTriage() {
    if (!onTasksPage()) return;
    const items = $$('ul.activity-group-list > li.activity-list-item');
    const view = triageView();
    items.forEach(decorateTask);
    document.documentElement.classList.toggle('pd9-tri-selecting', triageSelecting);

    // Sort with CSS order, so Filevine's own list stays untouched underneath.
    $$('ul.activity-group-list').forEach((ul) => ul.classList.toggle('pd9-tri-sorted', view.sort !== 'due'));
    const created = (li) => { const c = taskInfo(li).created; return c ? c.getTime() : 0; };
    const ordered = items.slice();
    if (view.sort === 'new') ordered.sort((a, b) => created(b) - created(a));
    if (view.sort === 'priority') ordered.sort((a, b) => FLAG_RANK[flagOf(a)] - FLAG_RANK[flagOf(b)] || created(b) - created(a));
    ordered.forEach((li, i) => { li.style.order = view.sort === 'due' ? '' : String(i); });

    // Show only one color.
    const counts = { all: items.length, red: 0, yellow: 0, green: 0, none: 0 };
    const found = items.filter(matchesQuery);
    counts.all = found.length;
    found.forEach((li) => { const f = flagOf(li); counts[f || 'none'] += 1; });
    items.forEach((li) => {
      const f = flagOf(li) || 'none';
      li.classList.toggle('pd9-tri-hide', !matchesQuery(li) || (view.show !== 'all' && view.show !== f));
    });
    const shownCount = items.filter((li) => !li.classList.contains('pd9-tri-hide')).length;

    // The bar above the list.
    const host = $('.activity-content');
    if (!host) return;
    let bar = $('#pd9-triage');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pd9-triage';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Task triage');
      host.parentNode.insertBefore(bar, host);
      // The search box is built once, so redrawing the rest never steals focus.
      const find = document.createElement('div');
      find.className = 'pd9-tri-find';
      find.innerHTML = `<input type="search" placeholder="Search tasks" aria-label="Search tasks. Matches any text in the task, like a word or a date such as 9/28." autocomplete="off" spellcheck="false"><span class="pd9-tri-none" hidden>No matches</span>`;
      const box = find.querySelector('input');
      box.value = triageQuery;
      box.addEventListener('input', () => { triageQuery = box.value; drawTriage(); });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; triageQuery = ''; drawTriage(); }
      });
      ['keydown', 'keyup', 'keypress'].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));
      const dyn = document.createElement('div');
      dyn.className = 'pd9-tri-dyn';
      bar.append(find, dyn);
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.sort) { setTriageView({ sort: b.dataset.sort }); }
        else if (b.dataset.show) { setTriageView({ show: b.dataset.show }); }
        else if (b.dataset.act === 'select') { triageSelecting = !triageSelecting; if (!triageSelecting) triagePicked.clear(); }
        else if (b.dataset.act === 'all') {
          const shown = items.filter((li) => !li.classList.contains('pd9-tri-hide'));
          const keys = $$('ul.activity-group-list > li.activity-list-item').filter((li) => !li.classList.contains('pd9-tri-hide')).map((li) => taskInfo(li).key);
          const allOn = keys.length && keys.every((k) => triagePicked.has(k));
          keys.forEach((k) => (allOn ? triagePicked.delete(k) : triagePicked.add(k)));
          void shown;
        } else if (b.dataset.bulk !== undefined) {
          if (!triagePicked.size) { toast('Select tasks first.'); return; }
          setFlag([...triagePicked], b.dataset.bulk);
          const n = triagePicked.size;
          const meta = FLAGS.find((x) => x.id === b.dataset.bulk);
          toast(meta ? `Flagged ${n} task${n === 1 ? '' : 's'} ${meta.label.toLowerCase()}.` : `Cleared ${n} flag${n === 1 ? '' : 's'}.`);
          triagePicked.clear();
        }
        drawTriage();
      });
    }
    const seg = (key, val, label) => `<button type="button" data-${key}="${val}" aria-pressed="${view[key] === val}">${label}</button>`;
    const pickedShown = $$('ul.activity-group-list > li.activity-list-item').filter((li) => !li.classList.contains('pd9-tri-hide')).map((li) => taskInfo(li).key);
    const allPicked = pickedShown.length && pickedShown.every((k) => triagePicked.has(k));
    const html = `
      <div class="pd9-tri-group"><span class="pd9-tri-label">Sort</span>
        <div class="pd9-tri-seg">${seg('sort', 'due', 'Due date')}${seg('sort', 'new', 'Newest')}${seg('sort', 'priority', 'Priority')}</div></div>
      <div class="pd9-tri-group"><span class="pd9-tri-label">Show</span>
        <div class="pd9-tri-chips">
          ${seg('show', 'all', `All <span class="pd9-tri-n">${counts.all}</span>`)}
          ${FLAGS.map((f) => seg('show', f.id, `<span class="pd9-fdot pd9-f-${f.id}"></span>${f.label} <span class="pd9-tri-n">${counts[f.id]}</span>`)).join('')}
          ${seg('show', 'none', `<span class="pd9-fdot"></span>Not flagged <span class="pd9-tri-n">${counts.none}</span>`)}
        </div></div>
      <div class="pd9-tri-grow"></div>
      ${triageSelecting ? `
        <div class="pd9-tri-bulk">
          <button type="button" data-act="all">${allPicked ? 'Unselect all' : 'Select all shown'}</button>
          <span class="pd9-tri-count">${triagePicked.size} selected</span>
          ${FLAGS.map((f) => `<button type="button" class="pd9-tri-flagbtn" data-bulk="${f.id}" title="Flag selected ${f.label.toLowerCase()}"><span class="pd9-fdot pd9-f-${f.id}"></span>${f.label}</button>`).join('')}
          <button type="button" class="pd9-tri-flagbtn" data-bulk="" title="Remove the flag from selected tasks">Clear</button>
          <button type="button" data-act="select" class="pd9-tri-done">Done</button>
        </div>` : '<button type="button" data-act="select" class="pd9-tri-select">Select tasks</button>'}`;
    const dyn = $('.pd9-tri-dyn', bar);
    if (dyn._html !== html) { dyn._html = html; dyn.innerHTML = html; }
    const none = $('.pd9-tri-none', bar);
    if (none) none.hidden = !(triageQuery.trim() && !shownCount);
  }

  // Hover a task and press 1, 2, 3 or 0 to flag it.
  document.addEventListener('keydown', (e) => {
    if (!STAFF || !onTasksPage() || !triageHover || !triageHover.isConnected) return;
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || document.querySelector('.pd9-flag-menu')) return;
    const f = FLAGS.find((x) => x.key === e.key);
    if (!f && e.key !== '0') return;
    e.preventDefault();
    setFlag([taskInfo(triageHover).key], f ? f.id : '');
    drawTriage();
  }, true);

  function addTaskTriage() {
    if (!onTasksPage()) {
      const bar = document.getElementById('pd9-triage');
      if (bar) bar.remove();
      document.documentElement.classList.remove('pd9-tri-selecting');
      return;
    }
    drawTriage();
  }

  // ---------- Search the activity feed ----------
  // A search box above a case's Activity feed (and the Tasks page). Every word
  // typed must appear in the item. Matches are highlighted. Filevine only loads
  // the newest items at first, so "Search older items" scrolls the feed down to
  // load the rest. Nothing is changed in Filevine; items are just hidden.
  const ff = { query: '', route: '', seen: -1, loading: false, timer: 0 };
  const ffItems = () => $$('ul.activity-group-list > li.activity-list-item');
  const ffRoute = () => (location.hash.match(/^#\/(project\/\d+|tasks)/) || [])[0] || location.hash;

  function ffApply() {
    const items = ffItems();
    const words = ff.query.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    items.forEach((li) => {
      const t = (li.textContent || '').replace(/\s+/g, ' ').toLowerCase();
      const hit = !words.length || words.every((w) => t.includes(w));
      li.classList.toggle('pd9-ff-hide', !hit);
      if (hit) shown += 1;
    });
    $$('.activity-item-group').forEach((g) => {
      const has = !words.length || !!g.querySelector('li.activity-list-item:not(.pd9-ff-hide)');
      g.classList.toggle('pd9-ff-hide-group', !has);
    });
    ff.seen = items.length;
    ffHighlight(words, items);
    const bar = document.getElementById('pd9-feedfind');
    if (!bar) return;
    const count = $('.pd9-ff-count', bar);
    const more = $('.pd9-ff-more', bar);
    count.textContent = words.length ? (shown ? `${shown} of ${items.length} loaded` : `No matches in ${items.length} loaded`) : '';
    count.dataset.none = String(!!words.length && !shown);
    more.hidden = !words.length || ff.loading;
    $('.pd9-ff-clear', bar).hidden = !ff.query;
  }

  // Highlight the matches without changing the page (CSS Custom Highlight API).
  function ffHighlight(words, items) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.delete('pd9-ff');
    if (!words.length) return;
    const ranges = [];
    for (const li of items) {
      if (li.classList.contains('pd9-ff-hide')) continue;
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n && ranges.length < 1500; n = walker.nextNode()) {
        const low = n.nodeValue.toLowerCase();
        for (const w of words) {
          for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, at + w.length)) {
            const r = new Range();
            r.setStart(n, at);
            r.setEnd(n, at + w.length);
            ranges.push(r);
          }
        }
      }
    }
    if (ranges.length) CSS.highlights.set('pd9-ff', new Highlight(...ranges));
  }

  // Scroll the feed to the bottom until Filevine stops adding older items.
  async function ffLoadOlder() {
    const box = $('.activity-main') || $('.fv-vscrollbox');
    const bar = document.getElementById('pd9-feedfind');
    if (!box || ff.loading) return;
    ff.loading = true;
    const status = bar && $('.pd9-ff-count', bar);
    const keepTop = box.scrollTop;
    let last = -1;
    let still = 0;
    for (let i = 0; i < 80 && still < 3; i += 1) {
      const n = ffItems().length;
      if (status) status.textContent = `Loading older items... ${n} so far`;
      box.scrollTop = box.scrollHeight;
      box.dispatchEvent(new Event('scroll'));
      const moreBtn = [...box.querySelectorAll('button')].find((b) => /^(load|show) more/i.test(b.textContent.trim()) && b.offsetParent);
      if (moreBtn) moreBtn.click();
      await sleep(700);
      const now = ffItems().length;
      still = now === last ? still + 1 : 0;
      last = now;
    }
    box.scrollTop = keepTop;
    ff.loading = false;
    ffApply();
  }

  function addFeedSearch() {
    const host = $('.activity-content');
    let bar = document.getElementById('pd9-feedfind');
    // Staff already have a search box in the Tasks triage bar.
    if (!host || (STAFF && onTasksPage())) {
      if (bar) bar.remove();
      if (ff.query || $('.pd9-ff-hide')) { $$('.pd9-ff-hide').forEach((li) => li.classList.remove('pd9-ff-hide')); if (window.CSS && CSS.highlights) CSS.highlights.delete('pd9-ff'); }
      return;
    }
    const route = ffRoute();
    if (route !== ff.route) { ff.route = route; ff.query = ''; ff.seen = -1; if (bar) { $('input', bar).value = ''; } }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pd9-feedfind';
      bar.innerHTML = `
        <span class="pd9-ff-field">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="search" autocomplete="off" spellcheck="false">
          <button type="button" class="pd9-ff-clear" aria-label="Clear search" hidden>&#215;</button>
        </span>
        <span class="pd9-ff-count" role="status" aria-live="polite"></span>
        <button type="button" class="pd9-ff-more" hidden title="Filevine loads the newest items first. This loads the older ones so the search covers everything.">Search older items</button>`;
      const box = $('input', bar);
      box.placeholder = onTasksPage() ? 'Search tasks' : 'Search activity (words or a date like 10/2)';
      box.setAttribute('aria-label', box.placeholder);
      box.value = ff.query;
      box.addEventListener('input', () => { ff.query = box.value.trim(); clearTimeout(ff.timer); ff.timer = setTimeout(ffApply, 120); });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; ff.query = ''; ffApply(); }
      });
      // Keep Filevine's and the Improver's shortcut keys out of the box.
      ['keydown', 'keyup', 'keypress'].forEach((t) => box.addEventListener(t, (e) => { if (e.key !== 'Escape') e.stopPropagation(); }));
      $('.pd9-ff-clear', bar).addEventListener('click', () => { box.value = ''; ff.query = ''; ffApply(); box.focus(); });
      $('.pd9-ff-more', bar).addEventListener('click', ffLoadOlder);
    }
    // Right after Filevine's Filter button. If that is not there, above the feed.
    const filterBtn = $('button[data-testid="activity-filter-button"]')
      || $$('.activity-page-controls button').find((b) => /^\s*filter\s*$/i.test(b.textContent || ''));
    if (filterBtn) {
      if (bar.previousElementSibling !== filterBtn) filterBtn.after(bar);
      bar.classList.add('pd9-ff-inline');
    } else {
      if (bar.nextElementSibling !== host && host.parentNode) host.parentNode.insertBefore(bar, host);
      bar.classList.remove('pd9-ff-inline');
    }
    // New items came in (scrolling, a new note): filter them too.
    if (ff.query && ffItems().length !== ff.seen) ffApply();
  }

  // ---------- Intake and Request tabs: small helpers ----------
  //  - "Today" next to Today's Date (Intake) and Date Requested (Request).
  //  - "File Review" template next to Incident Details (Intake).
  //  - "Conflict" template next to Comment, once Request Type is CONFLICT (Request).
  //  - Requestor fills in with you (the person signed in to Filevine).
  // These only type into the form like you would. Nothing saves until you click Save.
  const FORM_TEMPLATES = {
    'File Review': OLD_DEFAULT_BODIES['File Review'],
    Conflict: OLD_DEFAULT_BODIES.Conflict,
  };
  // If you kept your own copy of the template in Improver Options, use yours.
  const formTemplate = (label) => {
    const mine = TEMPLATES.find((t) => t.label.trim().toLowerCase() === label.toLowerCase());
    return (mine && mine.body) || FORM_TEMPLATES[label] || '';
  };
  const fieldInForm = (root, prefix, tag = '') => $(`${tag}[name^="${prefix}"]`, root);
  const labelRowOf = (el) => {
    const field = el && el.closest('.custom-field');
    const label = field && field.querySelector('field-label');
    return label && label.parentElement;
  };
  function addFieldButton(row, cls, text, title, onClick) {
    if (!row || row.querySelector(`.${cls}`)) return row && row.querySelector(`.${cls}`);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pd9-field-btn ${cls}`;
    b.textContent = text;
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    row.appendChild(b);
    return b;
  }

  // Type a date the way Filevine's date box accepts it: type, then click away.
  function typeDate(input, value) {
    input.focus();
    input.select();
    document.execCommand('insertText', false, value);
    if (input.value !== value) setInputValue(input, value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  // Put a template in a text box, cursor at the {|} spot.
  function fillTextArea(area, body) {
    if (area.value.trim() && !confirm('Replace what is already in this box?')) return;
    const text = body.replace(/\{date\}/g, dueDateString(0));
    const at = text.indexOf('{|}');
    const clean = text.replace('{|}', '');
    area.focus();
    area.select();
    document.execCommand('insertText', false, clean);
    if (area.value !== clean) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, clean);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.dispatchEvent(new Event('change', { bubbles: true }));
    const pos = at < 0 ? clean.length : at;
    area.setSelectionRange(pos, pos);
  }

  // The person signed in to Filevine (from the avatar at the top right).
  const myName = () => {
    const a = $('.global-avatar-menu-trigger-content [aria-label], [data-testid="chat-container"][data-testid-name]');
    return ((a && (a.getAttribute('aria-label') || a.getAttribute('data-testid-name'))) || '').trim();
  };

  // Pick you in a person box (Filevine's contact search). Typing triggers the
  // search; then click the match. Gives up quietly if there is no clear match.
  const filledPerson = new WeakSet();
  async function fillPersonWithMe(field, quiet) {
    const name = myName();
    const input = field && $('input.person-input', field);
    if (!name || !input || !isVisible(input)) { if (!quiet) toast('Could not find your name or the Requestor box.'); return; }
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    input.focus();
    setInputValue(input, '');
    for (const ch of name) {
      document.execCommand('insertText', false, ch);
      await sleep(25);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const pick = await waitFor(() => {
      const items = $$('ul.person-list li, ul.dropdown-menu li', field).filter((li) => isVisible(li));
      const hits = items.filter((li) => { const t = li.textContent.toLowerCase(); return words.every((w) => t.includes(w)); });
      return hits.length ? hits[0] : null;
    }, 4000);
    if (!pick) { if (!quiet) toast(`Could not find "${name}" in the Requestor list. Pick it by hand.`); return; }
    (pick.querySelector('a') || pick).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    (pick.querySelector('a') || pick).click();
  }

  function addFormHelpers() {
    for (const form of $$('form.project-item-edit-form')) {
      // Today buttons
      for (const prefix of ['todaysdate', 'daterequested']) {
        const input = fieldInForm(form, prefix, 'input');
        if (!input || input.tagName !== 'INPUT' || input.readOnly) continue;
        addFieldButton(labelRowOf(input), 'pd9-today-btn', 'Today', 'Fill in today’s date', () => {
          const live = fieldInForm(form, prefix, 'input');
          if (live) typeDate(live, dueDateString(0));
        });
      }
      // File Review template (Intake)
      const incident = fieldInForm(form, 'incidentdetails', 'textarea');
      if (incident && incident.tagName === 'TEXTAREA') {
        addFieldButton(labelRowOf(incident), 'pd9-fr-btn', 'File Review template', 'Fill this box with the File Review template', () => {
          const live = fieldInForm(form, 'incidentdetails', 'textarea');
          if (live) fillTextArea(live, formTemplate('File Review'));
        });
      }
      // Conflict template (Request), only when Request Type is CONFLICT
      const type = fieldInForm(form, 'requesttype', 'select');
      const comment = fieldInForm(form, 'comment', 'textarea');
      // Picking a Request Type doesn't change the page layout, so watch it directly.
      if (type && !type._pd9Redraw) {
        type._pd9Redraw = true;
        type.addEventListener('change', () => setTimeout(addFormHelpers, 50));
      }
      if (type && comment && comment.tagName === 'TEXTAREA') {
        const isConflict = /conflict/i.test(type.value || (type.selectedOptions && type.selectedOptions[0] && type.selectedOptions[0].textContent) || '');
        const row = labelRowOf(comment);
        const btn = row && row.querySelector('.pd9-cf-btn');
        if (isConflict && !btn) {
          addFieldButton(row, 'pd9-cf-btn', 'Conflict template', 'Fill the comment with the Conflict template', () => {
            const live = fieldInForm(form, 'comment', 'textarea');
            if (live) fillTextArea(live, formTemplate('Conflict'));
          });
        } else if (!isConflict && btn) btn.remove();
      }
      // Requestor: a "Me" button, and filled in by itself when you pick a Request Type.
      const requestor = $('[name^="requestor"]', form);
      if (requestor && type) {
        const row = labelRowOf(requestor);
        addFieldButton(row, 'pd9-me-btn', 'Me', 'Fill in your name', () => fillPersonWithMe(requestor, false));
        if (!type._pd9Watch) {
          type._pd9Watch = true;
          type.addEventListener('change', () => {
            const pi = $('.person-input', requestor);
            const empty = pi && isVisible(pi) && !pi.value.trim();
            if (empty && !filledPerson.has(requestor)) {
              filledPerson.add(requestor);
              setTimeout(() => fillPersonWithMe(requestor, true), 300);
            }
          });
        }
      }
    }
  }

  function decorate() {
    watchProject();
    addOptionsMenuItem();
    addCloseButton();
    addCloseHints();
    if (!IN_FRAME) {
      addCaseSearchButton();
      applyCaseFilter();
      keepAdvanced();
      if (!STAFF) {
        rewriteHubLinks();
        showHubEvents();
        showOwnTable();
        keepCaseWindows();
      }
      if (STAFF) addTaskTriage();
    }
    makeComposerMovable();
    addJailButton();
    addBenchmarkButton();
    addDepoButton();
    if (!STAFF) addSwitchButton();
    addDocPreview();
    addFormHelpers();
    addFeedSearch();
    for (const form of $$(COMPOSERS)) {
      const layout = $(SEL.layout, form);
      if (layout && !$('.fvqn-wrap', form)) layout.parentNode.insertBefore(buildBar(form), layout);
      clearTagsIfReopened(form);
      clearLeftoverTemplateTags(form);
      autoShowTags(form);
      updateWarning(form);
      addRestoreButton(form);
      // Hide the templates in task mode.
      const bar = $('.fvqn-bar', form);
      const isTask = !!$(SEL.taskFields, form);
      if (isTask) defaultDueDate(form).catch(() => {});
      if (bar && bar.hidden !== isTask) bar.hidden = isTask;
    }
  }

  // ---------- drafts ----------
  // One saved draft per case, updated on every change. Closing the box with
  // the X clears the box but keeps the draft, so "Restore note" can bring it back.
  const DRAFT_PREFIX = 'fvqn-draft:';
  const draftKey = (form) => {
    const proj = $(SEL.projectName, form);
    const name = proj ? proj.textContent.trim() : currentCaseName();
    return name ? DRAFT_PREFIX + name : null;
  };

  function readDraft(key) {
    try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch (e) { return null; }
  }

  const currentText = (form) => {
    const box = $(SEL.message, form), subj = $(SEL.subject, form);
    return { body: box ? box.innerText.replace(/\n+$/, '') : '', subject: subj ? subj.value : '' };
  };

  // Returns what's in the box (so callers don't have to measure it again).
  function saveDraft(form) {
    const text = currentText(form);
    if (!SAVE_DRAFTS) return text;
    const key = draftKey(form);
    if (!key) return text;
    const { body, subject } = text;
    // Never overwrite a saved draft with an empty box.
    if (!body.trim() && !subject.trim()) return text;
    try {
      localStorage.setItem(key, JSON.stringify({ subject, body, at: Date.now() }));
    } catch (e) {
      pruneDrafts(true); // storage full: clean up and try once more
      try { localStorage.setItem(key, JSON.stringify({ subject, body, at: Date.now() })); } catch (e2) { /* give up */ }
    }
    pruneDrafts();
    return text;
  }

  // Delete drafts that are too old, and keep only the newest DRAFT_MAX_COUNT.
  let lastPrune = 0;
  function pruneDrafts(force = false) {
    if (!force && Date.now() - lastPrune < 60000) return; // at most once a minute
    lastPrune = Date.now();
    const cutoff = Date.now() - DRAFT_MAX_AGE_DAYS * 864e5;
    const drafts = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) drafts.push({ k, at: (readDraft(k) || {}).at || 0 });
    }
    drafts.sort((a, b) => b.at - a.at);
    drafts.forEach((d, i) => {
      if (d.at < cutoff || i >= (force ? Math.floor(DRAFT_MAX_COUNT / 2) : DRAFT_MAX_COUNT)) {
        try { localStorage.removeItem(d.k); } catch (e) { /* ignore */ }
      }
    });
  }

  async function restoreDraft(form) {
    const d = readDraft(draftKey(form));
    const box = $(SEL.message, form);
    if (!d || !box) { toast('No saved note for this case.'); return; }
    const now = currentText(form);
    if ((now.body.trim() || now.subject.trim()) && !confirm('Replace what is in the box with your saved note?')) return;
    const subj = $(SEL.subject, form);
    if (subj) setInputValue(subj, d.subject || '');
    await fillMessage(box, (d.body || '').replace(/\{(date|\|)\}/g, ''), () => $(SEL.message, form)); // saved text is plain text
  }

  function clearDraftAfterSave(form) {
    const key = draftKey(form);
    setTimeout(() => {
      const box = $(SEL.message, form);
      if (document.contains(form) && box && box.textContent.trim()) return; // save did not go through
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
      if (document.contains(form)) addRestoreButton(form, true);
    }, 1500);
  }

  // Recheck the Restore button whenever you click or tab into the note box.
  document.addEventListener('focusin', (e) => {
    const form = composerOf(e.target);
    if (form) addRestoreButton(form, true);
  }, true);

  // Save on every letter or change in the subject or message.
  document.addEventListener('input', (e) => {
    const form = composerOf(e.target);
    if (!form) return;
    const t = saveDraft(form);
    // What's in the box was just saved, so Restore has nothing to offer, unless
    // the box is empty (then an older draft may be worth restoring).
    const btn = $('.fvqn-restore', form);
    if (!t.body.trim() && !t.subject.trim()) addRestoreButton(form, true);
    else if (btn && !btn.hidden) btn.hidden = true;
  }, true);

  // "Restore note" button next to Add tags / Attach a file. Uses Filevine's button style.
  const restoreChecked = new WeakSet();
  function addRestoreButton(form, force = false) {
    const footer = $('.footer-controls', form);
    if (!footer) return;
    let btn = $('.fvqn-restore', footer);
    if (!btn) {
      // Copy Filevine's own "Attach a file" button so the look matches exactly
      // (Filevine's styles are tied to hidden class names we can't guess).
      const model = $$('button', footer).find((b) => /attach a file/i.test(b.textContent)) ||
        $$('button', footer).find((b) => !b.classList.contains('fvqn-restore'));
      if (!model) return;
      btn = model.cloneNode(true); // copies the look, not Filevine's click handler
      btn.classList.add('fvqn-restore');
      btn.removeAttribute('aria-label');
      btn.removeAttribute('data-testid');
      const icon = btn.querySelector('i');
      if (icon) {
        const hidden = icon.querySelector('.visually-hidden');
        if (hidden) hidden.textContent = 'slot-text:restore';
        const textNode = [...icon.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (textNode) textNode.nodeValue = 'restore ';
        else icon.prepend('restore ');
      }
      const label = btn.querySelector('.text-container');
      if (label) label.textContent = 'Restore note';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); restoreDraft(form); });
      footer.appendChild(btn);
    }
    // Only show it when there is a saved draft that differs from what is in the box.
    // Checked when the box first appears and as you type (see the input listener).
    if (!force && restoreChecked.has(btn)) return;
    restoreChecked.add(btn);
    const d = SAVE_DRAFTS && readDraft(draftKey(form));
    const now = currentText(form);
    const show = !!d && (d.body !== now.body || (d.subject || '') !== now.subject);
    if (btn.hidden === show) btn.hidden = !show;
  }

  const findSaveButton = (form) =>
    $$('.action-buttons button', form).find((b) => /add note|create task/i.test(b.textContent)) ||
    $('.action-buttons button.fvs-button--colored', form);

  document.addEventListener('click', (e) => {
    const form = composerOf(e.target);
    if (form && findSaveButton(form) && findSaveButton(form).contains(e.target)) {
      clearDraftAfterSave(form);
      // Filevine keeps the tags for the next note after you save, too (so a
      // #CLIENTCOMM from a call showed up on the next plain note). Clear them
      // the next time the box is empty and open.
      closedAt[kindOf(form)] = Date.now();
      [700, 1500, 3000].forEach((ms) => setTimeout(() => { if (form.isConnected) clearTagsIfReopened(form); }, ms));
    }
  }, true);

  // ---------- keys ----------
  document.addEventListener('keydown', (e) => {
    if (CTRL_ENTER_SAVES && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const form = composerOf(document.activeElement);
      const save = form && findSaveButton(form);
      if (save && !save.disabled) {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearDraftAfterSave(form);
        save.click();
      }
      return;
    }

    // Template shortcuts: open a note with that template, anywhere in a case.
    if (!e.repeat && !e.isComposing) {
      const combo = comboFromEvent(e);
      // C is built in for a contact note: if no template claims C, use the Contact template.
      const tpl = combo && (TEMPLATES.find((t) => t.hotkey === combo) ||
        (combo === 'C' && TEMPLATES.find((t) => /^client call$/i.test(t.label.trim()) || /^contact$/i.test(t.label.trim()))));
      if (tpl) {
        if (!inCase() || isTyping(e) || document.querySelector('.pd9-overlay')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openFloating(tpl.type === 'call' ? 'call' : 'note').then((form) => { if (form) useTemplate(form, tpl); });
        return;
      }
    }

    const type = HOTKEYS[e.key.toLowerCase()];
    if (!type) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
    if (!inCase() || isTyping(e) || document.querySelector('.pd9-overlay')) return;
    e.preventDefault();
    openFloating(type);
  }, true);

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    .fvqn-wrap { padding: 8px 12px 4px; }
    .fvqn-wrap:not(:has(> :not([hidden]))) { display: none; }
    .fvqn-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .fvqn-label { margin-right: 2px; white-space: nowrap; }
    .fvqn-chip {
      font: inherit; font-size: 13px; line-height: 1;
      padding: 7px 12px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--t-color-border, #c9ced6);
      background: var(--t-color-surface, #fff);
      color: var(--t-color-text, #1f2933);
    }
    .fvqn-chip:hover { background: var(--t-color-object-1-secondary, #e8f0fe); }
    .fvqn-chip:focus-visible { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: 2px; }
    .fvqn-hint { margin-left: auto; font-size: 12px; opacity: .6; white-space: pre; }
    .fvqn-warn {
      margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; font-size: 13px;
      background: #fff4d6; color: #6b4b00; border: 1px solid #f0c75e;
    }
    .fvqn-warn[hidden], .fvqn-bar[hidden], .fvqn-restore[hidden] { display: none !important; }
    /* Hide the Trending Tags box above the feed */
    .top-tags-note-filter { display: none !important; }
    /* ---------- Sentence form: closing-a-case order ----------
       Only the order on screen changes. Filevine saves the same fields as before.
       The rows are flattened so fields can move between them, then each field
       gets a place in line based on its name. Fields not listed go last. */
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid { display: flex !important; flex-wrap: wrap; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row { display: contents !important; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field { order: 200; float: none !important; flex: 0 0 100%; max-width: 100%; width: 100% !important; box-sizing: border-box; }
    @media (min-width: 700px) { form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field { flex-basis: 50%; max-width: 50%; width: 50% !important; } }
    @media (min-width: 1200px) { form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field { flex-basis: 25%; max-width: 25%; width: 25% !important; } }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="dispositionaction"]) { order: 10; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="sentencetype"]) { order: 20; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="othersentencetype"]) { order: 21; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="amount"]):not(:has([name^="amounttype"])) { order: 22; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="amounttype"]) { order: 23; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="sentencedate"]) { order: 30; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="dispositiondate"]) { order: 31; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="adjudicated"]) { order: 40; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="sentenceguideline"]) { order: 50; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="guidelinerange"]) { order: 51; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="f2_downwarddeparture"]) { order: 60; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="downwarddeparture"]) { order: 61; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="lowestdocsentencemonths"]) { order: 70; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="enhancement"]) { order: 80; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="sexenhancementdesignation"]) { order: 90; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="dispositiontype"]) { order: 100; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="dispositionchargereason"]) { order: 101; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="notes"]) { order: 110; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has([name^="dispositionnotes"]) { order: 120; }
    form.project-item-edit-form:has([name^="sentencetype"]):has([name^="dispositionaction"]) .custom-item-body > .flex-grid > .form-group.row > .custom-field:has(textarea) { flex-basis: 100% !important; max-width: 100% !important; width: 100% !important; }
    /* ---------- Improver Options window ---------- */
    .pd9-zoomopt { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #475467; margin-right: 6px; white-space: nowrap; }
    .pd9-zoomopt select { font: inherit; padding: 4px 6px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; }
    .pd9-overlay {
      position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); padding: 16px;
    }
    .pd9-overlay .pd9-dialog {
      width: min(860px, 100%); max-height: min(640px, 100%); display: flex; flex-direction: column;
      background: var(--t-color-surface, #fff); color: var(--t-color-text, #1f2933);
      border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3); font: inherit; font-size: 14px; overflow: hidden;
    }
    .pd9-overlay .pd9-head { display: flex; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--t-color-border, #dfe3e8); }
    .pd9-overlay h2 { margin: 0; font-size: 18px; font-weight: 600; flex: 1; }
    .pd9-overlay .pd9-x { border: 0; background: none; cursor: pointer; color: inherit; padding: 4px; border-radius: 4px; display: flex; }
    .pd9-overlay .pd9-x:hover { background: var(--t-color-object-1-secondary, #eef2f7); }
    .pd9-overlay .pd9-body { display: flex; min-height: 0; flex: 1; }
    .pd9-overlay .pd9-side { width: 220px; border-right: 1px solid var(--t-color-border, #dfe3e8); padding: 14px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
    .pd9-overlay .pd9-section { font-size: 12px; font-weight: 600; opacity: .7; }
    .pd9-overlay .pd9-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pd9-overlay .pd9-list li { padding: 8px 10px; border-radius: 6px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pd9-overlay .pd9-list li:hover { background: var(--t-color-object-1-secondary, #eef2f7); }
    .pd9-overlay .pd9-list li[aria-selected="true"] { background: var(--t-color-object-1-secondary, #e3ecfb); font-weight: 600; }
    .pd9-overlay .pd9-form { flex: 1; padding: 14px 20px 22px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
    .pd9-overlay label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
    .pd9-overlay input, .pd9-overlay textarea {
      font: inherit; font-size: 14px; font-weight: 400; color: inherit; background: var(--t-color-surface, #fff);
      border: 1px solid var(--t-color-border, #c9ced6); border-radius: 4px; padding: 8px 10px; width: 100%; box-sizing: border-box;
    }
    .pd9-overlay textarea { resize: vertical; font-family: inherit; line-height: 1.5; }
    .pd9-overlay input:focus, .pd9-overlay textarea:focus { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: -1px; }
    .pd9-overlay .pd9-tagwrap { display: flex; align-items: center; gap: 4px; font-weight: 400; }
    .pd9-overlay .pd9-help { margin: 0; font-size: 12px; opacity: .75; }
    .pd9-overlay code { background: var(--t-color-object-1-secondary, #eef2f7); padding: 1px 4px; border-radius: 3px; }
    .pd9-overlay .pd9-row, .pd9-overlay .pd9-foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pd9-overlay .pd9-foot { padding: 12px 20px; border-top: 1px solid var(--t-color-border, #dfe3e8); }
    .pd9-overlay .pd9-grow { flex: 1; }
    .pd9-overlay .pd9-btn {
      font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 4px; cursor: pointer;
      border: 1px solid var(--t-color-border, #c9ced6); background: var(--t-color-surface, #fff); color: inherit;
    }
    .pd9-overlay .pd9-btn:hover:not(:disabled) { background: var(--t-color-object-1-secondary, #eef2f7); }
    .pd9-overlay .pd9-btn:disabled { opacity: .45; cursor: default; }
    .pd9-overlay .pd9-btn:focus-visible, .pd9-overlay .pd9-list li:focus-visible { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: 2px; }
    .pd9-overlay .pd9-primary { background: #1f2933; border-color: #1f2933; color: #fff; }
    .pd9-overlay .pd9-primary:hover:not(:disabled) { background: #000; }
    .pd9-overlay .pd9-del { color: #b42318; }
    @media (max-width: 640px) {
      .pd9-overlay .pd9-body { flex-direction: column; }
      .pd9-overlay .pd9-side { width: auto; border-right: 0; border-bottom: 1px solid var(--t-color-border, #dfe3e8); }
    }
    /* Improved Close */
    .pd9-hint { font-size: 12px; line-height: 1.35; opacity: .72; margin: -2px 0 4px; }
    .pd9-overlay .pd9-small { width: min(460px, 100%); }
    .pd9-flash { outline: 3px solid #e8590c !important; outline-offset: 4px; border-radius: 6px; transition: outline-color .3s; }
    .pd9-panel {
      position: fixed; right: 20px; bottom: 20px; z-index: 100000; width: min(380px, calc(100vw - 40px));
      background: var(--t-color-surface, #fff); color: var(--t-color-text, #1f2933); font: inherit; font-size: 14px;
      border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3); padding: 16px 18px; border-top: 4px solid #e8590c;
    }
    .pd9-panel h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
    .pd9-panel ul { margin: 0 0 14px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .pd9-panel li.pd9-warn { color: #b42318; }
    .pd9-panel-btns { display: flex; justify-content: flex-end; gap: 8px; }
    .pd9-panel .pd9-btn {
      font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 4px; cursor: pointer;
      border: 1px solid var(--t-color-border, #c9ced6); background: var(--t-color-surface, #fff); color: inherit;
    }
    .pd9-panel .pd9-primary { background: #1f2933; border-color: #1f2933; color: #fff; }
    .pd9-panel .pd9-btn:disabled { opacity: .6; cursor: default; }
    /* Case # Search */
    .pd9-head-btn {
      display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 6px 10px; cursor: pointer;
      font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: transparent;
      border: 1px solid rgba(255, 255, 255, .55); border-radius: 4px; white-space: nowrap; align-self: center;
    }
    .pd9-head-btn:hover { background: rgba(255, 255, 255, .12); }
    .pd9-head-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    #pd9-case {
      position: fixed; z-index: 100000; width: 330px; padding: 14px; font: inherit; font-size: 13px;
      background: var(--t-color-surface, #fff); color: var(--t-color-text, #1f2933);
      border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
    }
    #pd9-case label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
    #pd9-case input {
      font: inherit; font-size: 14px; font-weight: 400; color: inherit; background: var(--t-color-surface, #fff);
      border: 1px solid var(--t-color-border, #c9ced6); border-radius: 4px; padding: 7px 9px; width: 100%; box-sizing: border-box;
    }
    #pd9-case input:focus { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: -1px; }
    #pd9-case .pd9-panel-btns { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    #pd9-case .pd9-btn {
      font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 4px; cursor: pointer;
      border: 1px solid var(--t-color-border, #c9ced6); background: var(--t-color-surface, #fff); color: inherit;
    }
    #pd9-case .pd9-primary { background: #1f2933; border-color: #1f2933; color: #fff; }
    #pd9-case { width: 380px; max-height: calc(100vh - 90px); overflow: auto; }
    #pd9-case .pd9-case-mine { margin: 6px 0 2px; font-size: 11.5px; font-weight: 600; color: #667085; }
    #pd9-case .pd9-hit-mine .pd9-case-title { font-weight: 700; }
    #pd9-case .pd9-case-results:empty { display: none; }
    #pd9-case .pd9-case-results { margin-top: 12px; border-top: 1px solid var(--t-color-border, #dfe3e8); padding-top: 10px; }
    #pd9-case .pd9-case-status { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px; }
    #pd9-case .pd9-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c9ced6; border-top-color: #1f2933; animation: pd9spin .8s linear infinite; }
    @keyframes pd9spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { #pd9-case .pd9-spin { animation-duration: 2.4s; } }
    #pd9-case .pd9-case-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    #pd9-case .pd9-case-list a { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 6px; color: inherit; text-decoration: none; }
    #pd9-case .pd9-case-list a:hover, #pd9-case .pd9-case-list a:focus-visible { background: var(--t-color-object-1-secondary, #eef2f7); outline: none; }
    #pd9-case .pd9-case-title { font-weight: 600; color: #2b7a78; }
    #pd9-case .pd9-case-details { font-size: 12px; opacity: .75; }
    #pd9-case .pd9-case-note { margin-top: 8px; font-size: 12px; opacity: .75; }
    #pd9-case .pd9-case-help { margin: 8px 0 12px; font-size: 12px; line-height: 1.4; opacity: .8; }
    #pd9-case-badge {
      position: fixed; z-index: 100000; pointer-events: none; padding: 3px 8px; border-radius: 4px;
      background: #e8590c; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    /* Advanced Name Search window */
    #pd9-adv.pd9-adv-enter { animation: pd9AdvIn .18s ease-out; }
    @keyframes pd9AdvIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    #pd9-adv .pd9-skel { display: block; height: 10px; border-radius: 4px; width: 70%; background: linear-gradient(90deg, #eceff3 25%, #f6f7f9 50%, #eceff3 75%); background-size: 200% 100%; animation: pd9Skel 1.2s linear infinite; }
    #pd9-adv .pd9-skel-row td { border-bottom-color: transparent; padding-top: 10px; padding-bottom: 10px; }
    @keyframes pd9Skel { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { #pd9-adv.pd9-adv-enter, #pd9-adv .pd9-skel { animation: none; } }

    #pd9-adv {
      position: fixed; right: 16px; bottom: 16px; z-index: 99990; width: min(860px, calc(100vw - 32px));
      max-height: calc(100vh - 16px); height: min(60vh, 560px); display: flex; flex-direction: column;
      resize: both; overflow: hidden; min-width: 560px; min-height: 320px; box-sizing: border-box;
      background: var(--t-color-surface, #fff); color: var(--t-color-text, #1f2933); font: inherit; font-size: 13px;
      border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3); border-top: 4px solid #2b7a78;
    }
    #pd9-adv.pd9-min { width: 280px !important; height: auto !important; min-width: 0; min-height: 0; resize: none; }
    #pd9-adv.pd9-min .pd9-adv-body { display: none; }
    #pd9-adv.pd9-min h3 { cursor: pointer; }
    #pd9-adv .pd9-adv-head { display: flex; align-items: center; gap: 4px; padding: 10px 12px; border-bottom: 1px solid var(--t-color-border, #dfe3e8); cursor: move; user-select: none; touch-action: none; }
    #pd9-adv.pd9-dragging { opacity: .92; }
    #pd9-adv h3 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
    #pd9-adv .pd9-adv-head button { border: 0; background: none; color: inherit; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; }
    #pd9-adv .pd9-adv-head button:hover { background: var(--t-color-object-1-secondary, #eef2f7); }
    #pd9-adv .pd9-adv-body { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 10px 12px 12px; gap: 8px; }
    #pd9-adv .pd9-adv-search { display: flex; gap: 8px; align-items: center; }
    #pd9-adv .pd9-adv-hidearch { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
    #pd9-adv .pd9-adv-hidearch input { flex: none; width: 16px; height: 16px; margin: 0; padding: 0; }

    #pd9-adv input {
      flex: 1; font: inherit; font-size: 14px; color: inherit; background: var(--t-color-surface, #fff);
      border: 1px solid var(--t-color-border, #c9ced6); border-radius: 4px; padding: 7px 9px;
    }
    #pd9-adv input:focus { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: -1px; }
    #pd9-adv .pd9-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 4px; cursor: pointer; border: 1px solid #1f2933; }
    #pd9-adv .pd9-primary { background: #1f2933; color: #fff; }
    #pd9-adv .pd9-adv-status { display: flex; align-items: center; gap: 6px; font-weight: 600; min-height: 18px; }
    #pd9-adv .pd9-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c9ced6; border-top-color: #1f2933; animation: pd9spin .8s linear infinite; }
    #pd9-adv .pd9-adv-table-wrap { overflow: auto; min-height: 0; flex: 1; }
    #pd9-adv table { border-collapse: collapse; width: 100%; }
    #pd9-adv th { position: sticky; top: 0; background: var(--t-color-surface, #fff); text-align: left; font-size: 12px; font-weight: 600; opacity: .8; padding: 6px 8px; border-bottom: 1px solid var(--t-color-border, #dfe3e8); white-space: nowrap; }
    #pd9-adv th button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
    #pd9-adv th button:hover { text-decoration: underline; }
    #pd9-adv th button:focus-visible { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: 2px; border-radius: 2px; }
    #pd9-adv th[aria-sort="ascending"], #pd9-adv th[aria-sort="descending"] { opacity: 1; }
    #pd9-adv td { padding: 6px 8px; border-bottom: 1px solid var(--t-color-border, #eef0f3); vertical-align: top; }
    #pd9-adv td:nth-child(2) { white-space: nowrap; }
    #pd9-adv td a { color: #2b7a78; font-weight: 600; text-decoration: none; }
    #pd9-adv td a:hover { text-decoration: underline; }
    #pd9-adv .pd9-closed { opacity: .7; }
    #pd9-adv .pd9-open { font-weight: 600; }
    .pd9-grow { flex: 1; }
    #pd9-adv .pd9-charges-btn, #pd9-hub-sorted .pd9-charges-btn {
      all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
      color: #2b7a78; font-weight: 600; font-size: 13px; text-decoration: underline; text-underline-offset: 3px;
    }
    #pd9-adv .pd9-charges-btn::after, #pd9-hub-sorted .pd9-charges-btn::after { content: "›"; font-size: 15px; line-height: 1; text-decoration: none; }
    #pd9-adv .pd9-charges-btn:hover, #pd9-hub-sorted .pd9-charges-btn:hover { background: var(--t-color-object-1-secondary, #eef2f7); }
    #pd9-adv .pd9-charges-btn:focus-visible, #pd9-hub-sorted .pd9-charges-btn:focus-visible { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: 1px; }
    .pd9-charges-modal { z-index: 100002 !important; }
    .pd9-charges-modal .pd9-charges-dialog { width: min(980px, 100%); }
    .pd9-charges-modal .pd9-charges-wrap { overflow: auto; max-height: 55vh; border: 1px solid var(--t-color-border, #dfe3e8); border-radius: 6px; }
    .pd9-charges-modal .pd9-charges-table { border-collapse: collapse; width: 100%; font-size: 13px; user-select: text; }
    .pd9-charges-modal .pd9-charges-table th { position: sticky; top: 0; background: var(--t-color-surface, #fff); text-align: left; font-size: 12px; font-weight: 600; padding: 7px 10px; border-bottom: 1px solid var(--t-color-border, #dfe3e8); white-space: nowrap; }
    .pd9-charges-modal .pd9-charges-table td { padding: 7px 10px; border-bottom: 1px solid var(--t-color-border, #eef0f3); vertical-align: top; }
    .pd9-charges-modal .pd9-charges-table tr:nth-child(even) td { background: rgba(0, 0, 0, .025); }
    .pd9-charges-modal .pd9-charges-note { margin: 0 0 8px; font-size: 12px; opacity: .75; }
    .pd9-charges-modal .pd9-adv-status { display: flex; align-items: center; gap: 8px; font-weight: 600; }
    .pd9-charges-modal .pd9-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c9ced6; border-top-color: #1f2933; animation: pd9spin .8s linear infinite; }

    .pd9-charges-modal .pd9-charges-case { margin: 0; font-size: 13px; opacity: .75; }
    .pd9-charges-modal .pd9-charges-list { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; user-select: text; }
    /* Movable, resizable note/task box */
    .pd9-movable { box-sizing: border-box; min-width: 380px; }
    .pd9-movable.pd9-placed {
      left: var(--pd9-cl) !important; top: var(--pd9-ct) !important; right: auto !important; bottom: auto !important;
      width: var(--pd9-cw) !important; height: var(--pd9-ch) !important; max-height: none !important; overflow: auto;
    }
    .pd9-composer-grip { display: none; }
    .pd9-movable > .pd9-composer-grip {
      display: block; position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; z-index: 2; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #c9ced6 50%, #c9ced6 58%, transparent 58%, transparent 70%, #c9ced6 70%, #c9ced6 78%, transparent 78%);
    }
    .pd9-movable .header { cursor: move; touch-action: none; }
    .pd9-movable .header button, .pd9-movable .header [role="button"] { cursor: pointer; }
    .pd9-movable .note-input-wrapper { max-height: none !important; }
    .pd9-movable.pd9-dragging { opacity: .92; user-select: none; }
    .pd9-overlay .pd9-hk { float: right; font-size: 11px; font-weight: 600; opacity: .6; }
    .pd9-overlay .pd9-tagwrap .pd9-hk-clear { flex: none; }
    /* PD9 (alternate) Project Hub table
       Palette: ink #1d2433, slate #667085, line #e9ecf1, header #f8f9fb, accent #1f7a77, soon #c2410c.
       Quiet rows; the one bold element is the Next Event date tile. */
    #pd9-hub-sorted {
      --ink: #1d2433; --slate: #667085; --line: #e9ecf1; --head: #f8f9fb; --accent: #1f7a77; --soon: #c2410c;
      position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column;
      background: #fff; color: var(--ink); font-family: var(--pd9-font, inherit); font-size: 14px;
      border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
      font-variant-numeric: tabular-nums;
    }
    #pd9-hub-sorted .pd9-hs-bar { position: relative; display: flex; align-items: center; flex-wrap: wrap; row-gap: 4px; padding: 7px 14px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--slate); }
    #pd9-hub-sorted .pd9-hs-track { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; }
    #pd9-hub-sorted .pd9-hs-progress { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s ease; }
    #pd9-hub-sorted .pd9-hs-progress[hidden] { display: none; }
    #pd9-hub-sorted .pd9-hs-wrap { flex: 1; overflow: auto; }
    #pd9-hub-sorted table { border-collapse: separate; border-spacing: 0; table-layout: fixed; min-width: 100%; }
    #pd9-hub-sorted th {
      position: sticky; top: 0; z-index: 1; height: 34px; padding: 0 14px; text-align: left; white-space: nowrap; overflow: hidden;
      background: var(--head); color: var(--slate); font-size: 12px; font-weight: 600; letter-spacing: .01em;
      border-bottom: 1px solid var(--line); cursor: grab;
    }
    #pd9-hub-sorted th.pd9-sorted { color: var(--ink); }
    #pd9-hub-sorted th button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; }
    #pd9-hub-sorted th button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
    #pd9-hub-sorted .pd9-sort-arrow { font-size: 11px; opacity: 0; transition: opacity .15s; }
    #pd9-hub-sorted th:hover .pd9-sort-arrow, #pd9-hub-sorted th.pd9-sorted .pd9-sort-arrow { opacity: 1; }
    #pd9-hub-sorted th.pd9-sorted .pd9-sort-arrow { color: var(--accent); }
    #pd9-hub-sorted .pd9-col-grip { position: absolute; top: 0; right: 0; width: 10px; height: 100%; cursor: col-resize; }
    #pd9-hub-sorted .pd9-col-grip::after { content: ""; position: absolute; top: 30%; bottom: 30%; right: 4px; width: 2px; border-radius: 1px; background: var(--line); transition: background .15s; }
    #pd9-hub-sorted th:hover .pd9-col-grip::after { background: #c9ced6; }
    #pd9-hub-sorted .pd9-col-grip:hover::after { background: var(--accent); }
    #pd9-hub-sorted th.pd9-dragging-col { opacity: .45; }
    #pd9-hub-sorted th.pd9-drop-target { box-shadow: inset 2px 0 0 var(--accent); }
    #pd9-hub-sorted td {
      height: 44px; padding: 0 14px; vertical-align: middle; border-bottom: 1px solid var(--line);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #pd9-hub-sorted tbody tr { transition: background .12s; }
    #pd9-hub-sorted tbody tr:nth-child(even) { background: #fafbfc; } /* subtle every-other-row shading */
    #pd9-hub-sorted tbody tr:hover { background: #eef6f6; }
    #pd9-hub-sorted tbody tr:hover td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
    #pd9-hub-sorted tbody tr:last-child td { border-bottom: 0; }
    #pd9-hub-sorted td a { color: var(--accent); font-weight: 600; text-decoration: none; }
    #pd9-hub-sorted td a:hover { text-decoration: underline; text-underline-offset: 3px; }
    #pd9-hub-sorted td a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
    #pd9-hub-sorted td[data-key="defendant"] { font-weight: 500; }
    #pd9-hub-sorted td[data-key="lastActivity"], #pd9-hub-sorted td[data-key="event"] { color: var(--slate); }
    #pd9-hub-sorted .pd9-own-pending { color: var(--slate); font-weight: 400; }
    /* The date tile */
    #pd9-hub-sorted .pd9-when { display: inline-flex; flex-direction: column; line-height: 1.15; padding-left: 8px; border-left: 3px solid var(--line); }
    #pd9-hub-sorted .pd9-when-day { font-weight: 600; color: var(--ink); }
    #pd9-hub-sorted .pd9-when-time { font-size: 11.5px; color: var(--slate); }
    #pd9-hub-sorted .pd9-when.pd9-soon { border-left-color: var(--soon); }
    #pd9-hub-sorted .pd9-when.pd9-soon .pd9-when-day { color: var(--soon); }
    #pd9-hub-sorted .pd9-none { font-size: 13px; color: #98a2b3; }
    #pd9-hub-sorted .pd9-skel-line { display: block; width: 70%; height: 10px; border-radius: 5px; background: linear-gradient(90deg, #eef0f3 25%, #f6f7f9 50%, #eef0f3 75%); background-size: 200% 100%; animation: pd9Skel 1.2s linear infinite; }
    /* Tags */
    #pd9-hub-sorted .pd9-own-tags { white-space: nowrap; line-height: 1.5; }
    #pd9-hub-sorted .pd9-tag {
      display: inline-block; margin: 0 4px 0 0; padding: 1px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600; line-height: 1.6;
      color: color-mix(in srgb, var(--pd9-tag, var(--accent)) 85%, #000);
      background: color-mix(in srgb, var(--pd9-tag, var(--accent)) 12%, #fff);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pd9-tag, var(--accent)) 22%, transparent);
    }
    /* Tag filter */
    #pd9-hub-sorted button.pd9-tag { border: 0; font-family: inherit; cursor: pointer; }
    #pd9-hub-sorted button.pd9-tag:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pd9-tag, var(--accent)) 55%, transparent); }
    #pd9-hub-sorted .pd9-tag.pd9-tag-on { color: #fff; background: color-mix(in srgb, var(--pd9-tag, var(--accent)) 88%, #000); box-shadow: none; }
    #pd9-hub-sorted button.pd9-tag:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    #pd9-hub-sorted .pd9-tag-funnel { all: unset; display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; padding: 2px 5px; border-radius: 5px; color: var(--slate); cursor: pointer; font-size: 11px; font-weight: 700; vertical-align: middle; }
    #pd9-hub-sorted .pd9-tag-funnel:hover { background: rgba(16, 24, 40, .06); color: var(--ink); }
    #pd9-hub-sorted .pd9-tag-funnel.pd9-funnel-on { color: var(--accent); background: #e3f1f0; }
    #pd9-hub-sorted .pd9-tag-funnel:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    #pd9-hub-sorted .pd9-hs-filters { display: inline-flex; align-items: center; gap: 6px; margin-left: 14px; flex-wrap: wrap; }
    #pd9-hub-sorted .pd9-hs-lead { color: var(--slate); }
    #pd9-hub-sorted .pd9-hs-chip { border: 0; padding: 2px 6px 2px 9px; border-radius: 6px; background: #e3f1f0; color: #155e5b; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    #pd9-hub-sorted .pd9-hs-chip::after { content: "✕"; margin-left: 6px; font-size: 10px; opacity: .6; }
    #pd9-hub-sorted .pd9-hs-chip:hover::after { opacity: 1; }
    #pd9-hub-sorted .pd9-hs-clear { border: 0; background: none; padding: 2px 4px; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    #pd9-hub-sorted .pd9-tag-menu {
      position: absolute; z-index: 5; width: 280px; max-height: 360px; display: flex; flex-direction: column; background: #fff; border-radius: 10px;
      box-shadow: 0 0 0 1px rgba(16, 24, 40, .1), 0 16px 36px -12px rgba(16, 24, 40, .35); font-size: 13px;
    }
    #pd9-hub-sorted .pd9-tm-head { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); }
    #pd9-hub-sorted .pd9-tm-find { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid #d0d5dd; border-radius: 6px; font: inherit; font-size: 13px; }
    #pd9-hub-sorted .pd9-tm-find:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    #pd9-hub-sorted .pd9-tm-mode { display: inline-flex; padding: 2px; background: #f2f4f7; border-radius: 7px; }
    #pd9-hub-sorted .pd9-tm-mode button { border: 0; padding: 3px 9px; border-radius: 5px; background: none; color: var(--slate); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    #pd9-hub-sorted .pd9-tm-mode button[aria-checked="true"] { background: #fff; color: var(--ink); box-shadow: 0 1px 2px rgba(16, 24, 40, .12); }
    #pd9-hub-sorted .pd9-tm-list { overflow: auto; padding: 4px; }
    #pd9-hub-sorted .pd9-tm-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: pointer; }
    #pd9-hub-sorted .pd9-tm-row:hover { background: #f5f9f9; }
    #pd9-hub-sorted .pd9-tm-row input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
    #pd9-hub-sorted .pd9-tm-count { margin-left: auto; color: var(--slate); font-size: 12px; }
    #pd9-hub-sorted .pd9-tm-empty { margin: 10px; color: var(--slate); }
    #pd9-hub-sorted .pd9-tm-foot { display: flex; justify-content: flex-end; padding: 6px 8px; border-top: 1px solid var(--line); }
    #pd9-hub-sorted .pd9-tm-clear { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    #pd9-hub-sorted .pd9-tm-notbtn { border: 1px solid #d0d5dd; background: #fff; color: #667085; border-radius: 6px; padding: 1px 7px; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
    #pd9-hub-sorted .pd9-tm-notbtn:hover { border-color: #b42318; color: #b42318; }
    #pd9-hub-sorted .pd9-tm-notbtn[aria-pressed="true"] { background: #b42318; border-color: #b42318; color: #fff; }
    #pd9-hub-sorted .pd9-tm-notbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    #pd9-hub-sorted .pd9-tag-not { text-decoration: line-through; opacity: .7; }
    #pd9-hub-sorted .pd9-tm-count { margin-left: auto; }
    #pd9-hub-sorted .pd9-hs-chip-not { background: #fee4e2; color: #b42318; text-decoration: line-through; text-decoration-thickness: 1px; }
    #pd9-hub-sorted .pd9-who { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; vertical-align: middle; }
    #pd9-hub-sorted .pd9-who-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #pd9-hub-sorted .pd9-av {
      flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; overflow: hidden;
      background: var(--pd9-av, #1f7a77); color: var(--t-color-object-text-light, #fff); font-size: 11px; font-weight: 700; letter-spacing: .02em;
    }
    #pd9-hub-sorted .pd9-av img { width: 100%; height: 100%; object-fit: cover; }
    #pd9-hub-sorted .pd9-own-pending .pd9-av { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { #pd9-hub-sorted *, #pd9-hub-sorted .pd9-skel-line { transition: none !important; animation: none !important; } }
    .pd9-hub-toggle-plain { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; font-weight: 600; cursor: pointer; user-select: none; }
    .pd9-hub-toggle-plain input { width: 16px; height: 16px; margin: 0; }
    #pd9-hub-sorted td a { color: #2b7a78; text-decoration: none; }
    #pd9-hub-sorted td a:hover { text-decoration: underline; }
    /* Project Hub: Next Event column */
    .ag-cell[col-id="pd9NextEvent"], .ag-cell[col-id="pd9NextTitle"] { display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Window mode: case windows and the bar at the bottom */
    .pd9-win {
      position: fixed; z-index: 100010; display: flex; flex-direction: column; min-width: 360px; min-height: 240px;
      background: #fff; border-radius: 10px; overflow: hidden;
      box-shadow: 0 0 0 1px rgba(16, 24, 40, .12), 0 18px 40px -12px rgba(16, 24, 40, .35);
    }
    .pd9-win.pd9-win-focus { box-shadow: 0 0 0 1px rgba(31, 122, 119, .55), 0 24px 52px -14px rgba(16, 24, 40, .45); }
    .pd9-win.pd9-win-min { display: none; }
    .pd9-win.pd9-win-spare { left: -20000px !important; top: 0 !important; visibility: hidden; pointer-events: none; }
    .pd9-win.pd9-win-max { left: 8px !important; top: 8px !important; right: 8px; bottom: 52px; width: auto !important; height: auto !important; }
    .pd9-win-head { display: flex; align-items: center; gap: 2px; height: 36px; padding: 0 6px 0 14px; background: #f8f9fb; border-bottom: 1px solid #e9ecf1; cursor: move; user-select: none; touch-action: none; }
    .pd9-win-focus .pd9-win-head { background: #eef6f6; }
    .pd9-win-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: #1d2433; }
    .pd9-win-btn { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none; color: #667085; cursor: pointer; }
    .pd9-win-btn:hover { background: rgba(16, 24, 40, .07); color: #1d2433; }
    .pd9-win-x:hover { background: #fee4e2; color: #b42318; }
    .pd9-win-btn:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    .pd9-win-body { position: relative; flex: 1; overflow: hidden; }
    .pd9-win-body iframe { position: absolute; left: 0; top: 0; width: calc(100% / var(--pd9-z, 1)); height: calc(100% / var(--pd9-z, 1)); border: 0; background: #fff; transform: scale(var(--pd9-z, 1)); transform-origin: 0 0; }
    .pd9-win-busy .pd9-win-body iframe { pointer-events: none; }
    .pd9-win-busy, .pd9-win-busy * { user-select: none !important; }
    .pd9-win-grip { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #c9ced6 50%, #c9ced6 58%, transparent 58%, transparent 70%, #c9ced6 70%, #c9ced6 78%, transparent 78%); }
    .pd9-win-max .pd9-win-grip { display: none; }
    #pd9-taskbar {
      position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 2147483000; display: flex; gap: 6px; padding: 6px;
      max-width: calc(100vw - 32px); overflow-x: auto; background: rgba(255, 255, 255, .92); backdrop-filter: blur(8px);
      border-radius: 12px; box-shadow: 0 0 0 1px rgba(16, 24, 40, .1), 0 10px 30px -10px rgba(16, 24, 40, .4);
    }
    #pd9-taskbar[hidden] { display: none; }
    .pd9-off-hub .pd9-win, .pd9-off-hub #pd9-taskbar { display: none !important; }
    .pd9-task-grip { flex: none; width: 10px; margin: 2px 0 2px 2px; border-radius: 4px; cursor: grab; touch-action: none;
      background: radial-gradient(circle, #98a2b3 1.2px, transparent 1.6px) 0 0 / 5px 5px; opacity: .7; }
    .pd9-task-grip:hover { opacity: 1; }
    #pd9-taskbar.pd9-task-dragging { cursor: grabbing; }
    #pd9-taskbar.pd9-task-dragging .pd9-task-grip { cursor: grabbing; }

    .pd9-task-home { flex: none; display: grid; place-items: center; width: 32px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #475467; cursor: pointer; }
    .pd9-task-home:hover { background: rgba(16, 24, 40, .07); color: #1d2433; }
    .pd9-task-sep { flex: none; width: 1px; margin: 4px 2px; background: #e4e7ec; }
    .pd9-task { flex: none; display: inline-flex; align-items: center; max-width: 260px; border-radius: 8px; color: #1d2433; }
    .pd9-task:hover { background: rgba(16, 24, 40, .06); }
    .pd9-task.pd9-task-active { background: #e3f1f0; color: #155e5b; box-shadow: inset 0 -2px 0 #1f7a77; }
    .pd9-task.pd9-task-min { color: #667085; }
    .pd9-task-name { min-width: 0; padding: 6px 4px 6px 12px; border: 0; background: none; color: inherit; font: inherit; font-size: 12.5px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .pd9-task-min .pd9-task-name { font-weight: 500; }
    .pd9-task-x { flex: none; display: grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; border: 0; border-radius: 6px;
      background: none; color: inherit; opacity: .45; cursor: pointer; }
    .pd9-task:hover .pd9-task-x { opacity: .8; }
    .pd9-task-x:hover { opacity: 1; background: #fee4e2; color: #b42318; }
    .pd9-task-home:focus-visible, .pd9-task-name:focus-visible, .pd9-task-x:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    /* Selecting cases in the PD9 table */
    #pd9-hub-sorted .pd9-pick { padding: 0 0 0 10px !important; text-align: left; cursor: default; white-space: nowrap; }
    #pd9-hub-sorted .pd9-pin-btn { all: unset; display: inline-grid; place-items: center; width: 22px; height: 22px; margin-left: 2px; border-radius: 6px; vertical-align: middle; color: #98a2b3; cursor: pointer; opacity: 0; }
    #pd9-hub-sorted tr:hover .pd9-pin-btn, #pd9-hub-sorted .pd9-pin-btn:focus-visible, #pd9-hub-sorted .pd9-pin-btn.pd9-pin-on { opacity: 1; }
    #pd9-hub-sorted .pd9-pin-btn:hover { background: rgba(16, 24, 40, .07); color: #1d2433; }
    #pd9-hub-sorted .pd9-pin-btn.pd9-pin-on { color: #1f7a77; }
    #pd9-hub-sorted .pd9-pin-btn:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    #pd9-hub-sorted tr.pd9-pinned-row td { background: #f3faf9; }
    #pd9-hub-sorted tr.pd9-pin-last td { box-shadow: inset 0 -2px 0 #cfe6e3; }
    #pd9-hub-sorted .pd9-pick input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); cursor: pointer; vertical-align: middle; }
    #pd9-hub-sorted tbody tr.pd9-picked { background: #e8f3f2 !important; }
    #pd9-hub-sorted .pd9-bulk-bar { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    #pd9-hub-sorted .pd9-bulk-count { color: var(--ink); font-weight: 600; }
    #pd9-hub-sorted .pd9-bulk-btn { border: 1px solid #d0d5dd; background: #fff; color: var(--ink); padding: 4px 12px; border-radius: 7px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    #pd9-hub-sorted .pd9-bulk-btn:hover { background: #f5f9f9; }
    #pd9-hub-sorted .pd9-bulk-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    #pd9-hub-sorted .pd9-bulk-primary:hover { background: #18625f; }
    #pd9-hub-sorted .pd9-bulk-link { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    /* The multi-case note/task box, styled after Filevine's own */
    .pd9-bulk-modal { z-index: 100003 !important; }
    .pd9-bulk-modal .pd9-bulk-dialog { width: min(640px, 100%); }
    .pd9-bc-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--t-color-border, #e4e7ec); }
    .pd9-bc-head h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
    .pd9-bc-types { display: inline-flex; gap: 2px; padding: 2px; background: var(--t-color-object-1-secondary, #f2f4f7); border-radius: 8px; }
    .pd9-bc-types button { display: grid; place-items: center; width: 34px; height: 30px; border: 0; border-radius: 6px; background: none; color: var(--t-color-text-secondary, #667085); cursor: pointer; }
    .pd9-bc-types button.pd9-on { background: var(--t-color-surface, #fff); color: #1f7a77; box-shadow: 0 1px 2px rgba(16, 24, 40, .14); }
    .pd9-bc-cases { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 16px 0; max-height: 84px; overflow: auto; }
    .pd9-bc-case { padding: 2px 8px; border-radius: 6px; background: #e8f3f2; color: #155e5b; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .pd9-bc-form { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 4px; }
    .pd9-bc-label { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 600; color: var(--t-color-text-secondary, #475467); }
    .pd9-bc-tpls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .pd9-bc-tpls .pd9-bc-label { display: inline; margin: 0 4px 0 0; }
    .pd9-bc-tpl { border: 1px solid #d0d5dd; background: #fff; border-radius: 999px; padding: 3px 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: #1d2433; cursor: pointer; }
    .pd9-bc-tpl:hover { border-color: #1f7a77; color: #1f7a77; }
    .pd9-bc-field { display: block; }
    .pd9-bc-field input[type=text], .pd9-bc-field input[type=date], .pd9-bc-field textarea {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; color: inherit; background: var(--t-color-surface, #fff);
      border: 1px solid var(--t-color-border, #d0d5dd); border-radius: 6px; padding: 8px 10px;
    }
    .pd9-bc-field textarea { resize: vertical; min-height: 140px; line-height: 1.45; }
    .pd9-bc-field input:focus, .pd9-bc-field textarea:focus { outline: 2px solid #1f7a77; outline-offset: -1px; }
    .pd9-bc-field input[type=date] { width: 200px; }
    .pd9-bc-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--t-color-border, #d0d5dd); border-radius: 6px; padding: 5px 6px; }
    .pd9-bc-tags input { flex: 1; min-width: 160px; border: 0 !important; padding: 3px 4px !important; outline: none !important; }
    .pd9-bc-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border-radius: 6px; background: #e8f3f2; color: #155e5b; font-size: 12.5px; font-weight: 600; }
    .pd9-bc-chip button { border: 0; background: none; color: inherit; opacity: .6; cursor: pointer; font-size: 11px; padding: 0 3px; }
    .pd9-bc-chip button:hover { opacity: 1; }
    .pd9-bc-task[hidden] { display: none; }
    .pd9-bc-note { margin: 6px 0 0; font-size: 12px; color: var(--t-color-text-secondary, #667085); }
    .pd9-bc-run { padding: 12px 16px; display: grid; grid-template-columns: 1fr 260px; gap: 14px; }
    .pd9-bc-run[hidden] { display: none; }
    .pd9-bc-list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; }
    .pd9-bc-item { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; padding: 7px 4px; border-bottom: 1px solid #eef0f3; font-size: 13px; }
    .pd9-bc-item a { color: #1f7a77; font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pd9-bc-msg { grid-column: 2; font-size: 12px; color: #667085; }
    .pd9-bc-state { grid-row: span 2; width: 14px; height: 14px; margin-top: 2px; border-radius: 50%; border: 2px solid #d0d5dd; box-sizing: border-box; }
    .pd9-busy .pd9-bc-state { border-color: #c9ced6; border-top-color: #1f7a77; animation: pd9spin .8s linear infinite; }
    .pd9-ok .pd9-bc-state { border: 0; background: #1f7a77; }
    .pd9-ok .pd9-bc-state::after { content: "✓"; display: block; color: #fff; font-size: 10px; line-height: 14px; text-align: center; }
    .pd9-bad .pd9-bc-state { border: 0; background: #b42318; }
    .pd9-bad .pd9-bc-msg { color: #b42318; }
    .pd9-skip .pd9-bc-msg { color: #98a2b3; }
    .pd9-bc-live[hidden] { display: none; }
    .pd9-bc-frame { position: relative; width: 260px; height: 190px; overflow: hidden; border-radius: 8px; box-shadow: 0 0 0 1px #e4e7ec; background: #f8f9fb; }
    .pd9-bc-frame iframe { position: absolute; left: 0; top: 0; width: 1040px; height: 760px; border: 0; transform: scale(.25); transform-origin: 0 0; pointer-events: none; }
    .pd9-bc-hint { font-size: 12px; color: #98a2b3; }
    @media (max-width: 640px) { .pd9-bc-run { grid-template-columns: 1fr; } }
    /* Case switcher (Spotlight style) */
    #pd9-switch {
      position: fixed; inset: 0; z-index: 2147483100; display: flex; justify-content: center; align-items: flex-start; padding-top: 16vh;
      background: rgba(16, 24, 40, .28); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); animation: pd9SwFade .12s ease-out;
    }
    @keyframes pd9SwFade { from { opacity: 0; } to { opacity: 1; } }
    #pd9-switch .pd9-sw-panel {
      width: min(680px, 92vw); max-height: 64vh; display: flex; flex-direction: column; overflow: hidden;
      background: rgba(255, 255, 255, .94); backdrop-filter: saturate(1.6) blur(24px); -webkit-backdrop-filter: saturate(1.6) blur(24px);
      border-radius: 16px; box-shadow: 0 0 0 1px rgba(16, 24, 40, .12), 0 30px 70px -20px rgba(16, 24, 40, .55);
      color: #1d2433; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
      animation: pd9SwPop .14s cubic-bezier(.2, .9, .3, 1.2);
    }
    @keyframes pd9SwPop { from { transform: scale(.97) translateY(-4px); opacity: 0; } to { transform: none; opacity: 1; } }
    #pd9-switch .pd9-sw-input { display: flex; align-items: center; gap: 12px; padding: 14px 18px; color: #667085; border-bottom: 1px solid rgba(16, 24, 40, .08); }
    #pd9-switch .pd9-sw-input input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 21px; color: #1d2433; }
    #pd9-switch .pd9-sw-input input::placeholder { color: #98a2b3; }
    #pd9-switch .pd9-sw-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #d0d5dd; border-top-color: #1f7a77; animation: pd9spin .8s linear infinite; }
    #pd9-switch .pd9-sw-spin[hidden] { display: none; }
    #pd9-switch .pd9-sw-list { overflow: auto; padding: 6px; }
    #pd9-switch .pd9-sw-group { padding: 8px 12px 4px; font-size: 11.5px; font-weight: 600; color: #667085; }
    #pd9-switch .pd9-sw-row { display: grid; grid-template-columns: 170px 1fr auto; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 9px; cursor: pointer; }
    #pd9-switch .pd9-sw-sel { background: #1f7a77; color: #fff; }
    #pd9-switch .pd9-sw-case { font-weight: 600; color: #1f7a77; white-space: nowrap; }
    #pd9-switch .pd9-sw-sel .pd9-sw-case { color: #fff; }
    #pd9-switch .pd9-sw-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14.5px; }
    #pd9-switch .pd9-sw-next { font-size: 12px; color: #667085; white-space: nowrap; }
    #pd9-switch .pd9-sw-sel .pd9-sw-next { color: rgba(255, 255, 255, .85); }
    #pd9-switch .pd9-sw-here .pd9-sw-next { font-weight: 600; }
    #pd9-switch .pd9-sw-empty { padding: 18px 14px; color: #667085; font-size: 14px; }
    #pd9-switch .pd9-sw-foot { display: flex; gap: 16px; padding: 8px 16px; border-top: 1px solid rgba(16, 24, 40, .08); font-size: 11.5px; color: #667085; }
    #pd9-switch kbd, .pd9-kbd { font: inherit; font-size: 11px; padding: 1px 5px; margin-right: 3px; border-radius: 4px; background: rgba(16, 24, 40, .07); box-shadow: inset 0 -1px 0 rgba(16, 24, 40, .15); }
    .pd9-head-btn .pd9-kbd { margin-left: 6px; background: rgba(255, 255, 255, .18); box-shadow: none; }
    @media (prefers-reduced-motion: reduce) { #pd9-switch, #pd9-switch .pd9-sw-panel { animation: none; } }
    /* Activity tab: show each note in full instead of cutting it off at 3 lines */
    .activity-text-body.lineClamp {
      -webkit-line-clamp: none !important; line-clamp: none !important;
      max-height: none !important; overflow: visible !important; display: block !important;
    }
    /* Filing Cabinet quick preview */
    .pd9-doc-eye { all: unset; display: inline-grid; place-items: center; width: 26px; height: 26px; margin-right: 4px; border-radius: 6px; color: #667085; cursor: pointer; opacity: 0; vertical-align: middle; }
    .ag-row:hover .pd9-doc-eye, .pd9-doc-eye:focus-visible, .pd9-doc-current .pd9-doc-eye { opacity: 1; }
    .pd9-doc-eye:hover { background: rgba(16, 24, 40, .08); color: #1d2433; }
    .pd9-doc-eye:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    .ag-row.pd9-doc-current { box-shadow: inset 3px 0 0 #1f7a77; background: #eef6f6 !important; }
    .pd9-doc-current .pd9-doc-eye { color: #1f7a77; }
    #pd9-docprev { position: fixed; top: 0; right: 0; bottom: 0; width: min(46vw, 900px); min-width: 360px; z-index: 99995; display: flex; flex-direction: column; background: #fff; box-shadow: -12px 0 40px -16px rgba(16, 24, 40, .45), -1px 0 0 rgba(16, 24, 40, .1); }
    #pd9-docprev .pd9-dp-edge { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 2; }
    #pd9-docprev.pd9-dp-resizing iframe { pointer-events: none; }
    #pd9-docprev iframe:not(.pd9-dp-on) { visibility: hidden; }
    #pd9-docprev .pd9-dp-head { display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 8px; border-bottom: 1px solid #e9ecf1; background: #f8f9fb; }
    #pd9-docprev .pd9-dp-title { flex: 1; min-width: 0; margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; color: #1d2433; }
    #pd9-docprev .pd9-dp-count { font-size: 12px; color: #667085; white-space: nowrap; margin-right: 4px; font-variant-numeric: tabular-nums; }
    #pd9-docprev .pd9-dp-btn { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; color: #475467; cursor: pointer; }
    #pd9-docprev .pd9-dp-btn:hover:not(:disabled) { background: rgba(16, 24, 40, .07); color: #1d2433; }
    #pd9-docprev .pd9-dp-btn:disabled { opacity: .35; cursor: default; }
    #pd9-docprev .pd9-dp-btn:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    #pd9-docprev .pd9-dp-x:hover { background: #fee4e2 !important; color: #b42318 !important; }
    #pd9-docprev .pd9-dp-body { position: relative; flex: 1; background: #eef0f3; }
    #pd9-docprev iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
    #pd9-docprev .pd9-dp-msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 24px; background: #fff; text-align: center; color: #475467; font-size: 14px; }
    #pd9-docprev .pd9-dp-msg[hidden] { display: none; }
    #pd9-docprev .pd9-dp-msg button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 0; background: #1f7a77; color: #fff; cursor: pointer; }
    /* Tag editor in the PD9 table */
    #pd9-hub-sorted .pd9-tag-add { all: unset; display: inline-grid; place-items: center; width: 22px; height: 22px; margin: 2px 0 2px 2px; border-radius: 6px; border: 1px dashed #c9ced6; color: #667085; font-size: 15px; line-height: 1; cursor: pointer; opacity: 0; vertical-align: middle; }
    #pd9-hub-sorted tr:hover .pd9-tag-add, #pd9-hub-sorted .pd9-tag-add:focus-visible { opacity: 1; }
    #pd9-hub-sorted .pd9-tag-add:hover { border-style: solid; border-color: #1f7a77; color: #1f7a77; background: #eef6f6; }
    #pd9-hub-sorted .pd9-tag-add:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    .pd9-tag-edit { position: fixed; z-index: 100005; width: 290px; padding: 10px; background: #fff; color: #1d2433; border-radius: 10px; box-shadow: 0 0 0 1px rgba(16, 24, 40, .1), 0 16px 40px -12px rgba(16, 24, 40, .4); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .pd9-tag-edit .pd9-te-title { font-weight: 600; margin: 0 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pd9-tag-edit .pd9-te-on { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
    .pd9-tag-edit .pd9-te-none { color: #98a2b3; font-size: 12px; margin-left: 2px; }
    .pd9-tag-edit .pd9-te-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--pd9-tag, #1f7a77); background: color-mix(in srgb, var(--pd9-tag, #1f7a77) 12%, #fff); }
    .pd9-tag-edit .pd9-te-chip:not(:has(button)) { padding-right: 8px; }
    .pd9-tag-edit .pd9-te-chip button { all: unset; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 13px; line-height: 1; cursor: pointer; }
    .pd9-tag-edit .pd9-te-chip button:hover { background: rgba(16, 24, 40, .12); }
    .pd9-tag-edit .pd9-te-find { width: 100%; box-sizing: border-box; padding: 7px 9px; font: inherit; border: 1px solid #d0d5dd; border-radius: 8px; }
    .pd9-tag-edit .pd9-te-find:focus { outline: 2px solid #1f7a77; outline-offset: -1px; }
    .pd9-tag-edit .pd9-te-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 210px; overflow: auto; }
    .pd9-tag-edit .pd9-te-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .pd9-tag-edit .pd9-te-list li.pd9-te-active, .pd9-tag-edit .pd9-te-list li[role="option"]:hover { background: #eef6f6; }
    .pd9-tag-edit .pd9-te-list li.pd9-te-empty { color: #98a2b3; cursor: default; }
    .pd9-tag-edit .pd9-te-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pd9-tag, #98a2b3); flex: none; }
    .pd9-tag-edit .pd9-te-note { min-height: 0; margin: 6px 2px 0; font-size: 12px; color: #667085; }
    .pd9-tag-edit .pd9-te-note:empty { display: none; }
    .pd9-tag-edit .pd9-te-bad { color: #b42318; }
    .pd9-tag-edit.pd9-te-busy .pd9-te-list, .pd9-tag-edit.pd9-te-busy .pd9-te-on { opacity: .5; pointer-events: none; }
    /* ---------- Dark mode ----------
       Palette: canvas #0d0f13, surface #15181d, raised #1b1f25, hover #222730,
       line #262b33, line strong #343a44, text #e6e8ec, muted #a3aab6, faint #737b88, teal #2fbfae. */
    :root.pd9-dark[style] {
      color-scheme: dark;
      --t-color-surface: #1b1f25; --t-color-text: #e6e8ec; --t-color-border: #343a44;
      --t-color-background-primary: #15181d; --t-color-background-content: #15181d; --t-color-background-page-title: #15181d;
      --t-color-background-secondary: #1b1f25; --t-color-background-alternate: #111317; --t-color-background-tertiary: #0d0f13;
      --t-color-background-header: #0d0f13; --t-color-background-logo-badge: #0d0f13;
      --t-color-background-text-input: #1b1f25; --t-color-background-select: #1b1f25; --t-color-background-datepicker: #1b1f25;
      --t-color-background-menu: #1b1f25; --t-color-background-menu-item-rest: #1b1f25; --t-color-background-menu-item-hover: #262b34;
      --t-color-background-dropdown-primary: #1b1f25; --t-color-background-dialog: #181b21; --t-color-background-drawer: #181b21; --t-color-background-drawer-elevated: #1d2128;
      --t-color-background-snackbar: #1d2128; --t-color-background-tooltip: #2a303a;
      --t-color-background-ag-grid: #15181d; --t-color-background-header-ag-grid: #191c22; --t-color-background-subheader-ag-grid: #15181d;
      --t-color-background-hover-row-ag-grid: #1d2229; --t-color-background-row-selected-ag-grid: #17302d;
      --t-color-background-control-panel-ag-grid: #191c22; --t-color-background-paging-panel-ag-grid: #191c22; --t-color-background-toolbar-subheader-ag-grid: #191c22;
      --t-color-background-cell-editor-focused-ag-grid: #1d2229;
      --t-color-background-tab-unselected: #15181d; --t-color-background-tab-hover: #1d2229;
      --t-color-background-secondary-nav-item-active: #17302d;
      --t-color-background-skeleton: #20252d; --t-color-background-skeleton-dark: #262c35;
      --t-color-background-dialog-skrim: rgb(0 0 0 / 55%); --t-color-background-dialog-skrim-blurred: rgb(13 15 19 / 70%);
      --t-color-background-control-active: #22a596; --t-color-background-control-active-hover: #2fbfae;
      --t-color-background-button-primary-rest: #1f9385; --t-color-background-button-primary-hover: #25a797; --t-color-background-button-primary-active: #1a7d72;
      --t-color-background-toggle-active: #22a596; --t-color-background-tab-selected: #2fbfae;
      --t-color-border-primary: #262b33; --t-color-border-secondary: #343a44; --t-color-border-tertiary: #4a5260;
      --t-color-border-ag-grid: #232830; --t-color-border-secondary-ag-grid: #232830; --t-color-border-drawer: #262b33; --t-color-border-page-title: #262b33;
      --t-color-border-text-input-unfocused: #343a44; --t-color-border-select-closed: #343a44; --t-color-border-text-input-focused: #2fbfae;
      --t-color-text-primary: #e6e8ec; --t-color-text-secondary: #a3aab6; --t-color-text-tertiary: #737b88; --t-color-text-disabled: #4f5663;
      --t-color-text-icon: #c3c9d3; --t-color-text-tab-unselected: #a3aab6; --t-color-text-tab-hover: #e6e8ec; --t-color-text-tab-selected: #4fd1c1;
      --t-color-text-link-rest: #4fd1c1; --t-color-text-link-visited: #4fd1c1; --t-color-text-link-hover: #7fe0d4; --t-color-text-link-active: #2fbfae;
      --t-color-text-brand: #4fd1c1; --t-color-text-secondary-nav-item-active: #4fd1c1;
      background: #0d0f13;
    }
    html.pd9-dark, html.pd9-dark body { background: #0d0f13 !important; color: #e6e8ec; }
    /* Scrollbars */
    html.pd9-dark * { scrollbar-color: #39404b transparent; }
    html.pd9-dark ::-webkit-scrollbar { width: 11px; height: 11px; }
    html.pd9-dark ::-webkit-scrollbar-thumb { background: #39404b; border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
    html.pd9-dark ::-webkit-scrollbar-thumb:hover { background-color: #4a5260; }
    html.pd9-dark ::-webkit-scrollbar-track { background: transparent; }
    html.pd9-dark ::selection { background: rgba(47, 191, 174, .35); }
    /* Older Filevine parts (forms, panels, lists) that don't use the theme colors */
    html.pd9-dark .form-control, html.pd9-dark input[type="text"], html.pd9-dark input[type="search"], html.pd9-dark input[type="email"], html.pd9-dark input[type="number"],
    html.pd9-dark input[type="tel"], html.pd9-dark input[type="date"], html.pd9-dark textarea, html.pd9-dark select {
      background-color: #1b1f25 !important; color: #e6e8ec !important; border-color: #343a44 !important;
    }
    html.pd9-dark .form-control:focus, html.pd9-dark textarea:focus, html.pd9-dark input:focus { border-color: #2fbfae !important; box-shadow: 0 0 0 3px rgba(47, 191, 174, .18) !important; }
    html.pd9-dark ::placeholder { color: #737b88 !important; }
    html.pd9-dark .panel, html.pd9-dark .well, html.pd9-dark .card, html.pd9-dark .modal-content, html.pd9-dark .popover, html.pd9-dark .dropdown-menu,
    html.pd9-dark .list-group-item, html.pd9-dark .uib-datepicker-popup, html.pd9-dark .panel-heading, html.pd9-dark .panel-body, html.pd9-dark .panel-footer {
      background-color: #181b21 !important; color: #e6e8ec !important; border-color: #262b33 !important;
    }
    html.pd9-dark .dropdown-menu > li > a, html.pd9-dark .dropdown-menu > li > button { color: #e6e8ec !important; }
    html.pd9-dark .dropdown-menu > li > a:hover, html.pd9-dark .dropdown-menu > .active > a, html.pd9-dark .dropdown-menu > li > a:focus { background-color: #262b34 !important; color: #fff !important; }
    html.pd9-dark .table > thead > tr > th, html.pd9-dark .table > tbody > tr > td, html.pd9-dark .table td, html.pd9-dark .table th { border-color: #262b33 !important; }
    html.pd9-dark .table-striped > tbody > tr:nth-of-type(odd) { background-color: #171a1f !important; }
    html.pd9-dark .table-hover > tbody > tr:hover { background-color: #1d2229 !important; }
    html.pd9-dark .btn-default { background-color: #1f242b !important; color: #e6e8ec !important; border-color: #343a44 !important; }
    html.pd9-dark .btn-default:hover { background-color: #262c35 !important; }
    html.pd9-dark hr { border-color: #262b33 !important; }
    html.pd9-dark .text-muted, html.pd9-dark .help-block { color: #8b93a0 !important; }
    html.pd9-dark .bg-white, html.pd9-dark .bg-light { background-color: #15181d !important; }
    html.pd9-dark .modal-backdrop.in { opacity: .6 !important; }
    html.pd9-dark img:not([src*=".svg"]) { filter: brightness(.92); }
    /* The Improver's own windows and tables */
    html.pd9-dark #pd9-hub-sorted { --ink: #e6e8ec; --slate: #a3aab6; --line: #232830; --head: #191c22; --accent: #2fbfae; --soon: #ff8a4c; background: #15181d; }
    html.pd9-dark #pd9-hub-sorted tbody tr:nth-child(even) { background: #171a20; }
    html.pd9-dark #pd9-hub-sorted tbody tr:hover { background: #1c2128; }
    html.pd9-dark #pd9-hub-sorted tbody tr.pd9-picked { background: #17302d !important; }
    html.pd9-dark .pd9-charges-modal .pd9-charges-table tr:nth-child(even) td { background: rgba(255, 255, 255, .03); }
    html.pd9-dark #pd9-hub-sorted tr.pd9-pinned-row td { background: #14211f; }
    html.pd9-dark #pd9-hub-sorted tr.pd9-pin-last td { box-shadow: inset 0 -2px 0 #1f3a36; }
    html.pd9-dark #pd9-hub-sorted .pd9-tag { background: color-mix(in srgb, var(--pd9-tag, var(--accent)) 18%, #15181d); color: color-mix(in srgb, var(--pd9-tag, var(--accent)) 70%, #fff); }
    html.pd9-dark #pd9-hub-sorted .pd9-bulk-btn, html.pd9-dark #pd9-hub-sorted .pd9-tm-notbtn { background: #1f242b; border-color: #343a44; color: #e6e8ec; }
    html.pd9-dark #pd9-hub-sorted .pd9-bulk-primary { background: #1f9385; border-color: #1f9385; color: #fff; }
    html.pd9-dark #pd9-hub-sorted .pd9-tag-menu, html.pd9-dark .pd9-tag-edit { background: #1b1f25; color: #e6e8ec; box-shadow: 0 0 0 1px #2c323c, 0 18px 40px -12px rgba(0, 0, 0, .7); }
    html.pd9-dark #pd9-hub-sorted .pd9-tm-mode button[aria-checked="true"] { background: #2a303a; color: #e6e8ec; }
    html.pd9-dark #pd9-hub-sorted .pd9-tag-add:hover { background: #17302d; }
    html.pd9-dark .pd9-tag-edit .pd9-te-find { background: #15181d; color: #e6e8ec; border-color: #343a44; }
    html.pd9-dark .pd9-tag-edit .pd9-te-list li.pd9-te-active, html.pd9-dark .pd9-tag-edit .pd9-te-list li[role="option"]:hover { background: #17302d; }
    html.pd9-dark .pd9-tag-edit .pd9-te-chip { background: color-mix(in srgb, var(--pd9-tag, #2fbfae) 18%, #1b1f25); color: color-mix(in srgb, var(--pd9-tag, #2fbfae) 70%, #fff); }
    html.pd9-dark .pd9-overlay .pd9-primary, html.pd9-dark .pd9-panel .pd9-primary, html.pd9-dark #pd9-case .pd9-primary, html.pd9-dark #pd9-adv .pd9-primary { background: #1f9385; border-color: #1f9385; }
    html.pd9-dark .pd9-overlay .pd9-dialog, html.pd9-dark #pd9-case, html.pd9-dark #pd9-adv, html.pd9-dark .pd9-panel { box-shadow: 0 0 0 1px #2c323c, 0 24px 60px -20px rgba(0, 0, 0, .8); }
    html.pd9-dark .pd9-zoomopt select { background: #1b1f25; color: #e6e8ec; border-color: #343a44; }
    html.pd9-dark .pd9-win { background: #15181d; box-shadow: 0 0 0 1px #2c323c, 0 24px 60px -20px rgba(0, 0, 0, .8); }
    html.pd9-dark .pd9-win-head { background: #191c22; border-bottom-color: #262b33; }
    html.pd9-dark .pd9-win-focus .pd9-win-head { background: #17302d; }
    html.pd9-dark .pd9-win-title { color: #e6e8ec; }
    html.pd9-dark .pd9-win-btn { color: #a3aab6; }
    html.pd9-dark .pd9-win-btn:hover { background: rgba(255, 255, 255, .08); color: #fff; }
    html.pd9-dark .pd9-win-body iframe { background: #15181d; }
    html.pd9-dark #pd9-taskbar { background: rgba(21, 24, 29, .88); box-shadow: 0 0 0 1px #2c323c, 0 12px 30px -10px rgba(0, 0, 0, .7); }
    html.pd9-dark .pd9-task { color: #e6e8ec; }
    html.pd9-dark #pd9-switch .pd9-sw-panel { background: rgba(24, 27, 33, .94); color: #e6e8ec; box-shadow: 0 0 0 1px #2c323c, 0 30px 80px -20px rgba(0, 0, 0, .85); }
    html.pd9-dark #pd9-switch .pd9-sw-sel { background: #1f9385; }
    html.pd9-dark #pd9-switch kbd, html.pd9-dark .pd9-kbd { background: rgba(255, 255, 255, .08); box-shadow: inset 0 -1px 0 rgba(255, 255, 255, .12); }
    html.pd9-dark #pd9-docprev { background: #15181d; box-shadow: -12px 0 40px -16px rgba(0, 0, 0, .8), -1px 0 0 #262b33; }
    html.pd9-dark #pd9-docprev .pd9-dp-head { background: #191c22; border-bottom-color: #262b33; }
    html.pd9-dark #pd9-docprev .pd9-dp-title { color: #e6e8ec; }
    html.pd9-dark #pd9-docprev .pd9-dp-btn { color: #a3aab6; }
    html.pd9-dark #pd9-docprev .pd9-dp-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .08); color: #fff; }
    html.pd9-dark #pd9-docprev .pd9-dp-body { background: #0d0f13; }
    html.pd9-dark #pd9-docprev .pd9-dp-msg { background: #15181d; color: #a3aab6; }
    html.pd9-dark .ag-row.pd9-doc-current { background: #17302d !important; box-shadow: inset 3px 0 0 #2fbfae; }
    html.pd9-dark .pd9-doc-eye { color: #a3aab6; }
    html.pd9-dark .pd9-doc-eye:hover { background: rgba(255, 255, 255, .08); color: #fff; }
    html.pd9-dark .pd9-bc-tpl, html.pd9-dark .pd9-bc-types button.pd9-on { background: #1f242b; color: #4fd1c1; border-color: #343a44; }
    html.pd9-dark .pd9-bc-frame { background: #111317; box-shadow: 0 0 0 1px #262b33; }
    html.pd9-dark #pd9-adv .pd9-charges-btn, html.pd9-dark #pd9-hub-sorted .pd9-charges-btn { color: #4fd1c1; }
    html.pd9-dark #pd9-adv .pd9-charges-btn:hover, html.pd9-dark #pd9-hub-sorted .pd9-charges-btn:hover { background: #17302d; }
    html.pd9-dark .fvqn-toast { background: #2a303a; box-shadow: 0 8px 24px -8px rgba(0, 0, 0, .7); }
    /* Task triage (staff edition) */
    #pd9-triage { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin: 4px 0 10px; padding: 10px 14px; border-radius: 10px;
      background: var(--t-color-background-secondary, #f6f7f9); border: 1px solid var(--t-color-border-primary, #e4e7ec); font-size: 13px; color: var(--t-color-text-primary, #1d2433); }
    #pd9-triage button { font: inherit; cursor: pointer; color: inherit; }
    .pd9-tri-group { display: flex; align-items: center; gap: 8px; }
    .pd9-tri-label { color: var(--t-color-text-secondary, #667085); font-weight: 600; }
    .pd9-tri-seg { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(16, 24, 40, .06); }
    .pd9-tri-seg button { border: 0; background: none; padding: 5px 12px; border-radius: 6px; font-weight: 500; }
    .pd9-tri-seg button[aria-pressed="true"] { background: var(--t-color-background-primary, #fff); font-weight: 600; box-shadow: 0 1px 2px rgba(16, 24, 40, .15); }
    .pd9-tri-dyn { display: contents; }
    .pd9-tri-find { display: flex; align-items: center; gap: 8px; }
    .pd9-tri-find input { width: 200px; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--t-color-border-secondary, #d0d5dd); background: var(--t-color-background-primary, #fff); color: inherit; font: inherit; }
    .pd9-tri-find input:focus { outline: none; border-color: #1f7a77; box-shadow: 0 0 0 3px rgba(31,122,119,.18); }
    .pd9-tri-none { font-size: 12px; color: #b42318; white-space: nowrap; }
    html.pd9-dark .pd9-tri-find input { background: #1b1f24; border-color: #3a414b; }
    html.pd9-dark .pd9-tri-none { color: #f97066; }
    .pd9-tri-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pd9-tri-chips button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--t-color-border-secondary, #d0d5dd); background: var(--t-color-background-primary, #fff); }
    .pd9-tri-chips button[aria-pressed="true"] { border-color: #1f7a77; background: #e7f3f2; color: #155e5b; font-weight: 600; }
    .pd9-tri-n { color: var(--t-color-text-secondary, #667085); font-variant-numeric: tabular-nums; font-weight: 500; }
    .pd9-tri-grow { flex: 1; }
    .pd9-tri-select, .pd9-tri-bulk button { border: 1px solid var(--t-color-border-secondary, #d0d5dd); background: var(--t-color-background-primary, #fff); padding: 5px 12px; border-radius: 8px; font-weight: 600; }
    .pd9-tri-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .pd9-tri-count { margin: 0 4px; font-weight: 600; color: #155e5b; }
    .pd9-tri-flagbtn { display: inline-flex; align-items: center; gap: 6px; }
    #pd9-triage .pd9-tri-done { background: #1f7a77; border-color: #1f7a77; color: #fff; }
    #pd9-triage button:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    .pd9-fdot { width: 10px; height: 10px; border-radius: 50%; background: #c4c9d2; flex: none; display: inline-block; }
    .pd9-f-red { background: #d92d20; } .pd9-f-yellow { background: #eaaa08; } .pd9-f-green { background: #16a34a; }

    ul.activity-group-list.pd9-tri-sorted { display: flex !important; flex-direction: column; }
    li.activity-list-item.pd9-tri-hide { display: none !important; }
    li.activity-list-item[data-pd9-flag="red"] .activity-item-component { box-shadow: inset 4px 0 0 #d92d20; }
    li.activity-list-item[data-pd9-flag="yellow"] .activity-item-component { box-shadow: inset 4px 0 0 #eaaa08; }
    li.activity-list-item[data-pd9-flag="green"] .activity-item-component { box-shadow: inset 4px 0 0 #16a34a; }
    .pd9-flag-btn { display: grid; place-items: center; width: 34px; height: 34px; margin: 8px auto 0; padding: 0; border: 1px solid transparent; border-radius: 8px; background: none; color: #b0b6c1; cursor: pointer; }
    .pd9-flag-btn:hover { background: rgba(16, 24, 40, .06); color: #667085; }
    .pd9-flag-btn:focus-visible { outline: 2px solid #1f7a77; outline-offset: 1px; }
    .pd9-flag-btn[data-flag="red"] { color: #d92d20; } .pd9-flag-btn[data-flag="yellow"] { color: #ca8a04; } .pd9-flag-btn[data-flag="green"] { color: #16a34a; }
    .pd9-tri-pick { display: none; width: 18px; height: 18px; margin: 0 auto 8px; accent-color: #1f7a77; cursor: pointer; }
    html.pd9-tri-selecting .pd9-tri-pick { display: block; }
    .pd9-flag-menu { position: fixed; z-index: 100006; min-width: 220px; padding: 6px; border-radius: 10px; background: var(--t-color-background-menu, #fff); color: var(--t-color-text-primary, #1d2433);
      box-shadow: 0 0 0 1px rgba(16, 24, 40, .1), 0 16px 40px -12px rgba(16, 24, 40, .4); font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .pd9-flag-menu button { display: grid; grid-template-columns: 14px auto 1fr auto; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
    .pd9-flag-menu button:hover, .pd9-flag-menu button:focus-visible { background: rgba(16, 24, 40, .06); outline: none; }
    .pd9-flag-menu button span:not(.pd9-fdot) { color: var(--t-color-text-secondary, #667085); }
    html.pd9-dark #pd9-triage { background: #191c22; border-color: #262b33; }
    html.pd9-dark .pd9-tri-seg { background: rgba(255, 255, 255, .06); }
    html.pd9-dark .pd9-tri-chips button[aria-pressed="true"] { background: #17302d; color: #7fe0d4; border-color: #2fbfae; }
    html.pd9-dark .pd9-tri-count { color: #7fe0d4; }
    /* ---------- Deposition recorder ---------- */
    #pd9-depo { position: fixed; left: 20px; bottom: 20px; z-index: 2147483000; width: 380px; max-width: calc(100vw - 40px); background: #14171c; color: #e6e9ee; border: 1px solid #2a3039; border-radius: 14px; box-shadow: 0 18px 48px -12px rgba(0,0,0,.55); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
    #pd9-depo button { font: inherit; cursor: pointer; }
    #pd9-depo [hidden] { display: none !important; }
    .pd9-depo-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid #232831; }
    .pd9-depo-title { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
    .pd9-depo-grow { flex: 1; }
    .pd9-depo-dot { width: 9px; height: 9px; border-radius: 50%; background: #4b5563; flex: none; }
    #pd9-depo[data-state=recording] .pd9-depo-dot { background: #f04438; box-shadow: 0 0 0 0 rgba(240,68,56,.6); animation: pd9-depo-pulse 1.6s infinite; }
    #pd9-depo[data-state=paused] .pd9-depo-dot { background: #fdb022; }
    #pd9-depo[data-state=saved] .pd9-depo-dot { background: #32d583; }
    #pd9-depo.pd9-depo-quiet .pd9-depo-dot { background: #fdb022; animation: none; }
    @keyframes pd9-depo-pulse { 0% { box-shadow: 0 0 0 0 rgba(240,68,56,.55); } 70% { box-shadow: 0 0 0 8px rgba(240,68,56,0); } 100% { box-shadow: 0 0 0 0 rgba(240,68,56,0); } }
    .pd9-depo-icon { width: 26px; height: 26px; border-radius: 7px; border: 0; background: transparent; color: #9aa4b2; font-size: 16px; line-height: 1; }
    .pd9-depo-icon:hover { background: #222831; color: #fff; }
    .pd9-depo-mini-meter, .pd9-depo-mini-time { display: none; }
    .pd9-depo-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    .pd9-depo-field { display: flex; flex-direction: column; gap: 4px; }
    .pd9-depo-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8b95a3; }
    .pd9-depo-field input, .pd9-depo-field select { height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #2f3742; background: #0e1014; color: #e6e9ee; font: inherit; min-width: 0; }
    .pd9-depo-field input:focus, .pd9-depo-field select:focus { outline: none; border-color: #2fbfae; box-shadow: 0 0 0 3px rgba(47,191,174,.2); }
    .pd9-depo-field select:disabled { opacity: .6; }
    .pd9-depo-saveas { font-size: 11.5px; color: #8b95a3; margin-top: -4px; overflow-wrap: anywhere; }
    .pd9-depo-file { color: #c8ced8; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
    .pd9-depo-wave { display: block; width: 100%; height: 64px; background: #0e1014; border-radius: 8px; }
    .pd9-depo-meter { position: relative; height: 8px; border-radius: 4px; background: #232831; }
    .pd9-depo-fill { position: absolute; inset: 0 auto 0 0; width: 0; overflow: hidden; border-radius: 4px; transition: width 60ms linear; }
    .pd9-depo-grad { width: 352px; max-width: none; height: 100%; background: linear-gradient(90deg, #32d583 0%, #32d583 70%, #fdb022 82%, #f04438 95%); }
    .pd9-depo-peak { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: #e6e9ee; border-radius: 1px; opacity: .8; }
    .pd9-depo-status { display: flex; align-items: center; gap: 12px; min-height: 30px; }
    .pd9-depo-big { font: 600 22px/1 ui-monospace, Consolas, monospace; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
    .pd9-depo-msg { font-size: 12px; color: #9aa4b2; }
    .pd9-depo-msg[data-kind=rec] { color: #fda29b; }
    .pd9-depo-msg[data-kind=warn] { color: #fec84b; }
    .pd9-depo-msg[data-kind=bad] { color: #f97066; }
    .pd9-depo-msg[data-kind=ok] { color: #6ce9a6; }
    .pd9-depo-btns { display: flex; flex-wrap: wrap; gap: 8px; }
    .pd9-depo-btns button { height: 34px; padding: 0 14px; border-radius: 9px; border: 1px solid #2f3742; background: #1d2229; color: #e6e9ee; }
    .pd9-depo-btns button:hover { background: #262c35; }
    .pd9-depo-btns .pd9-depo-rec { display: inline-flex; align-items: center; gap: 8px; background: #d92d20; border-color: #d92d20; color: #fff; font-weight: 600; }
    .pd9-depo-btns .pd9-depo-rec:hover { background: #b42318; }
    .pd9-depo-recdot { width: 9px; height: 9px; border-radius: 50%; background: #fff; }
    .pd9-depo-btns .pd9-depo-stop { background: #e6e9ee; border-color: #e6e9ee; color: #14171c; font-weight: 600; }
    .pd9-depo-btns .pd9-depo-stop:hover { background: #fff; }
    .pd9-depo-recover { padding: 10px 12px; border-radius: 10px; background: #2a1f0c; border: 1px solid #5c4413; color: #fde7b0; display: flex; flex-direction: column; gap: 6px; }
    .pd9-depo-recover[hidden] { display: none; }
    #pd9-depo.pd9-depo-mini { width: auto; }
    #pd9-depo.pd9-depo-mini .pd9-depo-body { display: none; }
    #pd9-depo.pd9-depo-mini .pd9-depo-head { border-bottom: 0; cursor: pointer; }
    #pd9-depo.pd9-depo-mini .pd9-depo-title { display: none; }
    #pd9-depo.pd9-depo-mini .pd9-depo-mini-meter { display: block; position: relative; width: 70px; height: 6px; border-radius: 3px; background: #232831; overflow: hidden; }
    #pd9-depo.pd9-depo-mini .pd9-depo-mini-fill { position: absolute; inset: 0 auto 0 0; background: #32d583; border-radius: 3px; }
    #pd9-depo.pd9-depo-mini .pd9-depo-mini-time { display: inline; font: 600 13px ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
    /* ---------- Activity feed search ---------- */
    #pd9-feedfind { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
    .pd9-ff-field { position: relative; display: inline-flex; align-items: center; color: #667085; }
    #pd9-feedfind.pd9-ff-inline { display: inline-flex; flex-wrap: nowrap; margin: 0 0 0 10px; vertical-align: middle; }
    #pd9-feedfind.pd9-ff-inline .pd9-ff-field input { width: 260px; max-width: 30vw; }
    #pd9-feedfind.pd9-ff-inline .pd9-ff-count { white-space: nowrap; }
    .pd9-ff-field svg { position: absolute; left: 10px; pointer-events: none; }
    .pd9-ff-field input { width: 320px; max-width: 60vw; height: 32px; padding: 0 30px 0 32px; border-radius: 8px; border: 1px solid var(--t-color-border-secondary, #d0d5dd);
      background: var(--t-color-background-primary, #fff); color: var(--t-color-text-primary, #1d2433); font: inherit; font-size: 13px; }
    .pd9-ff-field input::-webkit-search-cancel-button { display: none; }
    .pd9-ff-field input:focus { outline: none; border-color: #1f7a77; box-shadow: 0 0 0 3px rgba(31,122,119,.18); }
    .pd9-ff-clear { position: absolute; right: 4px; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: #667085; font-size: 16px; line-height: 1; cursor: pointer; }
    .pd9-ff-clear:hover { background: rgba(16,24,40,.07); color: #1d2433; }
    .pd9-ff-count { font-size: 12px; color: #667085; }
    .pd9-ff-count[data-none="true"] { color: #b42318; }
    .pd9-ff-more { height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--t-color-border-secondary, #d0d5dd); background: var(--t-color-background-primary, #fff); color: #1f7a77; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .pd9-ff-more:hover { background: #e7f3f2; }
    li.activity-list-item.pd9-ff-hide, .activity-item-group.pd9-ff-hide-group { display: none !important; }
    ::highlight(pd9-ff) { background-color: #fde68a; color: #1d2433; }
    html.pd9-dark .pd9-ff-field input { background: #1b1f24; border-color: #3a414b; color: #e6e9ee; }
    html.pd9-dark .pd9-ff-more { background: #1b1f24; border-color: #3a414b; color: #5fd4c4; }
    html.pd9-dark .pd9-ff-more:hover { background: #17302d; }
    html.pd9-dark .pd9-ff-count[data-none="true"] { color: #f97066; }
    html.pd9-dark ::highlight(pd9-ff) { background-color: #8a6d12; color: #fff; }
    /* ---------- Intake / Request helper buttons ---------- */
    .pd9-field-btn { margin-left: 8px; padding: 1px 8px; height: 22px; border-radius: 6px; border: 1px solid var(--t-color-border, #c9ced6); background: var(--t-color-background-primary, #fff); color: #1f7a77; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; align-self: center; white-space: nowrap; }
    .pd9-field-btn:hover { background: #e7f3f2; border-color: #1f7a77; }
    html.pd9-dark .pd9-field-btn { background: #1b1f24; border-color: #3a414b; color: #5fd4c4; }
    html.pd9-dark .pd9-field-btn:hover { background: #17302d; }
    /* ---------- What's new card ---------- */
    #pd9-whatsnew { position: fixed; left: 20px; bottom: 20px; z-index: 2147483001; width: 340px; max-width: calc(100vw - 40px); padding: 12px 14px 10px; border-radius: 12px;
      background: #fff; color: #1d2433; border: 1px solid #e4e7ec; box-shadow: 0 12px 32px -12px rgba(16,24,40,.28); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      animation: pd9-wn-in .22s ease-out; }
    #pd9-whatsnew.pd9-wn-out { opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
    @keyframes pd9-wn-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .pd9-wn-head { display: flex; align-items: center; gap: 8px; }
    .pd9-wn-head b { font-size: 13px; }
    .pd9-wn-ver { font-size: 11px; color: #667085; }
    .pd9-wn-x { margin-left: auto; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: #667085; font-size: 16px; line-height: 1; cursor: pointer; }
    .pd9-wn-x:hover { background: #f2f4f7; color: #1d2433; }
    #pd9-whatsnew ul { margin: 8px 0 0; padding-left: 18px; }
    #pd9-whatsnew li { margin: 0 0 5px; }
    .pd9-wn-foot { display: flex; justify-content: flex-end; margin-top: 4px; }
    .pd9-wn-ok { height: 28px; padding: 0 12px; border-radius: 7px; border: 1px solid #1f7a77; background: #1f7a77; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .pd9-wn-ok:hover { background: #155e5b; }
    html.pd9-dark #pd9-whatsnew { background: #1b1f24; color: #e6e9ee; border-color: #2f3742; box-shadow: 0 12px 32px -12px rgba(0,0,0,.7); }
    html.pd9-dark .pd9-wn-ver, html.pd9-dark .pd9-wn-x { color: #8b95a3; }
    html.pd9-dark .pd9-wn-x:hover { background: #262c35; color: #fff; }
    .pd9-ver { margin-left: 4px; font-size: .85em; font-weight: 400; opacity: .5; }
    .fvqn-toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #1f2933; color: #fff; padding: 8px 14px; border-radius: 6px;
      font-size: 13px; z-index: 100001;
    }
  `;
  document.head.appendChild(style);

  // Filevine is a single-page app, so keep watching for composers to appear.
  // Changes inside the script's own windows (search panels, tables, toasts) don't
  // need a recheck. Everything else is batched: at most one recheck every 120ms.
  const OWN_UI = '#pd9-adv, #pd9-case, #pd9-docprev, .pd9-overlay, .pd9-panel, .fvqn-toast, #pd9-case-badge, #pd9-hub-sorted';
  const isOwn = (node) => { const el = node && (node.nodeType === 1 ? node : node.parentElement); return !!(el && el.closest && el.closest(OWN_UI)); };
  let pending = false;
  let lastRun = 0;
  const runDecorate = () => { pending = false; lastRun = Date.now(); decorate(); };
  new MutationObserver((records) => {
    if (pending || records.every((r) => isOwn(r.target))) return;
    pending = true;
    const wait = Math.max(0, 120 - (Date.now() - lastRun));
    if (wait) setTimeout(() => requestAnimationFrame(runDecorate), wait); else requestAnimationFrame(runDecorate);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  pruneDrafts();

  // Print the version to the console. Filevine mutes console.log on its page,
  // so borrow a clean console from a hidden blank frame.
  if (!IN_FRAME) (function printVersion() {
    const version = typeof GM_info !== 'undefined' ? GM_info.script.version : '?';
    let out = console;
    try {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');
      document.documentElement.appendChild(frame);
      if (frame.contentWindow && frame.contentWindow.console) out = frame.contentWindow.console;
    } catch (e) { /* fall back to the page console */ }
    out.info(`%cPD9 Filevine Improver v${version} loaded`, 'color:#2563eb;font-weight:bold');
  })();

  window.addEventListener('hashchange', decorate);
  window.addEventListener('popstate', decorate);
  decorate();
})();
