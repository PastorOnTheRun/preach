# Preach — sermon delivery app (v1.2)

A calm, offline-capable **preaching mode** for the Family Church (Windermere, FL) student teaching team.
Static PWA: plain HTML/CSS/vanilla JS (ES modules), no build step, no backend. Ready for GitHub Pages.

## Run locally
```bash
cd preach-app
python3 -m http.server 8765        # then open http://localhost:8765
```
(Service worker, microphone and wake lock need `http://localhost` or HTTPS — not `file://`.)

## Features
- **Load**: paste (keeps headings / bold / italics / lists from Word, Google Docs, Pages, Notes), or open `.docx` (mammoth.js, bundled in `vendor/`), `.txt`, `.md`. Autosaves to localStorage; simple library of saved sermons.
- **Preaching view**: full-screen, paginated into screen-sized pages (CSS columns). Big Previous/Next buttons, tap left/right third, swipe, mouse wheel, arrow keys, Space/Shift+Space, PageUp/PageDown, Home/End (Bluetooth page-turner pedals). "Page X of Y" + tap it to jump. Screen Wake Lock. Reading position remembered per sermon.
- **Text size** A−/A+ (repaginates and keeps your place), **dark/light** toggle, serif/sans option.
- **Countdown timer**: presets 20/25/30/35/40 + custom, start/pause/reset, yellow/orange warnings (default 5 and 2 min), overtime counts up (`+1:23`) and a thick red border pulses at 1 Hz. Survives refresh.
- **Verse popups (CSB only)**: references like `John 3:16`, `Rom 8:28-30`, `1 Cor 13:4-7`, `Psalm 23`, `Jude 24` become tappable. With an API.Bible key the CSB text shows in a popup (with the required copyright line + FUMS reporting); without a key, the popup offers a one-tap link to BibleGateway with `version=CSB`.
- **Recording**: MediaRecorder → IndexedDB in 4-second chunks (crash-safe; unfinished recordings are recovered on next launch). Optional "record when timer starts". After stopping: play, Download, Share/Save to Files (iOS), and **Send for feedback** → `sendForFeedback(audioBlob, metadata)` in `js/feedback.js` uploads to Supabase Storage + a `recordings` row when signed in (AI grading/email = Phase 2 Edge Function TODO).

## Verse lookup setup (API.Bible)
1. Create a free account at https://api.bible (Starter plan: free, non-commercial, 5,000 calls/month, up to 3 copyrighted Bibles).
2. Create an app and add **Christian Standard Bible (CSB)** — Bible ID `a556c5305ee15c3f-01`.
3. Paste the key in **Settings → Bible verse popups** and tap **Test key** (or set `apiBibleKey` in `config.js` for the whole team — note it becomes public on GitHub Pages).

Only the CSB Bible ID is ever requested; no verse text is bundled or cached beyond the current session.

## Accounts, sync & admin review (Supabase)
- Leave `supabaseUrl`/`supabaseAnonKey` empty in `config.js` → app is local-only exactly as v1.
- Fill them in (see **SETUP.md**) → preachers can sign in with an emailed link or 6-digit code, or email + password. Sign-in is optional; the app always works offline/signed out.
- Storage is local-first (`js/storage.js`); `js/sync.js` syncs each preacher's sermons (title, content, timer settings, last page) to `public.sermons`. Conflicts: last write wins (content and reading position separately). Deletes are soft deletes so other devices learn about them.
- Sermons written while signed out are claimed by the first account that signs in on that device.
- Admins (`profiles.role = 'admin'`) get a **Review** button → `review.html`: every preacher's recordings and sermons, newest first, filter by preacher, audio via 1-hour signed URLs, read-only manuscript, transcript/summary/grade when present.
- Security is enforced by Row Level Security in `supabase/schema.sql`, not by the UI.

