# PaperInk — Private Cloud PDF & Ebook Reader
> Abstract: Nguoi Viet Nam thi rat la thich xai do mien phi `:)))`
Kindle-style reading + Zotero-style paper management + Obsidian-style notes.
A static web app (GitHub Pages) backed by Supabase: sign in with a username + password or with Google, and your private library — files, reading positions, highlights, notes, graph,vocabulary. Private by account - your library stays yours.

## Supported formats

| Format | Engine | Notes |
| --- | --- | --- |
| PDF | page engine (pdf.js) | original layout, text selection, margin trimming |
| EPUB | reflow engine (epub.js) | typography, pagination, CFI highlights |
| FB2 / FB2.ZIP, TXT, Markdown, HTML | converted to EPUB on import | reflowable with all EPUB features; FB2 footnotes become popups; TXT chapters detected (e.g. "Chapter", "Chương", "第…章"), encoding detected |
| CBZ / CBT comics | page engine | zoom, book mode, manga right-to-left, Pencil ink |

PaperInk targets **desktop browsers, phones and iPadOS** (installable PWA). Device features of dedicated e-readers (frontlight, e-ink refresh, SSH…) are out of scope.

## Features

- **PDF reader** (pdf.js): 
- **EPUB reader** (epub.js)
- **Themes**: Light, Paper, Sepia, E-Ink (no motion, no shadows, high contrast) and Dark.
- **E-ink screen modes** (whole app, PDF and EPUB alike; saved to your account):
  - E-Ink Mono: grayscale e-paper with e-ink contrast and instant page turns.
  - E-Ink Color: modelled on the E Ink Kaleido 3 panel (BOOX Tab Ultra C) — 4,096 colours (16 levels per R/G/B channel, matching its 16 gray levels) with ordered dithering instead of banding, pastel/soft colour (reduced saturation, hues preserved) on a neutral, non-emissive paper white.
- **Persistent reading state (synced)**: PDF page, scroll offset, zoom, mode and progress. EPUB CFI, chapter, page number (`Page 8 of 42`) and progress.
- **Highlights and notes (KOReader model)**: an annotation is a highlight with a style (*Lighten*, *Underline*, *Strikeout*, *Invert*), a colour and an optional note; *Note* on a selection highlights it and attaches the note. Highlight boxes are recomputed from the stored position on every page draw and taps are hit-tested against those boxes, so they stay on the text after font, zoom or page changes. Tapping a highlight with a note shows the note; otherwise the highlight menu (style, colour, note, copy, look up, delete). Overlapping highlights open a chooser with *Merge highlights*. Notes are marked by an underline, a side line or a side mark (setting). Note tags and highlight tags are kept separately; free notes (New note, handwriting, Graph) are unchanged.
- **Apple Pencil handwriting**
- **Book mode**: horizontal page turning with a page-flip or slide animation. Wide screens (16:9 / 16:10, iPad landscape) show two facing pages with an optional separate cover page. Comics can read right-to-left (manga).
- **Reading aids (inspired by KOReader)**:
  - *Trim margins*: automatic content-box detection for PDFs and comics.
  - *Bookmarks*: tap the top-right corner to dog-ear a page. Bookmarks and highlights appear as markers on the progress bar.
  - *Go back*: returns you to where you were before following a link, TOC entry or search result.
  - *Page browser*: thumbnails for PDFs and comics.
  - *Footnote popups* for EPUB/FB2.
  - *Look up*: Wiktionary dictionary, Wikipedia and translate. Lookups are fetched only on demand and kept in memory for the session.
  - *Vocabulary builder*: saved words keep their sentence, with spaced-repetition review.
  - *Reading statistics*: active reading time, an activity calendar and per-book speed.
  - *Status line*: time left in the chapter or book, clock, battery.
  - *Read aloud*: Web Speech API, turning pages automatically.
  - *Typography*: boldness, word spacing and page contrast.
- **Knowledge graph** (React Flow): paper, book, highlight, note and concept nodes. You can connect, drag, zoom and pan, search, filter by type and auto-arrange. Backlinks are built from `[[Concept]]` mentions. Opening a node returns to its source document or location.
- **Accounts and cloud sync**: Supabase Auth (username + password, or Google). Metadata and annotations live in Postgres, files in a private Storage bucket. Changes are written through a debounced, batched queue (with retry when offline) and other devices pick them up when the app regains focus. JSON backup of metadata and annotations, with merge import. Markdown export of highlights and notes.
- **PWA**: installable; the app shell loads offline. Your library needs a connection to load; documents opened in the current session stay readable and edits made offline are uploaded when you reconnect.

## Development

[RUNBOOK.md](./RUNBOOK.md)

--- 
***by @Riddle***


