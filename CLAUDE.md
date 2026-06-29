# CLAUDE.md — LinguaForge

Guidance for the next agent (and the human) working on this app.

## What this is

**LinguaForge** is a single-page, **no-build, static web app** (plain
HTML/CSS/vanilla JS) that teaches a language the user picks, covering speaking,
listening, reading, writing, vocabulary, and grammar. All AI features use the
**user's own API keys**, entered in Settings and stored only in their browser.

- **Text generation / grading:** Anthropic Claude (Messages API), called
  directly from the browser. Default model `claude-opus-4-8` (changeable in
  Settings). Uses structured outputs (JSON schema) heavily.
- **Speech:** OpenAI `gpt-4o-mini-tts` (speaking) + `gpt-4o-transcribe`
  (recognition) when an OpenAI key is set; otherwise the browser's free Web
  Speech API (`speechSynthesis` / `webkitSpeechRecognition`). These OpenAI
  models were chosen as the most suitable hosted models for multilingual spoken
  interaction.

There is **no server and no build step.** Open `index.html`, or serve the
folder statically.

## Running it

```bash
# from the repo root
python3 -m http.server 8080   # then open http://localhost:8080
```

Open in **Chrome**. Serving over `http://localhost` (or GitHub Pages, https) is
strongly preferred over `file://` because Chrome won't persist microphone
permission for `file://` pages (we work around it by holding one mic stream open
for the whole session — see Speech below — but localhost is cleaner).

## Where data lives (NOT in the repo)

All per-user state is in the **browser's `localStorage`**, created as the user
uses the app. Keys (see `js/storage.js`):

- `linguaforge.app` — global: user list, current user+language, Settings
  (API keys, model, speech engine, voice, `uiInLang` toggle).
- `linguaforge.profile.<user>.<language>` — one per user+language: skill
  scores, mastered/learning word lists, Listen & Repeat level + cutoffs,
  grammar curriculum + progress, reading session count.
- `linguaforge.i18n.<language>` — cached AI translation of the UI for
  non-built-in interface languages.

localStorage is per-browser **and per-origin**, so `file://`, `localhost:8080`,
and GitHub Pages each have separate buckets (this often looks like "my progress
vanished" — it's just a different origin). There is no cross-device sync and no
export/import yet (a natural next feature).

## File layout

```
index.html        Markup for all 5 views + 2 modals. Asset <link>/<script> tags
                  carry a ?v=N cache-buster (see "Caching" below).
css/style.css     All styling. Warm serif theme.
js/storage.js     Store: localStorage persistence, LANGUAGES list, profile
                  schema/defaults, skill-update helpers.
js/ai.js          AI: Claude Messages API client (raw fetch, browser header,
                  retries, JSON-schema structured output). AI.call(), AI.translateWords().
js/i18n.js        I18N: optional UI localization. Canonical EN table + built-in
                  FR; other languages translated once by Claude and cached.
js/speech.js      Speech: TTS (speak), recognition (listen), VAD auto-stop,
                  similarity scoring, mic-stream management.
js/anki.js        AnkiExport: builds a real .apkg (sql.js + JSZip from CDN);
                  TSV fallback if CDN unreachable.
js/vocab.js       Vocab: mastered/learning word sets, AI translate, Anki export.
js/listen.js      Listen: "Listen & Repeat" mode.
js/reading.js     Reading: AI text generation, glossary, PDF, and the
                  sentence-by-sentence repeat drill (the most-iterated feature).
js/grammar.js     Grammar: AI curriculum, lessons, exercises (incl. AI-graded
                  translation).
js/app.js         App: navigation, session (user+language), Settings/profile
                  modals, dashboard, toast/busy helpers, init.
README.md         User-facing documentation.
```

Each JS file is an IIFE exposing one global object (`Store`, `AI`, `I18N`,
`Speech`, `AnkiExport`, `Vocab`, `Listen`, `Reading`, `Grammar`, `App`). Script
load order in `index.html` matters (storage → ai → i18n → speech → … → app).

## The five views

1. **Dashboard** — five skill bars (grammar, vocabulary, listening
   comprehension, pronunciation, reading comprehension) + stat cards.
2. **Listen & Repeat** — tutor speaks a phrase (text blurred); mic auto-opens
   and auto-stops; learner repeats. Difficulty 1–10. Two user-adjustable
   cutoffs: **pass** (70–90%, default 75 → new phrase, same level) and
   **excellent** (90–100%, default 92 → level up). Up to 3 tries per phrase
   (normal, normal, slow), then a simpler phrase. End-session button finishes
   the current phrase then stops.
3. **Reading** — generate a text from the user's vocabulary (length + share of
   "learning" words + topic). Words outside both vocab sets go in a glossary
   shown before the text; clickable words add to the glossary; Translate-all /
   Hide / Clear / add-all-to-Learning. **PDF** via browser print-to-PDF (handles
   all scripts). **Read aloud** shows which voice engine is actually used.
   **Repeat sentence by sentence** drill — see below.
