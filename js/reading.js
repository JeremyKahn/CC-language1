/* reading.js — Generate a body of text from the learner's vocabulary, with a
 * glossary of unknown words shown before the text, and PDF download.
 * Words in the text are clickable: a click adds the word to the glossary. */
"use strict";

const Reading = (() => {
  let lastResult = null; // {title, glossary, text, learning_words_used}
  let glossaryHidden = false;

  async function generate() {
    const lang = Store.app.language.name;
    const p = Store.profile;
    const length = +document.getElementById("rd-length").value;
    const ratio = +document.getElementById("rd-ratio").value;
    const topic = document.getElementById("rd-topic").value.trim();

    const mastered = Object.keys(p.vocab.mastered);
    const learning = Object.keys(p.vocab.learning);

    App.busy("Writing your text…");
    try {
      const out = await AI.call({
        system:
          `You write reading-practice texts in ${lang} for a language learner. ` +
          `The text must be natural, correct ${lang} — engaging, with a beginning and an end.`,
        user:
          `Write a text of about ${length} words in ${lang}.` +
          (topic ? ` Topic: ${topic}.` : " Pick an interesting everyday topic or short story.") +
          `\n\nVocabulary constraints:\n` +
          (mastered.length
            ? `- The learner has MASTERED these words — build the text mainly from them (plus function words at a similar level): ${mastered.join(", ")}\n`
            : `- The learner is a beginner with no recorded vocabulary; use simple, high-frequency vocabulary.\n`) +
          (learning.length
            ? `- About ${ratio}% of the content words should come from the LEARNING list: ${learning.join(", ")}\n`
            : "") +
          `- You may use words outside both lists when needed for a natural text, but EVERY such word that an ` +
          `intermediate learner might not know must appear in the glossary (dictionary form + short English translation).\n` +
          `- Also report which LEARNING-list words you actually used, in learning_words_used.\n` +
          `Give the text a short title in ${lang}.`,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            glossary: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  word: { type: "string" },
                  translation: { type: "string" },
                },
                required: ["word", "translation"],
                additionalProperties: false,
              },
            },
            text: { type: "string" },
            learning_words_used: { type: "array", items: { type: "string" } },
          },
          required: ["title", "glossary", "text", "learning_words_used"],
          additionalProperties: false,
        },
        maxTokens: 16000,
        thinking: true,
      });

      lastResult = out;
      glossaryHidden = false;
      render(out);
      p.reading.sessions++;
      Store.saveProfile();
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  function render(out) {
    stopPractice(); // a new text invalidates any in-progress practice
    document.getElementById("rd-practice-panel").classList.add("hidden");
    document.getElementById("rd-practice-summary").classList.add("hidden");
    document.getElementById("rd-output").classList.remove("hidden");
    document.getElementById("rd-pdf").classList.remove("hidden");
    document.getElementById("rd-listen").classList.remove("hidden");
    document.getElementById("rd-title").textContent = out.title;
    renderGlossary();
    renderText(out.text);
    document.getElementById("rd-output").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------------- glossary ---------------- */

  function inGlossary(word) {
    const n = Speech.normalize(word);
    return lastResult.glossary.some((g) => Speech.normalize(g.word) === n);
  }

  function renderGlossary() {
    const table = document.getElementById("rd-glossary");
    table.innerHTML = "";
    for (const g of lastResult.glossary) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      const td3 = document.createElement("td");
      td1.textContent = g.word;
      td2.textContent = g.translation || "—";
      td3.className = "gloss-ops";
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Remove from glossary";
      del.onclick = () => {
        lastResult.glossary = lastResult.glossary.filter((x) => x !== g);
        renderGlossary();
        markGlossaryWords();
      };
      td3.appendChild(del);
      tr.append(td1, td2, td3);
      table.appendChild(tr);
    }
    const empty = !lastResult.glossary.length;
    table.classList.toggle("hidden", glossaryHidden || empty);
    document.getElementById("rd-gloss-empty").classList.toggle("hidden", !empty);
    document.getElementById("rd-gloss-toggle").textContent = glossaryHidden ? "👁 Show" : "🙈 Hide";
  }

  function addGlossaryWord(word) {
    if (!word || inGlossary(word)) return;
    lastResult.glossary.push({ word, translation: "" });
    if (glossaryHidden) {
      glossaryHidden = false; // adding a word implies wanting to see the list
    }
    renderGlossary();
    markGlossaryWords();
  }

  async function translateGlossary() {
    const missing = lastResult.glossary.filter((g) => !g.translation).map((g) => g.word);
    if (!missing.length) return App.toast("All glossary words already have translations.");
    App.busy(`Translating ${missing.length} word${missing.length > 1 ? "s" : ""}…`);
    try {
      // one batched AI call for all untranslated words
      const map = await AI.translateWords(missing, Store.app.language.name);
      for (const g of lastResult.glossary) {
        if (!g.translation) {
          g.translation = map[g.word] || map[Object.keys(map).find(
            (k) => Speech.normalize(k) === Speech.normalize(g.word)
          )] || "";
        }
      }
      renderGlossary();
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  function toggleGlossary() {
    glossaryHidden = !glossaryHidden;
    renderGlossary();
  }

  function clearGlossary() {
    lastResult.glossary = [];
    renderGlossary();
    markGlossaryWords();
  }

  /* ---------------- text rendering (clickable words) ---------------- */

  function segments(text) {
    // Intl.Segmenter handles unspaced scripts (Chinese, Japanese, Thai…)
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(Store.app.language.bcp, { granularity: "word" });
      return Array.from(seg.segment(text)).map((s) => ({
        text: s.segment,
        isWord: !!s.isWordLike,
      }));
    }
    return text.split(/(\s+)/).map((t) => ({ text: t, isWord: /\S/.test(t) }));
  }

  function renderText(text) {
    const el = document.getElementById("rd-text");
    el.innerHTML = "";
    for (const s of segments(text)) {
      if (s.isWord) {
        const span = document.createElement("span");
        span.className = "w-click";
        span.textContent = s.text;
        span.title = "Click to add to glossary";
        span.onclick = () => addGlossaryWord(s.text);
        el.appendChild(span);
      } else {
        el.appendChild(document.createTextNode(s.text));
      }
    }
    markGlossaryWords();
  }

  function markGlossaryWords() {
    const set = new Set(lastResult.glossary.map((g) => Speech.normalize(g.word)));
    document.querySelectorAll("#rd-text .w-click").forEach((span) => {
      span.classList.toggle("in-gloss", set.has(Speech.normalize(span.textContent)));
    });
  }

  /* ---------------- read aloud + engine status ---------------- */

  function showEngine(info) {
    const el = document.getElementById("rd-voice-status");
    if (!info) {
      el.textContent = "";
      return;
    }
    let msg =
      info.engine === "openai"
        ? `Voice in use: OpenAI gpt-4o-mini-tts — “${info.voice}”`
        : `Voice in use: browser speech synthesis — “${info.voice}”`;
    if (info.fallback) msg += ` (fell back from OpenAI: ${info.fallback})`;
    el.textContent = msg;
  }

  function readAloud() {
    if (!lastResult) return;
    document.getElementById("rd-voice-status").textContent = "Preparing audio…";
    Speech.speak(lastResult.text, { onEngine: showEngine }).catch((e) => {
      showEngine(null);
      App.toast(e.message);
    });
  }

  /* ---------------- PDF ---------------- */

  /* PDF download: render a print-formatted page and invoke the browser's
   * print-to-PDF. This handles every script (CJK, Arabic, Cyrillic…) that a
   * client-side PDF library with embedded Latin fonts cannot. */
  function downloadPdf() {
    if (!lastResult) return;
    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const glossRows = lastResult.glossary
      .map((g) => `<tr><td><b>${esc(g.word)}</b></td><td>${esc(g.translation || "—")}</td></tr>`)
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(lastResult.title)}</title>
<style>
  body { font-family: Georgia, "Noto Serif", serif; max-width: 700px; margin: 2rem auto; line-height: 1.7; color: #222; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #999; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; font-size: 0.95rem; }
  td { border-bottom: 1px solid #ddd; padding: 3px 8px; vertical-align: top; }
  .text { font-size: 1.05rem; white-space: pre-wrap; }
  .footer { margin-top: 2rem; font-size: 0.8rem; color: #888; }
  @media print { .footer { position: fixed; bottom: 0; } }
</style></head><body>
<h1>${esc(lastResult.title)}</h1>
${lastResult.glossary.length ? `<h2>Glossary</h2><table>${glossRows}</table>` : ""}
<h2>${esc(Store.app.language.name)}</h2>
<div class="text">${esc(lastResult.text)}</div>
<div class="footer">LinguaForge — reading practice for ${esc(Store.app.user)} (${esc(
      Store.app.language.name
    )})</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return App.toast("Pop-up blocked — allow pop-ups to download the PDF.");
    w.document.write(html);
    w.document.close();
    App.toast('In the print dialog choose "Save as PDF".');
  }

  /* ---------------- comprehension rating ---------------- */

  function rate(r) {
    // self-reported comprehension 1-5 → reading skill EMA
    const target = [10, 30, 55, 75, 95][r - 1];
    Store.updateSkill("reading", target, 0.25);
    // a well-understood text credits the learning words it used
    if (r >= 4 && lastResult?.learning_words_used) {
      for (const w of lastResult.learning_words_used) Vocab.creditWord(w);
    }
    App.renderDashboard();
    App.toast("Noted — your reading score has been updated.");
  }

  /* ---------------- sentence-by-sentence repeat practice ---------------- */
  /* The program reads each sentence; the learner repeats it (up to three tries
   * per sentence, the 3rd spoken slowly). No difficulty change — just work
   * through the text — then an overall summary. */

  let practice = null; // {sentences, idx, tries, sims, results, listener}

  function passThreshold() {
    // reuse the learner's Listen & Repeat "pass" cutoff for consistency
    return (Store.profile.listen.passCut ?? 75) / 100;
  }

  function splitSentences(text) {
    const parts = text.match(/[^.!?。！？؟\n]+[.!?。！？؟]*/g) || [];
    return parts.map((s) => s.trim()).filter((s) => s.length > 1);
  }

  function practiceEl(id) {
    return document.getElementById("rd-practice-" + id);
  }

  function setPracticeFeedback(msg, cls) {
    const el = practiceEl("feedback");
    if (!msg) {
      el.classList.add("hidden");
      return;
    }
    el.textContent = msg;
    el.className = "feedback " + (cls || "");
  }

  async function startPractice() {
    if (!lastResult) return;
    const sentences = splitSentences(lastResult.text);
    if (!sentences.length) return App.toast("No sentences to practise.");
    practice = { sentences, idx: 0, tries: 0, sims: [], results: [], listener: null };
    practiceEl("panel").classList.remove("hidden");
    practiceEl("summary").classList.add("hidden");
    document.getElementById("rd-practice-start").classList.add("hidden");
    document.getElementById("rd-practice-stop").classList.remove("hidden");
    practiceEl("status").textContent = I18N.t("reading.practiceIntro");
    await pause(600);
    runSentence();
  }

  function stopPractice() {
    if (!practice) return;
    if (practice.listener) practice.listener.cancel();
    Speech.stop();
    practice = null;
    practiceEl("current").textContent = "";
    practiceEl("heard").textContent = "";
    setPracticeFeedback(null);
    practiceEl("status").textContent = "";
    document.getElementById("rd-practice-start").classList.remove("hidden");
    document.getElementById("rd-practice-stop").classList.add("hidden");
  }

  async function runSentence() {
    if (!practice) return;
    if (practice.idx >= practice.sentences.length) return finishPractice();
    practice.tries = 0;
    practice.sims = [];
    practiceEl("status").textContent = I18N.t("reading.practiceSentence", {
      i: practice.idx + 1,
      n: practice.sentences.length,
    });
    setPracticeFeedback(null);
    practiceEl("heard").textContent = "";
    await sayAndListen(false);
  }

  async function sayAndListen(slow) {
    if (!practice) return;
    const sentence = practice.sentences[practice.idx];
    practiceEl("current").textContent = sentence;
    try {
      await Speech.speak(sentence, { slow });
    } catch (e) {
      App.toast(e.message);
    }
    if (!practice) return; // stopped during playback
    let stopFn;
    try {
      practice.listener = await Speech.listen({ onStatus: practiceRecStatus });
      stopFn = practice.listener;
    } catch (e) {
      App.toast(e.message);
      return;
    }
    let heard;
    try {
      heard = await stopFn.result;
    } catch (e) {
      heard = "";
    }
    if (!practice) return; // stopped while recording
    practice.listener = null;
    if (heard === null) return; // cancelled
    await evalSentence(heard || "");
  }

  function practiceRecStatus(state) {
    if (!practice) return;
    if (state === "listening" || state === "hearing") {
      practiceEl("status").textContent =
        I18N.t("reading.practiceSentence", { i: practice.idx + 1, n: practice.sentences.length }) +
        " — " +
        I18N.t("listen.recording");
    } else if (state === "transcribing") {
      practiceEl("status").textContent = I18N.t("listen.transcribing");
    }
  }

  async function evalSentence(heard) {
    const sentence = practice.sentences[practice.idx];
    const sim = Speech.similarity(sentence, heard);
    const pct = Math.round(sim * 100);
    practice.tries++;
    practice.sims.push(sim);
    practiceEl("heard").textContent = heard
      ? I18N.t("listen.youSaid", { heard })
      : I18N.t("listen.heardNothing");

    if (sim >= passThreshold()) {
      setPracticeFeedback(I18N.t("reading.practiceGood", { pct }), "good");
      recordSentence(true);
      await pause(2000);
      nextSentence();
    } else if (practice.tries === 1) {
      setPracticeFeedback(I18N.t("reading.practiceTryAgain", { pct }), "meh");
      await pause(700);
      await sayAndListen(false); // try 2: normal speed
    } else if (practice.tries === 2) {
      setPracticeFeedback(I18N.t("reading.practiceSlow", { pct }), "meh");
      await pause(700);
      await sayAndListen(true); // try 3: slow
    } else {
      setPracticeFeedback(I18N.t("reading.practiceMoveOn", { pct }), "bad");
      recordSentence(false);
      await pause(2000);
      nextSentence();
    }
  }

  function recordSentence(passed) {
    practice.results.push({ sims: practice.sims.slice(), passed });
    // credit pronunciation/listening a little for satisfactory repeats
    if (passed) Store.updateSkill("pronunciation", 80, 0.05);
  }

  function nextSentence() {
    if (!practice) return;
    practice.idx++;
    runSentence();
  }

  function finishPractice() {
    const res = practice.results;
    const total = res.length;
    const passed = res.filter((r) => r.passed).length;

    // average match for each attempt number (1..3), over sentences that reached it
    const tryLines = [];
    for (let k = 0; k < 3; k++) {
      const sims = res.filter((r) => r.sims.length > k).map((r) => r.sims[k]);
      if (sims.length) {
        const avg = Math.round((sims.reduce((a, b) => a + b, 0) / sims.length) * 100);
        tryLines.push(I18N.t("reading.sumTry", { k: k + 1, pct: avg, count: sims.length }));
      }
    }
    // overall: best attempt per sentence
    const bests = res.map((r) => Math.max(...r.sims));
    const overall = total ? Math.round((bests.reduce((a, b) => a + b, 0) / total) * 100) : 0;
    const satPct = total ? Math.round((passed / total) * 100) : 0;

    Store.updateSkill("reading", Math.min(100, overall), 0.1);
    App.renderDashboard();

    const box = practiceEl("summary");
    box.classList.remove("hidden");
    box.innerHTML = "";
    const lines = [
      `<b>${I18N.t("reading.practiceDone")}</b>`,
      I18N.t("reading.sumSatisfactory", { pct: satPct, pass: passed, total }),
      I18N.t("reading.sumOverall", { pct: overall }),
      ...tryLines,
    ];
    for (const line of lines) {
      const d = document.createElement("div");
      d.innerHTML = line;
      box.appendChild(d);
    }
    practiceEl("current").textContent = "";
    setPracticeFeedback(null);
    practiceEl("status").textContent = "";
    document.getElementById("rd-practice-start").classList.remove("hidden");
    document.getElementById("rd-practice-stop").classList.add("hidden");
    practice = null;
  }

  function pause(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ---------------- wiring ---------------- */

  function init() {
    const len = document.getElementById("rd-length");
    const ratio = document.getElementById("rd-ratio");
    len.oninput = () => (document.getElementById("rd-length-val").textContent = len.value);
    ratio.oninput = () => (document.getElementById("rd-ratio-val").textContent = ratio.value + "%");
    document.getElementById("rd-generate").onclick = generate;
    document.getElementById("rd-pdf").onclick = downloadPdf;
    document.getElementById("rd-listen").onclick = readAloud;
    document.getElementById("rd-stop").onclick = () => Speech.stop();
    document.getElementById("rd-gloss-translate").onclick = translateGlossary;
    document.getElementById("rd-gloss-toggle").onclick = toggleGlossary;
    document.getElementById("rd-gloss-clear").onclick = () => {
      if (lastResult && confirm("Remove all words from the glossary?")) clearGlossary();
    };
    document.getElementById("rd-gloss-add").onclick = () => {
      if (!lastResult) return;
      const withTrans = lastResult.glossary.filter((g) => g.translation);
      const n = Vocab.addNewWords(lastResult.glossary);
      if (lastResult.glossary.length > withTrans.length) {
        App.toast(`Added ${n} word${n === 1 ? "" : "s"} to Learning (tip: “Translate all” first to store translations too).`);
      } else {
        App.toast(`Added ${n} glossary word${n === 1 ? "" : "s"} to Learning.`);
      }
    };
    document.querySelectorAll("#rd-rating button").forEach((b) => {
      b.onclick = () => rate(+b.dataset.r);
    });
    document.getElementById("rd-practice-start").onclick = startPractice;
    document.getElementById("rd-practice-stop").onclick = stopPractice;
  }

  return { init, stopPractice };
})();
