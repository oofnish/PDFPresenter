/* Shared helpers for the presenter and audience windows. */
(function (global) {
  'use strict';

  // pdf.js exposes its API on window.pdfjsLib when loaded from the CDN script.
  if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions) {
    global.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const CHANNEL_NAME = 'pdf-presenter';

  /**
   * Split a markdown notes file into an array of per-slide markdown strings.
   * Slides are separated by a line containing only `---` (3 or more dashes,
   * optional surrounding whitespace). This matches the reveal.js convention
   * and is unambiguous in plain markdown if you avoid horizontal rules in
   * your notes (use `***` instead if you need one).
   */
  function splitNotes(text) {
    if (text == null) return [''];
    const normalized = String(text).replace(/\r\n?/g, '\n');
    // Split on lines that are exactly `---` (or more dashes).
    const parts = normalized.split(/(?:^|\n)\s*-{3,}\s*(?=\n|$)/);
    // Trim only leading/trailing blank lines per section, preserve inner whitespace.
    return parts.map((p) => p.replace(/^\n+/, '').replace(/\n+$/, ''));
  }

  /** Join an array of per-slide notes back into a single markdown file. */
  function joinNotes(slides) {
    return slides.map((s) => (s == null ? '' : String(s))).join('\n\n---\n\n');
  }

  /** Render a pdf.js page into a canvas, scaled to fit the canvas's CSS box. */
  async function renderPageToCanvas(page, canvas) {
    const wrap = canvas.parentElement;
    const dpr = global.devicePixelRatio || 1;
    const cssW = Math.max(1, wrap.clientWidth);
    const cssH = Math.max(1, wrap.clientHeight);

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(cssW / baseViewport.width, cssH / baseViewport.height);
    const viewport = page.getViewport({ scale: scale * dpr });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
    canvas.style.height = Math.floor(viewport.height / dpr) + 'px';

    const ctx = canvas.getContext('2d');
    // Cancel any in-flight render on this canvas.
    if (canvas.__renderTask) {
      try { canvas.__renderTask.cancel(); } catch (_) { /* ignore */ }
    }
    const task = page.render({ canvasContext: ctx, viewport });
    canvas.__renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') throw err;
    }
  }

  /** Trigger a browser download of a text blob. */
  function downloadText(filename, text, mime = 'text/markdown') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Throttle a function to fire at most every `ms` milliseconds (trailing call). */
  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    let pendingArgs = null;
    return function (...args) {
      const now = Date.now();
      const remaining = ms - (now - last);
      pendingArgs = args;
      if (remaining <= 0) {
        last = now;
        fn.apply(this, pendingArgs);
        pendingArgs = null;
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          if (pendingArgs) {
            fn.apply(this, pendingArgs);
            pendingArgs = null;
          }
        }, remaining);
      }
    };
  }

  global.PDFPresenter = {
    CHANNEL_NAME,
    splitNotes,
    joinNotes,
    renderPageToCanvas,
    downloadText,
    throttle,
  };
})(window);