4. **Vocabulary** — manage mastered/learning sets (single + bulk add with AI
   translation); export either list as an Anki `.apkg`.
5. **Grammar** — AI builds a sequenced curriculum; each element has a lesson
   (explanation + playable examples) and a quiz (multiple-choice, fill-blank,
   AI-graded translation). ≥70 marks an element mastered and unlocks the next.

## The reading "Repeat sentence by sentence" drill (read this before touching it)

This is the most heavily iterated feature; its behavior is intentional:

- It is a **listening** drill: the whole reading text is rendered as
  per-sentence spans, all **masked** (blurred via `filter: blur` — chosen over
  transparent-text so the **Dark Reader** extension can't undo it).
- For each sentence: read the **whole sentence once**. If the repeat passes, the
  sentence **un-blurs in place** (with a brief flash + scroll) and it moves on.
- If missed, Claude **breaks the sentence into phrases** (`breakIntoPhrases`),
  target **4–8 words** each (AI prompt + a greedy `mergePhrases` pass that
  combines adjacent phrases up to 8 words). A sentence ≤8 words is repeated
  whole, not split. Each phrase gets **up to 3 attempts**: first two normal
  speed, the third "gentle" (slightly slower — a distinct speech mode from the
  very-slow one). Each phrase reveals in place when done.
- **Feedback is in the text, not a panel:** on reveal, words the learner missed
  are shown **bold**; if the repeat was nowhere near (`score < NEAR`, 0.4) the
  whole unit is bold. The only bottom-panel elements are a status line
  (sentence/phrase counter + recording state) and the **transcript** ("You
  said: …", shown after every attempt) plus the end summary.
- **No artificial delays** between transcribing a repeat and the next phrase
  (the user explicitly wanted this). The transcript persists (not cleared at the
  start of the next attempt) so it's visible after each try.
- Summary: % of sentences repeated satisfactorily on the first whole-sentence
  try, and average full-sentence match.

## Speech subsystem notes (`js/speech.js`)

- `engine()` picks OpenAI vs browser from Settings (`auto` = OpenAI if key set).
- `speak(text, {slow})` — `slow` is `false` | `true` (very slow/careful) |
  `"gentle"` (a little slower). OpenAI path chunks text under the 4096-char TTS
  limit and steers pace/expressiveness via `instructions`. Long TTS failures
  surface to the user (never silently fall back without telling them); the
  Reading "Read aloud" status line reports the engine actually used.
- `listen({onStatus, prompt})` — auto-records and auto-stops. **VAD**
  (voice-activity detection via WebAudio RMS over a calibrated noise floor) ends
  the take after ~1.4s of silence for the OpenAI engine; the Web Speech engine
  stops natively. Returns `{stop, cancel, result}`; `result` resolves to the
  transcript or `null` if cancelled.
- **Microphone:** one stream is acquired and **kept open for the whole session**
  (`getMicStream`), because Chrome never persists mic permission for `file://`
  pages and would otherwise re-prompt on every recording. Released on `pagehide`.
- **STT priming:** the transcriber is told the **language** (ISO code) and, in
  the reading drill, given a **`prompt`** of nearby context (previous sentence +
  already-completed phrases) to bias spelling/vocabulary. The current target is
  **deliberately excluded** from the prompt so the recognizer can't just echo
  the expected answer (which would cause false passes).
- **Scoring (`similarity`)** — character-level Levenshtein on normalized text
  (lowercased, punctuation stripped, spaces removed so it works for unspaced
  scripts like Japanese/Chinese). Returns 0–1.
- Reading-drill grading (`gradeUnit` in `reading.js`) is more lenient than raw
  similarity: it takes `max(charSimilarity, wordRecall)` and passes if **every
  expected word is present** OR the combined score clears the cutoff. Word
  matching **folds diacritics** (café == cafe) because STT frequently drops
  accents — this fixed short phrases falsely failing. If you make grading
  stricter, expect short-phrase false-negative complaints to return.

## i18n (`js/i18n.js`)

- One canonical English table `EN` is the source of truth. Static UI strings are
  tagged in HTML with `data-i18n` (textContent), `data-i18n-ph` (placeholder),
  `data-i18n-title` (title). Dynamic strings call `I18N.t(key, {vars})` with
  `{placeholder}` interpolation.
- **French (`FR`) is built-in** (hand-checked). Any other language is translated
  once by a single cached Claude call, stored in `localStorage`, English as
  fallback. Toggle: Settings → "Show the interface in the language I'm learning"
  (`settings.uiInLang`), saved per user+language; re-applied on language switch.
- **Keep EN and FR in parity.** When adding a string, add it to both, add the
  `data-i18n*` tag or `t()` call, and don't put `data-i18n` on a `<label>` that
  contains an input (it would wipe the input via textContent) — wrap the label
  text in a `<span>`.

## Conventions & gotchas

- **Cache-busting:** `index.html` has a no-cache meta tag and every CSS/JS
  include carries `?v=N`. **Bump N (sed `s/?v=OLD/?v=NEW/g`) on every change to
  CSS/JS**, or the user (running `python3 -m http.server`, which sends no cache
  headers) will keep seeing stale files. Several "it's broken" reports were
  actually stale-cache; bumping the version fixes it on a normal reload.
- **Claude API usage:** `AI.call({system, user, schema, maxTokens, thinking})`.
  Use `schema` (JSON Schema) for structured output — it sets
  `output_config.format` and returns parsed JSON. `thinking: true` enables
  adaptive thinking. Model is `claude-opus-4-8`; structured outputs +
  `anthropic-dangerous-direct-browser-access` header. Do NOT use prefills or
  `temperature`/`budget_tokens` (removed on current Opus). When working on any
  Claude-API code, consult the bundled `claude-api` skill rather than guessing.
- **Validate before pushing:** `for f in js/*.js; do node --check "$f"; done`.
  There's a small node check in history for i18n key coverage / EN-FR parity.
- **Model identity:** never put the model ID string in commits/PRs/code
  comments (chat only).

## Git workflow

- Develop on branch **`claude/funny-maxwell-sxgs49`**. `main` also exists
  (mirrors the latest as of the last sync). The repo's **default branch on
  GitHub may still be `claude/funny-maxwell-sxgs49`** — the human may switch it
  to `main` in repo Settings.
- **Pushing has been unreliable from inside the session:** the git proxy and the
  GitHub MCP/app token have repeatedly returned 403 for writes (reads work).
  The working method has been a **user-supplied fine-grained PAT** pushed
  directly:
  ```
  git push "https://x-access-token:<PAT>@github.com/JeremyKahn/CC-language1.git" \
    claude/funny-maxwell-sxgs49:claude/funny-maxwell-sxgs49
  ```
  Ask the human for a fresh PAT (Contents: Read and write on CC-language1) if
  pushes 403; remind them to delete it afterward. Commit signing occasionally
  returns a transient 503 — just retry the commit.

## Ideas / likely next requests

- Export/Import of `linguaforge.*` for portability across devices/origins.
- Stricter, order-aware (alignment) word-diff for the reading drill feedback.
- Per-language tuning of VAD silence window and grading leniency.
- Make `main` the default branch and/or auto-sync `main` with the dev branch.
