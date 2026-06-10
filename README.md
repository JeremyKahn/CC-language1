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
you repeat it into the microphone.
- Repeat it correctly → a new, slightly harder phrase (difficulty 1–10 ramps
  from 2-word phrases to long native-level sentences).
- Miss it → the same phrase is repeated **slowly and carefully**.
- Miss it again → you get a **simpler** phrase.

Phrases are built preferentially from your mastered/learning words; new words
that appear are offered into your learning list, and learning words you repeat
successfully accumulate credit toward "mastered" (5 successes promotes a word).

### 📖 Reading
Generates a body of text built from your mastered + learning vocabulary. You
control the **length** and the **proportion of "learning" words**, and can set
a topic. Words outside your two lists appear in a **glossary before the text**
(one click adds them all to your learning list). **Download PDF** renders a
print-formatted page and opens the browser's print dialog ("Save as PDF") —
this route handles every script (CJK, Arabic, Cyrillic, …) reliably. You can
also have the text read aloud.

### 📚 Vocabulary & Anki export
Manage both word sets (add single words, bulk-add lists — missing translations
are filled in by Claude), promote/demote/delete words, and export either list
as a **ready-to-import Anki deck (`.apkg`)**. Cards are word → translation +
an AI-written example sentence. The `.apkg` is built entirely in the browser
(sql.js + JSZip from a CDN); if the CDN is unreachable a TSV import file is
produced instead.

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
