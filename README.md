# PDF Presenter

A tiny zero-build PDF presentation framework — just static HTML and JavaScript.
Run it locally by opening `index.html` from a local web server, or publish the
folder as-is to GitHub Pages, GitLab Pages, or any static host.

## Features

- **Two-window setup** — a presenter window and a separate audience window you
  drag onto a projector / second monitor.
- **Drag &amp; drop upload** of a PDF and (optionally) a speaker-notes markdown
  file on the landing screen.
- **Keyboard / click navigation** — `Space`, `→`, `PageDown`, or clicking the
  slide advance; `←` / `PageUp` go back; `Home` / `End` jump to the ends.
- **Live notes for the current slide** rendered as markdown, with an
  *Edit notes* toggle to switch into a plain-text editor.
- **Edits persist while you navigate** and can be saved with **Download notes**
  as a single markdown file.
- **Laser-pointer mirror** — when you move the mouse over the current slide in
  the presenter view, a red highlight follows your cursor on the audience view
  so you can point at things naturally.

## Quick start

```bash
# Any static file server works. For example:
python3 -m http.server 8080
# then open http://localhost:8080/ in a modern browser.
```

> Tip: opening `index.html` directly from the filesystem may work but some
> browsers restrict `BroadcastChannel` and pdf workers under the `file://`
> scheme — using a static server is recommended.

Once the upload screen appears:

1. Drop or pick a `.pdf` (required) and a `.md` notes file (optional).
2. Click **Start presenting**. A second window opens — drag it to your
   external display and press `F11` for fullscreen.
3. Present. Use the arrow keys / space / clicks to advance.
4. Edit notes inline if needed, then **Download notes** at the end to save
   your changes.

## Notes file format

A single markdown file. Notes for each slide are separated by a line
containing only `---`:

```markdown
Notes for slide 1. **Markdown** is rendered.

---

Notes for slide 2.

- Bullet points work
- So do `code spans`

---

Notes for slide 3.
```

If the notes file has fewer sections than the PDF has pages the extra slides
simply have empty notes. If you need a literal horizontal rule inside your
notes, use `***` instead of `---`.

## Hosting on GitHub Pages

1. Push this repository.
2. In **Settings → Pages**, set the source to the `main` branch, root folder.
3. Open `https://<user>.github.io/<repo>/`.

GitLab Pages: add a one-line `.gitlab-ci.yml` that copies the repo into
`public/`, or use the built-in static-site template.

## Browser support

Modern Chromium / Firefox / Safari. Requires `BroadcastChannel` and the
HTML5 `File` and `Canvas` APIs.

## Dependencies

Loaded from public CDNs — no build step:

- [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 for PDF rendering.
- [marked](https://marked.js.org/) for markdown rendering.

If you need fully-offline operation, download those scripts into a local
`vendor/` folder and update the `<script src>` paths in `index.html` and
`audience.html`.
