/* Audience window: receives PDF + page + pointer messages, renders fullscreen. */
(function () {
  'use strict';
  const { CHANNEL_NAME, renderPageToCanvas } = window.PDFPresenter;

  const canvas = document.getElementById('audience-canvas');
  const status = document.getElementById('audience-status');
  const pointer = document.getElementById('audience-pointer');
  const stage = document.getElementById('audience-stage');

  let pdfDoc = null;
  let currentPage = 1;
  let pendingPage = null; // page requested before pdf finished loading

  const channel = new BroadcastChannel(CHANNEL_NAME);

  channel.addEventListener('message', async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'pdf') {
      status.textContent = 'Loading slides…';
      try {
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(msg.buffer) });
        pdfDoc = await loadingTask.promise;
        status.classList.add('hidden');
        const target = pendingPage ?? currentPage;
        pendingPage = null;
        await showPage(target);
      } catch (err) {
        status.classList.remove('hidden');
        status.textContent = 'Failed to load slides: ' + (err && err.message ? err.message : err);
      }
    } else if (msg.type === 'page') {
      const n = Number(msg.page) || 1;
      if (!pdfDoc) {
        pendingPage = n;
      } else {
        await showPage(n);
      }
    } else if (msg.type === 'pointer') {
      updatePointer(msg.x, msg.y, !!msg.visible);
    }
  });

  async function showPage(n) {
    if (!pdfDoc) return;
    const clamped = Math.max(1, Math.min(pdfDoc.numPages, n));
    currentPage = clamped;
    const page = await pdfDoc.getPage(clamped);
    await renderPageToCanvas(page, canvas);
  }

  function updatePointer(x, y, visible) {
    if (!visible || !canvas.width) {
      pointer.classList.add('hidden');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const px = rect.left - stageRect.left + x * rect.width;
    const py = rect.top - stageRect.top + y * rect.height;
    pointer.style.left = px + 'px';
    pointer.style.top = py + 'px';
    pointer.classList.remove('hidden');
  }

  // Re-render on resize so the slide always fills the audience screen.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!pdfDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => showPage(currentPage), 100);
  });

  // Announce ourselves so the presenter (re)sends the PDF and current page.
  channel.postMessage({ type: 'audience-hello' });

  window.addEventListener('beforeunload', () => channel.close());
})();
