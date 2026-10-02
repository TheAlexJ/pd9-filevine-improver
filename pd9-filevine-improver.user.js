// ==UserScript==
// @name         PD9 Filevine Improver
// @namespace    https://filevine.local/pd9-improver
// @version      3.17.0
// @description  Faster notes, tasks, and case closing in Filevine for PD9.
// @match        https://*.filevine.com/*
// @match        https://*.filevineapp.com/*
// @match        https://*.filevinegov.com/*
// @homepageURL  https://github.com/TheAlexJ/pd9-filevine-improver
// @supportURL   https://github.com/TheAlexJ/pd9-filevine-improver/issues
// @updateURL    https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-improver.user.js
// @downloadURL  https://raw.githubusercontent.com/TheAlexJ/pd9-filevine-improver/main/pd9-filevine-improver.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

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
  const DEFAULT_TEMPLATES = [
    {
      label: 'Contact', subject: 'Contact', tag: 'CONTACT',
      body: [
        'Date of contact: {date}',
        'Contact type: {|}',
        'Contact with: ',
        'Discussed: ',
        'Follow-up: ',
      ].join('\n'),
    },
    {
      label: 'File Review', subject: 'File Review', tag: 'FILEREVIEW',
      body: [
        'Charge: {|}',
        'Summary: ',
        'Pending Cases: ',
        'Jail: ',
        'Conflict: ',
        'Theory of Defense: ',
        'Motions: ',
        'Experts: ',
      ].join('\n'),
    },
    {
      label: 'Conflict', subject: 'Conflict', tag: 'CONFLICT',
      body: [
        '(1) Nature of conflict: {|}',
        '(2) Open cases: ',
        '(3) Prior representation: ',
        '(4) If co-d, who is more culpable: ',
        '(5) If co-d, are either incarcerated: ',
        '(6) Recommendation for conflict and why? ',
      ].join('\n'),
    },
  ];

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
  const cleanTag = (t) => (t || '').trim().replace(/^#+/, '').replace(/\s+/g, '');

  function loadTemplates() {
    const saved = store.get(TEMPLATES_KEY, null);
    const list = Array.isArray(saved) && saved.length ? saved : DEFAULT_TEMPLATES;
    return list.map((t) => ({ id: t.id || newId(), label: t.label || 'Untitled', subject: t.subject || '', tag: cleanTag(t.tag), body: t.body || '' }));
  }
  let TEMPLATES = loadTemplates();


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
  const HUB_OPENS_TO = 'activity';


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

  function plainText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('i, .visually-hidden').forEach((n) => n.remove());
    return c.textContent.trim();
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
  const TYPE_ICONS = { note: 'sticky_note_2', task: 'notes' };

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
  const templateTags = () => [...new Set(TEMPLATES.map((t) => t.tag).filter(Boolean))];

  // Remove chips for template tags other than "keep" (for example, CONFLICT
  // when you switch to a Contact template). Tags you add by hand stay.
  async function clearOtherTemplateTags(form, keep) {
    for (let pass = 0; pass < 5; pass++) {
      const extra = $$(SEL.tagChip, form).filter((chip) => {
        const name = norm(chip.getAttribute('data-testid').slice('tag-chip-'.length));
        return name !== norm(keep) && templateTags().some((t) => norm(t) === name);
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

  function clearTagsIfReopened(form) {
    const kind = kindOf(form);
    // Wait until the old box is gone, so we only act on the reopened one.
    if (!closedAt[kind] || Date.now() - closedAt[kind] < 400) return;
    if (!isVisible($(SEL.message, form))) return;
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
    const body = tpl.tag ? `${tpl.body}\n\n\n#${tpl.tag.replace(/^#/, '')} ` : tpl.body;

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
      b.addEventListener('click', () => useTemplate(composerOf(b) || form, tpl));
      bar.appendChild(b);
    }
    const hint = document.createElement('span');
    hint.className = 'fvqn-hint';
    hint.textContent = 'N: note   T: task   Ctrl+Enter: save';
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

  // ---------- "Improver Options" in the account menu ----------
  // Filevine draws the account menu only when it opens. When it does, we copy
  // its "Filevine Settings" item (so the look matches) and add ours below it.
  function addOptionsMenuItem() {
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
      if (el.childElementCount === 0 && el.textContent.trim() === 'Filevine Settings') el.textContent = 'Improver Options';
    }
    mine.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const trigger = $('.fvs-global-avatar-menu-trigger');
      if (trigger) trigger.click(); // close Filevine's menu
      openOptions();
    }, true);
    item.after(mine);
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
            <label>Tag<span class="pd9-tagwrap"><span>#</span><input type="text" name="tag" maxlength="60" placeholder="CONTACT"></span></label>
            <label>Note text<textarea name="body" rows="10"></textarea></label>
            <p class="pd9-help">Type <code>{date}</code> for today's date and <code>{|}</code> where the cursor should start. Leave Tag empty for no tag.</p>
            <div class="pd9-row">
              <button type="button" class="pd9-btn pd9-up" title="Move up">Move up</button>
              <button type="button" class="pd9-btn pd9-down" title="Move down">Move down</button>
              <button type="button" class="pd9-btn pd9-del">Delete</button>
            </div>
          </div>
        </div>
        <div class="pd9-foot">
          <button type="button" class="pd9-btn pd9-reset">Reset to defaults</button>
          <button type="button" class="pd9-btn pd9-export" title="Save your templates to a file">Export</button>
          <button type="button" class="pd9-btn pd9-import" title="Add templates from a file">Import</button>
          <input type="file" class="pd9-file" accept=".json,application/json" hidden>
          <span class="pd9-grow"></span>
          <button type="button" class="pd9-btn pd9-cancel">Cancel</button>
          <button type="button" class="pd9-btn pd9-primary pd9-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const q = (s) => overlay.querySelector(s);
    const ul = q('.pd9-list');
    const f = { label: q('[name=label]'), subject: q('[name=subject]'), tag: q('[name=tag]'), body: q('[name=body]') };

    function drawList() {
      ul.innerHTML = list.map((t, i) =>
        `<li role="option" tabindex="0" data-i="${i}" aria-selected="${i === sel}">${escapeAttr(t.label || 'Untitled')}</li>`).join('');
      const empty = !list.length;
      Object.values(f).forEach((el) => { el.disabled = empty; });
      ['.pd9-up', '.pd9-down', '.pd9-del'].forEach((s) => { q(s).disabled = empty; });
      if (!empty) {
        q('.pd9-up').disabled = sel === 0;
        q('.pd9-down').disabled = sel === list.length - 1;
      }
    }
    function drawForm() {
      const t = list[sel] || { label: '', subject: '', tag: '', body: '' };
      f.label.value = t.label; f.subject.value = t.subject; f.tag.value = t.tag; f.body.value = t.body;
    }
    function redraw() { drawList(); drawForm(); }

    for (const [key, el] of Object.entries(f)) {
      el.addEventListener('input', () => {
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
      list.push({ id: newId(), label: 'New template', subject: '', tag: '', body: '' });
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
        templates: list.map(({ label, subject, tag, body }) => ({ label, subject, tag, body })) };
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
            tag: cleanTag(text(raw && raw.tag, 60)), body: text(raw && raw.body, 20000) };
          if (!t.label) { skipped++; continue; }
          if (list.some((x) => same(x, t))) { skipped++; continue; }
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
  //   24-CF-002415-A-OS    2026-OC-000346-A-OS    07CT006158AOS    06DF000228AOS
  //   24 CF 2415 A OS      24cf2415               2024-CF-2415
  // Parts: year (2 or 4 digits), court type (2 letters), number (up to 7 digits,
  // often zero-padded to 6), defendant letter (optional), county (optional, OR/OS).
  const CASE_PART_RX = /(?<![a-z0-9])(\d{4}|\d{2})[\s\-_]*([a-z]{2})[\s\-_]*(\d{1,7})(?:[\s\-_]*([a-z])[\s\-_]*([a-z]{2})|[\s\-_]*([a-z]))?(?![a-z0-9])/gi;

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
  // Text of an element with a space between each piece, so "...AOS" and the next
  // line never run together (textContent glues them: "000228AOSBrian").
  function spacedText(el) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
    return parts.join(' ').replace(/\s+/g, ' ');
  }
  const textFitsCaseQuery = (text, input) => {
    const qs = readCaseQuery(input);
    return qs.length > 0 && readCaseNumbers(text).some((c) => qs.some((q) => caseFits(q, c)));
  };

  // Find's "Case #" box: a full case number (with letters, or 6+ digits) uses the
  // STAC reader; a few digits match the end of the number (0228 finds ...000228).
  function textHasCase(text, entry) {
    const raw = String(entry || '').trim();
    if (/[a-z]/i.test(raw) || raw.replace(/\D/g, '').length >= 6) return textFitsCaseQuery(text, raw);
    const tail = stripZeros(raw.replace(/\D/g, ''));
    return !!tail && readCaseNumbers(text).some((c) => c.num.endsWith(tail));
  }

  // ---------- "Find" search helper (next to Filevine's search box) ----------
  // Fill in first name, last name, and/or the last digits of a case number.
  // We type a smart search into Filevine's own box, then show ONLY the results
  // that contain every field you filled in. Edit the search box to see everything.
  let findFilter = null; // { query, first, last, caseNo }

  const fold = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = (t) => fold(t).split(/[^a-z0-9]+/).filter(Boolean);



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


  function findBadge(text) {
    let badge = document.getElementById('pd9-find-badge');
    const input = searchInput();
    if (!text || !input) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pd9-find-badge';
      document.body.appendChild(badge);
    }
    // Sit just left of the search box, in the header, so it never covers results.
    const r = input.getBoundingClientRect();
    badge.style.right = `${Math.round(window.innerWidth - r.left + 8)}px`;
    badge.style.top = `${Math.round(r.top + r.height / 2 - 11)}px`;
    if (badge.textContent !== text) badge.textContent = text;
  }

  function applyFindFilter() {
    const input = searchInput();
    if (!findFilter) return;
    if (!input || !input.value || input.value !== findFilter.query) { // search changed or cleared: show everything again
      document.querySelectorAll('[data-pd9-hidden]').forEach((el) => { el.style.display = ''; el.removeAttribute('data-pd9-hidden'); });
      findFilter = null;
      findBadge('');
      return;
    }
    const { box, items, loading } = resultItems();
    if (!box) { findBadge(''); return; } // dropdown closed
    if (!items.length) { findBadge(loading ? 'PD9 Find: searching...' : ''); return; }

    const f = findFilter;
    const nameTokens = [...words(f.first), ...words(f.last)];
    const ok = (el) => {
      const t = spacedText(el);
      const w = words(t);
      if (!nameTokens.every((tok) => w.some((x) => x.startsWith(tok)))) return false;
      if (f.caseNo && !textHasCase(t, f.caseNo)) return false;
      return true;
    };
    // Every field you filled in must be in the result. Nothing else is shown.
    const keep = items.filter(ok);
    for (const el of items) {
      const hide = !keep.includes(el);
      if (hide && el.style.display !== 'none') { el.style.display = 'none'; el.setAttribute('data-pd9-hidden', ''); }
      if (!hide && el.hasAttribute('data-pd9-hidden')) { el.style.display = ''; el.removeAttribute('data-pd9-hidden'); }
    }
    findBadge(keep.length
      ? `PD9 Find: ${keep.length} of ${items.length} match`
      : loading ? 'PD9 Find: searching...' : 'PD9 Find: nothing matches every field. Try fewer fields or Search Deeper');
  }

  store.set('pd9-find-last', null); // earlier versions remembered the last search; forget it

  function addFindButton() {
    const input = searchInput();
    if (!input || document.getElementById('pd9-find-btn')) return;
    const host = input.closest('.search') || input.closest('.fvs-autocomplete') || input.parentElement;
    const btn = document.createElement('button');
    btn.id = 'pd9-find-btn';
    btn.type = 'button';
    btn.title = 'Search by first name, last name, or case number';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Find</span>';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFindPanel(btn); });
    host.after(btn);
  }

  function toggleFindPanel(btn) {
    const open = document.getElementById('pd9-find');
    if (open) { open.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'pd9-find';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Find a client');
    panel.innerHTML = `
      <div class="pd9-find-grid">
        <label>First name<input name="first" autocomplete="off"></label>
        <label>Last name<input name="last" autocomplete="off"></label>
        <label class="pd9-span2">Case # (last digits or full number)<input name="caseNo" autocomplete="off"></label>
      </div>
      <div class="pd9-panel-btns">
        <button type="button" class="pd9-btn pd9-clear">Clear</button>
        <button type="button" class="pd9-btn pd9-primary pd9-go">Search</button>
      </div>`;
    document.body.appendChild(panel);
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.left = `${Math.max(8, Math.round(Math.min(r.left, window.innerWidth - 340)))}px`;

    const f = Object.fromEntries(['first', 'last', 'caseNo'].map((n) => [n, panel.querySelector(`[name=${n}]`)]));
    f.first.focus();

    const go = () => {
      const v = {
        first: f.first.value.trim(),
        last: f.last.value.trim(),
        caseNo: f.caseNo.value.trim(),
      };
      if (!v.first && !v.last && !v.caseNo) { f.first.focus(); return; }
      // What Filevine is good at: names. Use the case digits only when there is no name.
      const query = [v.last, v.first].filter(Boolean).join(' ') || v.caseNo;
      panel.remove();
      const input = searchInput();
      if (!input) { toast('Could not find the search box.'); return; }
      findFilter = { query, ...v };
      input.focus();
      setInputValue(input, query);
      input.dispatchEvent(new KeyboardEvent('keyup', { key: query.slice(-1), bubbles: true }));
      applyFindFilter();
    };
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); panel.remove(); btn.focus(); }
    });
    panel.querySelector('.pd9-go').addEventListener('click', go);
    panel.querySelector('.pd9-clear').addEventListener('click', () => {
      Object.values(f).forEach((el) => { el.value = ''; });
      f.first.focus();
    });
    // Click outside closes it.
    setTimeout(() => document.addEventListener('mousedown', function away(e) {
      if (!panel.isConnected) return document.removeEventListener('mousedown', away, true);
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { panel.remove(); document.removeEventListener('mousedown', away, true); }
    }, true), 0);
  }

  // ---------- Case# Search (STAC style) ----------
  // Type 241234, 24cf1234, 24cf1234os, or a full case number. We open Filevine's
  // full search page (projects only, archived included) with the number written
  // the ways Filevine stores it, keep pressing "More", and show only real matches.
  const CASE_SEARCH_KEY = 'pd9-case-search';
  const CASE_SEARCH_MAX_MORE = 10; // how many times to press "More" at most

  // Court types and defendant letters to try when you don't type them.
  // Add any type codes your office uses.
  const CASE_TYPES = ['CF', 'MM', 'CT', 'MO', 'OC', 'DF', 'CJ', 'MH', 'AP'];
  const CASE_DEFENDANTS = ['A', 'B'];
  const CASE_COUNTIES = ['OS', 'OR'];

  // Write the case number out every way it can appear in a case title, so
  // Filevine's search finds the title itself:
  //   24-CF-001234-A-OS   2024-CF-001234-A-OS   24CF001234AOS   (+ OR, B, each type)
  // plus the short forms 24-CF-001234 / 2024-CF-001234 / 24CF001234.
  function caseSearchTerms(qs) {
    const terms = new Set();
    for (const q of qs) {
      const num = q.num.length < 6 ? q.num.padStart(6, '0') : q.num; // always 6 digits, zero-filled
      const years = [q.year, `20${q.year}`];
      for (const type of q.type ? [q.type] : CASE_TYPES) {
        for (const y of years) terms.add(`${y}-${type}-${num}`);
        terms.add(`${q.year}${type}${num}`);
        for (const def of q.def ? [q.def] : CASE_DEFENDANTS) {
          for (const county of q.county ? [q.county] : CASE_COUNTIES) {
            for (const y of years) terms.add(`${y}-${type}-${num}-${def}-${county}`);
            terms.add(`${q.year}${type}${num}${def}${county}`);
          }
        }
      }
    }
    return [...terms].join(' ');
  }


  function startCaseSearch(entry) {
    const qs = readCaseQuery(entry);
    if (!qs.length) { toast('Type a case number like 241234, 24cf1234, or 24-CF-001234-A-OS.'); return false; }
    const q = caseSearchTerms(qs);
    try { sessionStorage.setItem(CASE_SEARCH_KEY, JSON.stringify({ entry, q, more: 0, lastFits: -1 })); } catch (e) { /* ignore */ }
    location.hash = `#/search?q=${encodeURIComponent(q)}&archived&projects&sort=Relevance`;
    return true;
  }

  function activeCaseSearch() {
    if (!/#\/search\?/.test(location.href)) return null;
    let st = null;
    try { st = JSON.parse(sessionStorage.getItem(CASE_SEARCH_KEY) || 'null'); } catch (e) { return null; }
    // Compare loosely: Filevine may re-encode the address (spaces, + signs, case).
    const loose = (t) => String(t || '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q');
    return st && loose(q) === loose(st.q) ? st : null;
  }

  let caseMoreBusy = false;
  function applyCaseSearch() {
    const st = activeCaseSearch();
    const banner = document.getElementById('pd9-case-banner');
    if (!st) { if (banner) banner.remove(); return; }
    const page = $('search');
    if (!page) return;
    const cards = $$('.search-result', page);
    let fits = 0;
    for (const card of cards) {
      // Only a case card counts, and only its TITLE: the case number in the
      // title must have the year and the number. A match anywhere else
      // (client details, notes, people) is hidden.
      const isProject = card.classList.contains('search-result-project');
      const heading = isProject && card.querySelector('h2');
      const title = heading ? spacedText(heading) : '';
      const ok = !!title && textFitsCaseQuery(title, st.entry);
      if (ok) fits++;
      const want = ok ? '' : 'none';
      if (card.style.display !== want) card.style.display = want;
    }
    // Hide Filevine's own "N Results" count; it counts the hidden ones too.
    const more = $$('button', page).find((b) => b.textContent.trim() === 'More' && isVisible(b) && !b.disabled);
    const loading = !!page.querySelector('.fa-spin, [data-testid="fv-loading-spinner"], .loading');

    // Keep pressing More while new pages keep turning up matches.
    if (more && !caseMoreBusy && !loading && st.more < CASE_SEARCH_MAX_MORE && fits !== st.lastFits) {
      caseMoreBusy = true;
      const before = cards.length;
      st.more += 1; st.lastFits = fits;
      try { sessionStorage.setItem(CASE_SEARCH_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
      more.click();
      waitFor(() => $$('.search-result', page).length > before, 8000).then(() => { caseMoreBusy = false; applyCaseSearch(); });
    }

    let bar = banner;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pd9-case-banner';
      document.body.appendChild(bar);
    }
    const still = caseMoreBusy || loading;
    const text = `Case# Search "${st.entry}": ${fits} match${fits === 1 ? '' : 'es'}${still ? ', still looking...' : ''}` +
      (!still && fits === 0 ? '. Try fewer parts, like 241234 instead of 24cf1234os.' : '');
    if (bar.textContent !== text) bar.textContent = text;
  }

  function addCaseSearchButton() {
    const find = document.getElementById('pd9-find-btn');
    if (!find || document.getElementById('pd9-case-btn')) return;
    const btn = find.cloneNode(false);
    btn.id = 'pd9-case-btn';
    btn.title = 'Search by case number, like STAC (241234, 24cf1234, 24-CF-001234-A-OS)';
    btn.innerHTML = '<span>Case#</span>';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleCasePanel(btn); });
    find.after(btn);
  }

  function toggleCasePanel(btn) {
    const open = document.getElementById('pd9-case');
    if (open) { open.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'pd9-case';
    panel.className = 'pd9-findlike';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Case number search');
    panel.innerHTML = `
      <label>Case number<input name="case" autocomplete="off" spellcheck="false"></label>
      <p class="pd9-case-help">Year + number finds every court type and county: <b>241234</b> finds 24-CF-001234, 24-MM-001234, and so on. Narrow it with the type or county: <b>24cf1234</b>, <b>24cf1234os</b>.</p>
      <div class="pd9-panel-btns">
        <button type="button" class="pd9-btn pd9-primary pd9-go">Search</button>
      </div>`;
    document.body.appendChild(panel);
    const r = btn.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.left = `${Math.max(8, Math.round(Math.min(r.left, window.innerWidth - 340)))}px`;
    const input = panel.querySelector('input');
    input.focus();
    const go = () => { if (startCaseSearch(input.value.trim())) panel.remove(); else input.focus(); };
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); panel.remove(); btn.focus(); }
    });
    panel.querySelector('.pd9-go').addEventListener('click', go);
    setTimeout(() => document.addEventListener('mousedown', function away(e) {
      if (!panel.isConnected) return document.removeEventListener('mousedown', away, true);
      if (!panel.contains(e.target) && !btn.contains(e.target)) { panel.remove(); document.removeEventListener('mousedown', away, true); }
    }, true), 0);
  }

  function decorate() {
    watchProject();
    addOptionsMenuItem();
    addCloseButton();
    addCloseHints();
    addFindButton();
    addCaseSearchButton();
    applyFindFilter();
    applyCaseSearch();
    rewriteHubLinks();
    for (const form of $$(COMPOSERS)) {
      const layout = $(SEL.layout, form);
      if (layout && !$('.fvqn-wrap', form)) layout.parentNode.insertBefore(buildBar(form), layout);
      clearTagsIfReopened(form);
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

  function saveDraft(form) {
    if (!SAVE_DRAFTS) return;
    const key = draftKey(form);
    if (!key) return;
    const { body, subject } = currentText(form);
    // Never overwrite a saved draft with an empty box.
    if (!body.trim() && !subject.trim()) return;
    try {
      localStorage.setItem(key, JSON.stringify({ subject, body, at: Date.now() }));
    } catch (e) {
      pruneDrafts(true); // storage full: clean up and try once more
      try { localStorage.setItem(key, JSON.stringify({ subject, body, at: Date.now() })); } catch (e2) { /* give up */ }
    }
    pruneDrafts();
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
    }, 1500);
  }

  // Save on every letter or change in the subject or message.
  document.addEventListener('input', (e) => {
    const form = composerOf(e.target);
    if (form) { saveDraft(form); addRestoreButton(form); }
  }, true);

  // "Restore note" button next to Add tags / Attach a file. Uses Filevine's button style.
  function addRestoreButton(form) {
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
    if (form && findSaveButton(form) && findSaveButton(form).contains(e.target)) clearDraftAfterSave(form);
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
    /* Find (search helper) */
    #pd9-find-btn, #pd9-case-btn {
      display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 6px 10px; cursor: pointer;
      font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: transparent;
      border: 1px solid rgba(255, 255, 255, .55); border-radius: 4px; white-space: nowrap; align-self: center;
    }
    #pd9-find-btn:hover, #pd9-case-btn:hover { background: rgba(255, 255, 255, .12); }
    #pd9-find-btn:focus-visible, #pd9-case-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    #pd9-find, #pd9-case {
      position: fixed; z-index: 100000; width: 330px; padding: 14px; font: inherit; font-size: 13px;
      background: var(--t-color-surface, #fff); color: var(--t-color-text, #1f2933);
      border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3);
    }
    #pd9-find .pd9-find-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    #pd9-find .pd9-span2 { grid-column: 1 / -1; }
    #pd9-case label, #pd9-find label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
    #pd9-find input, #pd9-case input {
      font: inherit; font-size: 14px; font-weight: 400; color: inherit; background: var(--t-color-surface, #fff);
      border: 1px solid var(--t-color-border, #c9ced6); border-radius: 4px; padding: 7px 9px; width: 100%; box-sizing: border-box;
    }
    #pd9-find input:focus, #pd9-case input:focus { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: -1px; }
    #pd9-find .pd9-panel-btns, #pd9-case .pd9-panel-btns { display: flex; justify-content: flex-end; gap: 8px; }
    #pd9-find .pd9-btn, #pd9-case .pd9-btn {
      font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 4px; cursor: pointer;
      border: 1px solid var(--t-color-border, #c9ced6); background: var(--t-color-surface, #fff); color: inherit;
    }
    #pd9-find .pd9-primary, #pd9-case .pd9-primary { background: #1f2933; border-color: #1f2933; color: #fff; }
    #pd9-case .pd9-case-help { margin: 8px 0 12px; font-size: 12px; line-height: 1.4; opacity: .8; }
    #pd9-case-banner {
      position: fixed; top: 70px; left: 50%; transform: translateX(-50%); z-index: 100000;
      background: #e8590c; color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .25); max-width: calc(100vw - 40px);
    }
    #pd9-find-badge {
      position: fixed; z-index: 100000; pointer-events: none; padding: 3px 8px; border-radius: 4px;
      background: #e8590c; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    .fvqn-toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #1f2933; color: #fff; padding: 8px 14px; border-radius: 6px;
      font-size: 13px; z-index: 100001;
    }
  `;
  document.head.appendChild(style);

  // Filevine is a single-page app, so keep watching for composers to appear.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; decorate(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  pruneDrafts();

  // Print the version to the console. Filevine mutes console.log on its page,
  // so borrow a clean console from a hidden blank frame.
  (function printVersion() {
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