## Big screen (projector) mode
- Open **`screen.html`** on the projector/TV computer (e.g. https://pastorontherun.github.io/preach/screen.html). It shows only a neutral “Waiting to connect” screen with a masked code box.
- On the preacher’s iPad: **Settings › Big screen** → turn on → **Show code** (hidden by default, auto-hides after 30 s) → type it on the projector. After pairing the code is never shown on the big screen; it reconnects by itself after a reload.
- Slides are generated automatically from the sermon: the title, every heading, every **highlighted** passage (Word/Google Docs highlighter in .docx or pasted text, `==marked==` text) and every blockquote. Blockquotes that start with “Note:”, “Pause…”, “Reminder”, “Tip” or “[…]” are treated as stage notes and never shown.
- While preaching, the screen follows your page turns (first slide on the page, else the last one before it). The **slide strip** (monitor button in the top bar) lets you tap any slide. **Black screen** button (or the **B** / **.** key) blanks the projector. In a verse popup with CSB text, **Show on screen** sends that passage with its CSB copyright line.
- Pairing uses a Supabase Realtime broadcast channel named after the code; only the current slide (kind, text, optional citation/copyright) is ever sent — never the manuscript, timer, notes or the code.

## Design
Matches Jake’s Stage Ready app (PastorOnTheRun/stage-ready): warm off-white dotted-grid backdrop (#f3f2ef), crisp white cards with thin borders and 4–6 px corners, brand orange #FF7010 with near-black #141110, Archivo Wide headings (SIL OFL, `fonts/`), small uppercase monospace labels, orange primary buttons with dark text, black/orange “blocks”. Dark mode uses Stage Ready’s dark stage palette. The manuscript stays in a serif reading face; the overtime frame stays red.

## Tests
```
python3 -m http.server 8765 --bind 127.0.0.1 &
/workspace/venv/bin/python tests/e2e.py           # core app (64 checks)
/workspace/venv/bin/python tests/accounts_e2e.py  # accounts/sync/review with mocked Supabase (41 checks)
/workspace/venv/bin/python tests/screen_e2e.py    # slide extraction + big-screen pairing with mocked Realtime
/workspace/venv/bin/python tests/style_shots.py   # style-*.png screenshots
```

## Files
```
index.html              app shell (views + dialogs)
css/app.css             all styles (light/dark, responsive, overtime border)
js/app.js               UI wiring
js/paginator.js         column pagination + position anchoring
js/timer.js             countdown/overtime timer
js/bible.js             reference parser, API.Bible (CSB) client, BibleGateway fallback, FUMS
js/recorder.js          MediaRecorder + IndexedDB storage/recovery
js/feedback.js          sendForFeedback() — uploads recording to Supabase (grading = Phase 2 TODO)
js/cloud.js             Supabase client (lazy-loaded), auth (magic link/code/password), remote, admin queries
js/sync.js              local-first sync engine (pull → push, last-write-wins)
js/review.js + review.html  admin review page
js/slides.js            slide extraction (headings, highlights, quotes, verses)
js/screenlink.js        Realtime broadcast link + pairing codes
screen.html + js/screen.js + css/screen.css  projector page
fonts/                  Archivo Wide (SIL OFL)
vendor/supabase.js      supabase-js 2.117.2 (UMD, MIT)
supabase/schema.sql     tables, RLS, storage bucket + policies, signup trigger
SETUP.md                step-by-step Supabase setup for Jake
tests/accounts_e2e.py   Playwright tests with a mocked Supabase (tests/mock-supabase.js)
js/format.js            paste/HTML sanitizer, txt/md converter, docx import
js/storage.js           localStorage settings/library/state
js/sample.js            sample sermon
config.js               team config: supabaseUrl, supabaseAnonKey, apiBibleKey
sw.js, manifest.webmanifest, icons/   PWA
vendor/mammoth.browser.min.js         mammoth 1.13.0 (BSD-2)
tests/e2e.py            Playwright end-to-end test (64 checks), tests/fixtures/
screenshots/            output of the test run
```

## Deploying (GitHub Pages)
Live at https://pastorontherun.github.io/preach/ (repo PastorOnTheRun/preach, Pages from `main` at root).
Push this folder as the site root; all paths are relative so a `/<repo>/` subpath works. Bump `VERSION` in `sw.js` on each release.
