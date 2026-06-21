# 🗣️ LinguaForge — AI Language Learning in the Browser

LinguaForge is a single-page web app (no build step, no server-side code) that
teaches **speaking, listening, reading and writing** in the language of your
choice, powered by AI models that you connect with your own API keys.

## Running it

It's a static site — any of these works:

```bash
# simplest: open directly in Chrome
open index.html            # macOS
xdg-open index.html        # Linux

# or serve it locally
python3 -m http.server 8080   # then visit http://localhost:8080
```

Chrome is recommended (the free fallback speech engine uses Chrome's Web
Speech API, and microphone capture is best supported there).

## Setup

1. Open the app — it asks for **your name** and the **language** you want to
   learn (pick from the list or define a custom language + BCP-47 code).
   All progress is stored **per user, per language** in the browser's
   localStorage, so several people (or several languages) can share a browser.
2. Click **⚙️ Settings** and paste:
   - **Anthropic API key** (required) — Claude (`claude-opus-4-8` by default)
     generates all phrases, texts, grammar lessons and grading.
   - **OpenAI API key** (recommended) — enables high-quality speech:
     `gpt-4o-mini-tts` speaks the language (with steerable slow/clear delivery
     for the "say it again slowly" step) and `gpt-4o-transcribe` recognizes
     your spoken repeats. These are currently the most suitable hosted models
     for multilingual spoken interaction. Without an OpenAI key the app falls
     back to Chrome's built-in (free) speech synthesis and recognition.

Keys are kept only in your browser's localStorage and sent only to
`api.anthropic.com` / `api.openai.com`.

## What it does

### 📊 Knowledge tracking
For each user + language the app tracks five skill dimensions — **grammar,
vocabulary, listening comprehension, pronunciation, reading comprehension** —
plus two word sets: **mastered** words and **learning** words. Every activity
feeds back into these scores, shown on the dashboard.

### 🎧 Listen & Repeat
The tutor speaks a phrase (text hidden by default — it's listening practice);
the microphone opens **automatically** when the phrase ends and recording
stops **by itself** when you fall silent (voice-activity detection on the mic
signal for the OpenAI engine; the Web Speech API does this natively). Click
the button only to cut a take short.

Scoring is character-level Levenshtein similarity on normalized text
(lowercase, punctuation and spaces stripped — so it works for unspaced
scripts too), with two tiers:
- **≥ 92 % — excellent**: next phrase AND the difficulty rises (about three
  excellents climb one level of the 1–10 ladder, from 2-word phrases to long
  native-level sentences).
- **≥ 75 % — good enough**: next phrase at the **same** level, so you stay at
  an appropriate difficulty until your repeats are consistently near-perfect.
- Below 75 % → the same phrase is repeated **slowly and carefully** (with the
  text and your transcript revealed so you can compare); miss again and you
  get a **simpler** phrase.

Both cutoffs are adjustable with sliders on the page (pass: 70–90 %,
excellent: 90–100 %), saved per user + language. After each take the original
phrase is revealed with your transcript right below it. **End session** stops
the loop whenever you're done.

Phrases are built preferentially from your mastered/learning words; new words
that appear are offered into your learning list, and learning words you repeat
successfully accumulate credit toward "mastered" (5 successes promotes a word).

### 📖 Reading
Generates a body of text built from your mastered + learning vocabulary. You
control the **length** and the **proportion of "learning" words**, and can set
a topic. Words outside your two lists appear in a **glossary before the text**.
**Click any word in the text** to add it to the glossary (word segmentation
uses `Intl.Segmenter`, so this works for Chinese/Japanese/Thai too); the
glossary has **Translate all** (one batched AI call), **Hide/Show** (practice
without peeking), **Clear**, and **add all → Learning** buttons. **Download
PDF** renders a print-formatted page and opens the browser's print dialog
("Save as PDF") — this route handles every script (CJK, Arabic, Cyrillic, …)
reliably. **Read aloud** speaks the text expressively; a status line below the
button always shows **which voice engine is actually in use** (and why, if a
fallback occurred).

### 📚 Vocabulary & Anki export
Manage both word sets (add single words, bulk-add lists — missing translations
are filled in by Claude), promote/demote/delete words, and export either list
as a **ready-to-import Anki deck (`.apkg`)**. Cards are word → translation +
an AI-written example sentence. The `.apkg` is built entirely in the browser
(sql.js + JSZip from a CDN); if the CDN is unreachable a TSV import file is
produced instead.

### 🌐 Interface in the target language
A checkbox in **⚙️ Settings** ("Show the interface in the language I'm
learning") localizes the whole UI — tab titles, buttons, instructions, and
feedback — into the language you're studying, for immersive practice. **French
is built in** (instant, works offline). For any other language the interface is
translated once by a single cached Claude call the first time you enable it,
then stored locally so it loads instantly afterwards. The setting is saved per
user + language, and English is always the fallback if a translation can't be
fetched.

### 🧩 Grammar course
Claude designs an ordered curriculum (~20 elements) of the language's grammar.
For each element it writes a lesson — an explanation plus example sentences
(each playable aloud) — and then **tests mastery** with multiple-choice,
fill-in-the-blank, and translation exercises; translations are graded by
Claude with feedback and a corrected version. Scoring ≥ 70 marks the element
mastered and unlocks the next one; grammar progress drives the grammar skill
score.

## Architecture notes

| Concern | Choice |
|---|---|
| Text generation / grading | Claude Messages API, structured outputs (JSON schema), called directly from the browser with the `anthropic-dangerous-direct-browser-access` header; model selectable in Settings (Opus 4.8 default). |
| Speaking voice | OpenAI `gpt-4o-mini-tts` (instructions steer language, pace and clarity); fallback `speechSynthesis`. |
| Speech recognition | OpenAI `gpt-4o-transcribe` on a MediaRecorder capture; fallback `webkitSpeechRecognition`. |
| Repeat scoring | Character-level Levenshtein similarity on normalized text (works for spaced and unspaced scripts alike); ≥ 80 % counts as a successful repeat. |
| Storage | `localStorage`, namespaced `linguaforge.profile.<user>.<language>`. |
| PDF | Browser print-to-PDF (full Unicode/script support). |
| Anki | Real `.apkg` (SQLite schema v11 via sql.js, zipped with JSZip); TSV fallback. |

No data ever leaves your machine except the API calls to Anthropic/OpenAI.

## Microphone permission notes

The app requests the microphone **once per session** and keeps the stream open
(you'll see Chrome's recording indicator while the tab is open). This matters
because Chrome **never remembers** mic permission for pages opened from
`file://` — without a persistent stream it would re-prompt on every recording.
If you serve the app from `http://localhost` or GitHub Pages (https), Chrome
offers "Allow on every visit" and remembers your choice permanently.
macOS also asks once per app (System Settings → Privacy & Security →
Microphone → Chrome) — that one is the OS, not the page.

## Troubleshooting voices

Settings has a **🔊 Test** button that speaks a sample and reports exactly
which engine produced it. In Reading, the line under "Read aloud" does the
same. If you expected OpenAI and see "browser speech synthesis", the message
includes the OpenAI error (bad key, no credit, rate limit…). OpenAI voices
(alloy, ash, coral, fable, nova, onyx, sage, shimmer) only differ when the
OpenAI engine is actually in use — the browser engine has its own OS voices.
