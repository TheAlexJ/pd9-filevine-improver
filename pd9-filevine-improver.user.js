// ==UserScript==
// @name         PD9 Filevine Improver
// @namespace    https://filevine.local/pd9-improver
// @version      3.48.0
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
      label: 'Contact', subject: 'Contact', tag: 'CONTACT', hotkey: 'C',
      body: [
        'Date of contact: {date}',
        'Contact type: {|}',
        'Contact with: ',
        'Discussed: ',
        'Follow-up: ',
      ].join('\n'),
    },
    {
      label: 'File Review', subject: 'File Review', tag: 'FILEREVIEW', hotkey: 'Alt+2',
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
      label: 'Conflict', subject: 'Conflict', tag: 'CONFLICT', hotkey: 'Alt+3',
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
    return list.map((t) => ({ id: t.id || newId(), label: t.label || 'Untitled', subject: t.subject || '', tag: cleanTag(t.tag), body: t.body || '', hotkey: t.hotkey || '' }));
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
      if (tpl.hotkey) {
        b.title = `Shortcut: ${tpl.hotkey}`;
        const k = document.createElement('span');
        k.className = 'fvqn-hk';
        k.textContent = tpl.hotkey;
        b.appendChild(k);
      }
      b.addEventListener('click', () => useTemplate(composerOf(b) || form, tpl));
      bar.appendChild(b);
    }
    const hint = document.createElement('span');
    hint.className = 'fvqn-hint';
    hint.textContent = 'N: note   T: task   C: contact   Ctrl+Enter: save';
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
            <label>Shortcut<span class="pd9-tagwrap"><input type="text" name="hotkey" readonly placeholder="Click here, then press keys (like Alt+4)"><button type="button" class="pd9-btn pd9-hk-clear">Clear</button></span></label>
            <label>Note text<textarea name="body" rows="10"></textarea></label>
            <p class="pd9-help">Type <code>{date}</code> for today's date and <code>{|}</code> where the cursor should start. Leave Tag empty for no tag. A shortcut starts a note with this template from anywhere in a case.</p>
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
      const t = list[sel] || { label: '', subject: '', tag: '', body: '', hotkey: '' };
      f.label.value = t.label; f.subject.value = t.subject; f.tag.value = t.tag; f.body.value = t.body;
      hk.value = t.hotkey || ''; hk.disabled = !list[sel];
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
      list.push({ id: newId(), label: 'New template', subject: '', tag: '', body: '', hotkey: '' });
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
            tag: cleanTag(text(raw && raw.tag, 60)), body: text(raw && raw.body, 20000), hotkey: '' };
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
  // Text of an element with a space between lines and blocks, so "...AOS" and the
  // next line never run together ("000228AOSBrian"). Highlighting inside a line
  // (Filevine wraps matches in <mark>, like 25-CF-0<mark>03767</mark>) is joined
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

  const textFitsCaseQuery = (text, input) => {
    const qs = readCaseQuery(input);
    return qs.length > 0 && readCaseNumbers(text).some((c) => qs.some((q) => caseFits(q, c)));
  };



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






  // Type the Case# search into Filevine's own search box (top of the page) and
  // show only results whose TITLE has the right case number.
  function startCaseSearch(entry) {
    const qs = readCaseQuery(entry);
    if (!qs.length) { toast('Type a case number like 241234, 24cf1234, or 24-CF-001234-A-OS.'); return false; }
    const input = searchInput();
    if (!input) { toast('Could not find the search box.'); return false; }
    const query = caseSearchTerms(qs);
    runCaseSearch(input, query, entry);
    return true;
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
      help: 'Any order, partial names work: <b>hector flores</b>, <b>flores, hector</b>, <b>hec flo</b>. Middle names count too.',
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

  // Name words: letters only, so "Flores, Hector" and "hector  flores" read the same.
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

  // Ask Filevine's search directly (the same address its dropdown uses), with
  // archived cases included, and list only real matches. One request at a time,
  // no checkbox, none of the dropdown's bugs.
  let searchRequest = null;
  const htmlToText = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';

  async function askFilevine(query, signal, archived = true) {
    const url = `/api/suggest?q=${encodeURIComponent(query)}&onlyBillingEligible=false&archived=${archived ? 'true' : 'false'}`;
    const res = await fetch(url, { credentials: 'include', signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    if (!json || json.success === false || !Array.isArray(json.data)) throw new Error('unexpected reply');
    return json.data.map((d) => ({ id: d.id, title: htmlToText(d.title), details: htmlToText(d.details), clientName: htmlToText(d.clientName), clientID: d.clientID || null, orgID: d.orgID || null }));
  }

  async function searchDirect(entry, panel, m) {
    const out = panel.querySelector('.pd9-case-results');
    const go = panel.querySelector('.pd9-go');
    if (searchRequest) searchRequest.abort();
    const ctrl = new AbortController();
    searchRequest = ctrl;

    const started = Date.now();
    out.innerHTML = '<div class="pd9-case-status"><span class="pd9-spin" aria-hidden="true"></span><span class="pd9-case-wait">Searching, including archived...</span></div>';
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

    const list = document.createElement('ul');
    list.className = 'pd9-case-list';
    for (const h of hits) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#/project/${encodeURIComponent(h.id)}/activity`;
      const t = document.createElement('span');
      t.className = 'pd9-case-title';
      t.textContent = h.title;
      const d = document.createElement('span');
      d.className = 'pd9-case-details';
      d.textContent = h.details;
      a.append(t, d);
      // Plain click: go there and close. Ctrl/Cmd/middle-click opens a new tab as usual.
      a.addEventListener('click', (e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) setTimeout(() => panel.remove(), 0); });
      li.appendChild(a);
      list.appendChild(li);
    }
    out.appendChild(list);
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
  const extraCache = new Map(); // project id -> { apd, userStatus }

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
    if (extraCache.has(hit.id) && extraCache.get(hit.id).charges !== undefined) return extraCache.get(hit.id);
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
          <input name="q" autocomplete="off" spellcheck="false" placeholder="Name, any order (hector flores, flores hector, hec flo)">
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
          a.href = `#/project/${encodeURIComponent(h.id)}/activity`;
          a.textContent = text;
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
  // bottom-right corner to resize it. Double-click the top bar to put it back.
  // Remembered for next time. When Filevine minimizes the box, it goes back to
  // its normal spot so the minimized bar sits where you expect.
  const COMPOSER_KEY = 'pd9-composer-box';
  const setImp = (el, prop, val) => (val == null ? el.style.removeProperty(prop) : el.style.setProperty(prop, val, 'important'));

  let composerBoxCache;
  const composerBox = () => (composerBoxCache === undefined ? (composerBoxCache = store.get(COMPOSER_KEY, null)) : composerBoxCache);
  const setComposerBox = (box) => { composerBoxCache = box; store.set(COMPOSER_KEY, box); };
  let lastPlaced = null; // { form, open, box } so we only touch the box when something changed

  function placeComposer(form) {
    const box = composerBox();
    const open = isVisible($(SEL.message, form));
    // Put Filevine's own position back (only if we changed it).
    if (!box || !open) {
      if (form.dataset.pd9Orig !== undefined) { form.style.cssText = form.dataset.pd9Orig; delete form.dataset.pd9Orig; }
      return;
    }
    if (form.dataset.pd9Orig === undefined) form.dataset.pd9Orig = form.style.cssText;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(box.width, 380), vw - 16);
    const height = Math.min(Math.max(box.height, 260), vh - 16);
    setImp(form, 'right', 'auto'); setImp(form, 'bottom', 'auto');
    setImp(form, 'width', `${width}px`); setImp(form, 'height', `${height}px`); setImp(form, 'max-height', 'none');
    setImp(form, 'left', `${Math.min(Math.max(box.left, 8 - width + 120), vw - 120)}px`);
    setImp(form, 'top', `${Math.min(Math.max(box.top, 8), vh - 48)}px`);
  }

  const composerReady = new WeakSet();
  function makeComposerMovable() {
    const form = $(SEL.docked);
    if (!form) return;
    form.classList.add('pd9-movable');
    const open = isVisible($(SEL.message, form));
    if (!lastPlaced || lastPlaced.form !== form || lastPlaced.open !== open || lastPlaced.box !== composerBox()) {
      placeComposer(form);
      lastPlaced = { form, open, box: composerBox() };
    }
    if (composerReady.has(form)) return;
    composerReady.add(form);

    const saveBox = () => {
      if (!isVisible($(SEL.message, form))) return;
      const r = form.getBoundingClientRect();
      setComposerBox({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
    };
    const isHandle = (t) => t.closest('.header') && !t.closest('button, [role="button"], input, select, textarea, a');
    let lastHandleDown = 0;

    form.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = form.getBoundingClientRect();
      // Grabbing the resize corner: pin left/top first so it grows toward the corner.
      if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) {
        if (!composerBox()) { setComposerBox({ left: r.left, top: r.top, width: r.width, height: r.height }); placeComposer(form); }
        return;
      }
      if (!isHandle(e.target)) return;
      e.preventDefault();
      lastHandleDown = Date.now();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      setComposerBox({ left: r.left, top: r.top, width: r.width, height: r.height });
      placeComposer(form);
      form.setPointerCapture(e.pointerId);
      form.classList.add('pd9-dragging');
      const move = (ev) => {
        setImp(form, 'left', `${Math.min(Math.max(ev.clientX - dx, 8 - r.width + 120), window.innerWidth - 120)}px`);
        setImp(form, 'top', `${Math.min(Math.max(ev.clientY - dy, 8), window.innerHeight - 48)}px`);
      };
      const up = () => {
        form.removeEventListener('pointermove', move);
        form.removeEventListener('pointerup', up);
        form.removeEventListener('pointercancel', up);
        form.classList.remove('pd9-dragging');
        saveBox();
      };
      form.addEventListener('pointermove', move);
      form.addEventListener('pointerup', up);
      form.addEventListener('pointercancel', up);
    }, true);

    form.addEventListener('dblclick', () => {
      // (While dragging, the click lands on the box itself, so go by where the press started.)
      if (Date.now() - lastHandleDown > 800) return;
      setComposerBox(null);
      placeComposer(form);
    });

    let t = null;
    new ResizeObserver(() => {
      if (!composerBox() || form.classList.contains('pd9-dragging')) return;
      clearTimeout(t);
      t = setTimeout(saveBox, 250);
    }).observe(form);
  }

  // ---------- Jail Search (Osceola cases only) ----------
  // On a case whose number ends in OS, a "Jail Search" button sits next to
  // Vitals. It opens the Osceola County jail search for the name in the case
  // title (everything before the " | "), in a new tab.
  const JAIL_SEARCH_URL = 'https://legacy-apps.osceola.org/Apps/CorrectionsReports/Report/Search';

  function jailSearchFor() {
    const title = currentCaseName(); // "Jhonatan Urrego Millan | 25-CF-003158-A-OS"
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

  function decorate() {
    watchProject();
    addOptionsMenuItem();
    addCloseButton();
    addCloseHints();
    addCaseSearchButton();
    applyCaseFilter();
    keepAdvanced();
    makeComposerMovable();
    addJailButton();
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

    // Template shortcuts: open a note with that template, anywhere in a case.
    if (!e.repeat && !e.isComposing) {
      const combo = comboFromEvent(e);
      // C is built in for a contact note: if no template claims C, use the Contact template.
      const tpl = combo && (TEMPLATES.find((t) => t.hotkey === combo) ||
        (combo === 'C' && TEMPLATES.find((t) => norm(t.tag) === 'contact' || /^contact$/i.test(t.label.trim()))));
      if (tpl) {
        if (!inCase() || isTyping(e) || document.querySelector('.pd9-overlay')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openFloating('note').then((form) => { if (form) useTemplate(form, tpl); });
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
    #pd9-adv .pd9-charges-btn {
      all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
      color: #2b7a78; font-weight: 600; font-size: 13px; text-decoration: underline; text-underline-offset: 3px;
    }
    #pd9-adv .pd9-charges-btn::after { content: "›"; font-size: 15px; line-height: 1; text-decoration: none; }
    #pd9-adv .pd9-charges-btn:hover { background: var(--t-color-object-1-secondary, #eef2f7); }
    #pd9-adv .pd9-charges-btn:focus-visible { outline: 2px solid var(--t-color-focus, #2563eb); outline-offset: 1px; }
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
    .pd9-movable { resize: both; overflow: auto; box-sizing: border-box; min-width: 380px; }
    .pd9-movable .header { cursor: move; touch-action: none; }
    .pd9-movable .header button, .pd9-movable .header [role="button"] { cursor: pointer; }
    .pd9-movable .note-input-wrapper { max-height: none !important; }
    .pd9-movable.pd9-dragging { opacity: .92; user-select: none; }
    .fvqn-hk { margin-left: 6px; font-size: 10px; font-weight: 600; opacity: .6; letter-spacing: .02em; }
    .pd9-overlay .pd9-hk { float: right; font-size: 11px; font-weight: 600; opacity: .6; }
    .pd9-overlay .pd9-tagwrap .pd9-hk-clear { flex: none; }
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
  const OWN_UI = '#pd9-adv, #pd9-case, .pd9-overlay, .pd9-panel, .fvqn-toast, #pd9-case-badge';
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
