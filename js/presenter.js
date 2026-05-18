/* Presenter window: file picker, presenter UI, notes editing, sync to audience. */
(function () {
  'use strict';
  const { CHANNEL_NAME, splitNotes, joinNotes, renderPageToCanvas, downloadText, throttle } =
    window.PDFPresenter;

  // ---------- State ----------
  const state = {
    pdfDoc: null,        // pdf.js document for presenter window
    pdfBytes: null,      // ArrayBuffer for sharing with audience
    pdfName: 'slides.pdf',
    notesName: 'notes.md',
    pageCount: 0,
    pageIndex: 1,        // 1-based
    notes: [''],         // per-slide markdown
    editing: false,
    audienceWin: null,
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dropZone = $('drop-zone');
  const pdfInput = $('pdf-input');
  const notesInput = $('notes-input');
  const pdfName = $('pdf-name');
  const notesName = $('notes-name');
  const startBtn = $('start-btn');

  const uploadScreen = $('upload-screen');
  const presenterScreen = $('presenter-screen');

  const currentCanvas = $('current-canvas');
  const nextCanvas = $('next-canvas');
  const currentWrap = $('current-canvas-wrap');
  const pageInput = $('page-input');
  const pageTotal = $('page-total');
  const slideDrawer = $('slide-drawer');
  const slideList = $('slide-list');
  const maximizeBtn = $('maximize-notes');
  const notesRendered = $('notes-rendered');
  const notesEditor = $('notes-editor');
  const notesMode = $('notes-mode');

  // ---------- Cross-window channel ----------
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'audience-hello') {
      // Audience window came up — send everything it needs.
      sendPdfToAudience();
      broadcastPage();
    }
  });

  function sendPdfToAudience() {
    if (!state.pdfBytes) return;
    // Send a copy so we keep our own ArrayBuffer intact.
    const copy = state.pdfBytes.slice(0);
    channel.postMessage({ type: 'pdf', buffer: copy, name: state.pdfName });
  }
  function broadcastPage() {
    channel.postMessage({ type: 'page', page: state.pageIndex });
  }
  function broadcastPointer(x, y, visible) {
    channel.postMessage({ type: 'pointer', x, y, visible });
  }

  // ---------- File handling ----------
  function setPdfFile(file) {
    if (!file) return;
    state.pdfName = file.name || 'slides.pdf';
    pdfName.textContent = state.pdfName;
    file.arrayBuffer().then((buf) => {
      state.pdfBytes = buf;
      updateStartEnabled();
    });
  }

  function setNotesFile(file) {
    if (!file) {
      state.notes = [''];
      notesName.textContent = 'No file selected';
      return;
    }
    state.notesName = file.name || 'notes.md';
    notesName.textContent = state.notesName;
    file.text().then((txt) => {
      state.notes = splitNotes(txt);
      if (state.notes.length === 0) state.notes = [''];
    });
  }

  function updateStartEnabled() {
    startBtn.disabled = !state.pdfBytes;
  }

  pdfInput.addEventListener('change', (e) => setPdfFile(e.target.files[0]));
  notesInput.addEventListener('change', (e) => setNotesFile(e.target.files[0]));

  // Drag and drop
  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    for (const f of files) {
      const lower = (f.name || '').toLowerCase();
      if (f.type === 'application/pdf' || lower.endsWith('.pdf')) {
        setPdfFile(f);
      } else if (
        f.type.startsWith('text/') ||
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.txt')
      ) {
        setNotesFile(f);
      }
    }
  });

  // ---------- Start presenting ----------
  startBtn.addEventListener('click', startPresenting);

  async function startPresenting() {
    if (!state.pdfBytes) return;
    startBtn.disabled = true;
    try {
      // Load the PDF in this window first. Use Uint8Array view on a copy so the
      // original ArrayBuffer stays usable for sending to the audience window.
      const data = new Uint8Array(state.pdfBytes.slice(0));
      const loadingTask = pdfjsLib.getDocument({ data });
      state.pdfDoc = await loadingTask.promise;
    } catch (err) {
      alert('Failed to load PDF: ' + (err && err.message ? err.message : err));
      startBtn.disabled = false;
      return;
    }
    state.pageCount = state.pdfDoc.numPages;
    state.pageIndex = 1;
    // Ensure notes array is at least as long as pageCount (trailing empties).
    while (state.notes.length < state.pageCount) state.notes.push('');

    uploadScreen.classList.add('hidden');
    presenterScreen.classList.remove('hidden');

    openAudienceWindow();
    await renderCurrent();
    updateNotesView();
    buildSlideList();
    broadcastPage();
  }

  function openAudienceWindow() {
    // Open as a separate window so it can be dragged to another monitor.
    const features = 'popup,width=1280,height=800,left=200,top=200';
    state.audienceWin = window.open('audience.html', 'pdf-presenter-audience', features);
    if (!state.audienceWin) {
      alert('The audience window was blocked by the browser. Please allow popups for this site.');
    }
  }

  $('reopen-audience').addEventListener('click', () => {
    if (state.audienceWin && !state.audienceWin.closed) {
      state.audienceWin.focus();
    } else {
      openAudienceWindow();
    }
  });

  $('exit-btn').addEventListener('click', () => {
    if (!confirm('Exit presentation and go back to the upload screen?')) return;
    if (state.audienceWin && !state.audienceWin.closed) state.audienceWin.close();
    state.audienceWin = null;
    slideDrawer.classList.remove('open');
    drawerBtn.classList.remove('toggle-active');
    presenterScreen.classList.remove('notes-maximized');
    maximizeBtn.classList.remove('toggle-active');
    maximizeBtn.textContent = 'Maximize notes';
    presenterScreen.classList.add('hidden');
    uploadScreen.classList.remove('hidden');
  });

  // ---------- Rendering ----------
  async function renderCurrent() {
    if (!state.pdfDoc) return;
    pageInput.value = String(state.pageIndex);
    pageInput.max = String(state.pageCount);
    pageTotal.textContent = `/ ${state.pageCount}`;

    const cur = await state.pdfDoc.getPage(state.pageIndex);
    await renderPageToCanvas(cur, currentCanvas);

    // Next page (if any).
    if (state.pageIndex < state.pageCount) {
      const nxt = await state.pdfDoc.getPage(state.pageIndex + 1);
      await renderPageToCanvas(nxt, nextCanvas);
    } else {
      // Clear the next canvas.
      const ctx = nextCanvas.getContext('2d');
      ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
      nextCanvas.width = 0;
      nextCanvas.height = 0;
    }
  }

  // Re-render on window resize (with a debounce so we don't thrash pdf.js).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!state.pdfDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCurrent, 120);
  });

  // ---------- Navigation ----------
  function goToPage(n) {
    if (!state.pdfDoc) return;
    const clamped = Math.max(1, Math.min(state.pageCount, n));
    if (clamped === state.pageIndex) {
      // Still resync the input in case the user typed something out of range.
      pageInput.value = String(state.pageIndex);
      return;
    }
    // Save edits before switching, in case we're in edit mode.
    if (state.editing) saveEditorBuffer();
    state.pageIndex = clamped;
    renderCurrent();
    updateNotesView();
    updateSlideListActive();
    broadcastPage();
  }
  function nextPage() { goToPage(state.pageIndex + 1); }
  function prevPage() { goToPage(state.pageIndex - 1); }

  $('next-btn').addEventListener('click', nextPage);
  $('prev-btn').addEventListener('click', prevPage);

  // Jump to a specific page via the toolbar input.
  function commitPageInput() {
    const n = parseInt(pageInput.value, 10);
    if (isNaN(n)) {
      pageInput.value = String(state.pageIndex);
      return;
    }
    goToPage(n);
  }
  pageInput.addEventListener('change', commitPageInput);
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPageInput();
      pageInput.blur();
    } else if (e.key === 'Escape') {
      pageInput.value = String(state.pageIndex);
      pageInput.blur();
    }
  });
  // Select all text on focus so the user can just start typing.
  pageInput.addEventListener('focus', () => pageInput.select());

  // Click on the current slide canvas advances. Ignore clicks while editing notes.
  currentWrap.addEventListener('click', (e) => {
    // Don't advance on accidental drags / text selection.
    if (e.detail === 0) return;
    nextPage();
  });

  // Keyboard navigation. Don't hijack arrows while typing in the notes editor.
  window.addEventListener('keydown', (e) => {
    if (presenterScreen.classList.contains('hidden')) return;
    const t = e.target;
    const inEditor = t === notesEditor || (t && t.tagName === 'TEXTAREA');
    const inInput = t && (t.tagName === 'INPUT' || t.isContentEditable);
    if (inEditor || inInput) return;

    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      nextPage();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      prevPage();
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToPage(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToPage(state.pageCount);
    }
  });

  // ---------- Notes ----------
  function currentNotes() {
    return state.notes[state.pageIndex - 1] || '';
  }
  function setCurrentNotes(md) {
    while (state.notes.length < state.pageIndex) state.notes.push('');
    state.notes[state.pageIndex - 1] = md;
  }

  function updateNotesView() {
    const md = currentNotes();
    if (state.editing) {
      notesEditor.value = md;
    } else {
      const html = window.marked ? window.marked.parse(md || '*No notes for this slide.*') : escapeHtml(md);
      notesRendered.innerHTML = html;
    }
  }
  function saveEditorBuffer() {
    setCurrentNotes(notesEditor.value);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const editBtn = $('edit-toggle');
  editBtn.addEventListener('click', () => {
    state.editing = !state.editing;
    if (state.editing) {
      notesEditor.value = currentNotes();
      notesRendered.classList.add('hidden');
      notesEditor.classList.remove('hidden');
      notesEditor.focus();
      editBtn.textContent = 'Render notes';
      notesMode.textContent = 'editing';
    } else {
      saveEditorBuffer();
      notesEditor.classList.add('hidden');
      notesRendered.classList.remove('hidden');
      updateNotesView();
      editBtn.textContent = 'Edit notes';
      notesMode.textContent = 'rendered';
    }
  });
  // Live-save while typing so navigation never loses edits.
  notesEditor.addEventListener('input', () => {
    setCurrentNotes(notesEditor.value);
    refreshSlideRow(state.pageIndex);
  });

  // ---------- Download notes ----------
  $('download-notes').addEventListener('click', () => {
    if (state.editing) saveEditorBuffer();
    // Trim trailing empty slides we may have padded.
    const trimmed = state.notes.slice();
    while (trimmed.length > 1 && (trimmed[trimmed.length - 1] || '').trim() === '') trimmed.pop();
    const text = joinNotes(trimmed) + '\n';
    let name = state.notesName || 'notes.md';
    if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
    downloadText(name, text, 'text/markdown');
  });

  // ---------- Pointer tracking ----------
  // Send normalized (0..1) coordinates of the pointer over the slide canvas.
  const sendPointer = throttle((x, y, visible) => broadcastPointer(x, y, visible), 30);

  function pointerCoords(e) {
    const rect = currentCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  currentWrap.addEventListener('mousemove', (e) => {
    const c = pointerCoords(e);
    if (!c) {
      sendPointer(0, 0, false);
      return;
    }
    sendPointer(c.x, c.y, true);
  });
  currentWrap.addEventListener('mouseleave', () => {
    sendPointer(0, 0, false);
  });

  // ---------- Slide drawer / nav list ----------
  // Extract a title from a slide's notes: the first ATX-style markdown heading
  // (#..######) outside a fenced code block. Returns null if there is none.
  function extractTitle(md) {
    if (!md) return null;
    const lines = String(md).split('\n');
    let inFence = false;
    for (const raw of lines) {
      if (/^\s{0,3}(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
      if (m) return m[1].trim();
    }
    return null;
  }

  function buildSlideList() {
    slideList.innerHTML = '';
    for (let i = 1; i <= state.pageCount; i++) {
      const li = document.createElement('li');
      li.dataset.page = String(i);
      if (i === state.pageIndex) li.classList.add('active');

      const num = document.createElement('span');
      num.className = 'slide-num';
      num.textContent = String(i) + '.';

      const title = document.createElement('span');
      title.className = 'slide-title';
      const extracted = extractTitle(state.notes[i - 1]);
      if (extracted) {
        title.textContent = extracted;
      } else {
        title.textContent = `Slide ${i}`;
        title.classList.add('placeholder');
      }

      li.append(num, title);
      li.addEventListener('click', () => goToPage(i));
      slideList.appendChild(li);
    }
  }

  function refreshSlideRow(idx) {
    const li = slideList.querySelector(`li[data-page="${idx}"]`);
    if (!li) return;
    const titleEl = li.querySelector('.slide-title');
    const extracted = extractTitle(state.notes[idx - 1]);
    if (extracted) {
      titleEl.textContent = extracted;
      titleEl.classList.remove('placeholder');
    } else {
      titleEl.textContent = `Slide ${idx}`;
      titleEl.classList.add('placeholder');
    }
  }

  function updateSlideListActive() {
    const prev = slideList.querySelector('li.active');
    if (prev) prev.classList.remove('active');
    const cur = slideList.querySelector(`li[data-page="${state.pageIndex}"]`);
    if (cur) {
      cur.classList.add('active');
      // Keep the active slide visible if the list is scrolled.
      cur.scrollIntoView({ block: 'nearest' });
    }
  }

  const drawerBtn = $('toggle-drawer');
  drawerBtn.addEventListener('click', () => {
    const open = slideDrawer.classList.toggle('open');
    drawerBtn.classList.toggle('toggle-active', open);
  });
  $('close-drawer').addEventListener('click', () => {
    slideDrawer.classList.remove('open');
    drawerBtn.classList.remove('toggle-active');
  });

  // ---------- Maximize notes ----------
  maximizeBtn.addEventListener('click', () => {
    const maxed = presenterScreen.classList.toggle('notes-maximized');
    maximizeBtn.classList.toggle('toggle-active', maxed);
    maximizeBtn.textContent = maxed ? 'Restore notes' : 'Maximize notes';
    // Layout changed — re-render so canvases pick up the new size.
    renderCurrent();
  });

  // Clean up the audience window when this window closes.
  window.addEventListener('beforeunload', () => {
    if (state.audienceWin && !state.audienceWin.closed) state.audienceWin.close();
    channel.close();
  });

  // Initial state.
  updateStartEnabled();
})();
