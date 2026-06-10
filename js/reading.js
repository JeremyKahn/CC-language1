/* reading.js — Generate a body of text from the learner's vocabulary, with a
 * glossary of unknown words shown before the text, and PDF download. */
"use strict";

const Reading = (() => {
  let lastResult = null; // {title, glossary, text}

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
    document.getElementById("rd-output").classList.remove("hidden");
    document.getElementById("rd-pdf").classList.remove("hidden");
    document.getElementById("rd-listen").classList.remove("hidden");
    document.getElementById("rd-title").textContent = out.title;

    const table = document.getElementById("rd-glossary");
    table.innerHTML = "";
    const wrap = document.getElementById("rd-glossary-wrap");
    wrap.style.display = out.glossary.length ? "" : "none";
    for (const g of out.glossary) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      td1.textContent = g.word;
      td2.textContent = g.translation;
      tr.append(td1, td2);
      table.appendChild(tr);
    }
    document.getElementById("rd-text").textContent = out.text;
    document.getElementById("rd-output").scrollIntoView({ behavior: "smooth" });
  }

  /* PDF download: render a print-formatted page and invoke the browser's
   * print-to-PDF. This handles every script (CJK, Arabic, Cyrillic…) that a
   * client-side PDF library with embedded Latin fonts cannot. */
  function downloadPdf() {
    if (!lastResult) return;
    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const glossRows = lastResult.glossary
      .map((g) => `<tr><td><b>${esc(g.word)}</b></td><td>${esc(g.translation)}</td></tr>`)
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

  function init() {
    const len = document.getElementById("rd-length");
    const ratio = document.getElementById("rd-ratio");
    len.oninput = () => (document.getElementById("rd-length-val").textContent = len.value);
    ratio.oninput = () => (document.getElementById("rd-ratio-val").textContent = ratio.value + "%");
    document.getElementById("rd-generate").onclick = generate;
    document.getElementById("rd-pdf").onclick = downloadPdf;
    document.getElementById("rd-listen").onclick = () =>
      lastResult && Speech.speak(lastResult.text).catch((e) => App.toast(e.message));
    document.getElementById("rd-gloss-add").onclick = () => {
      if (!lastResult) return;
      const n = Vocab.addNewWords(lastResult.glossary);
      App.toast(`Added ${n} glossary word${n === 1 ? "" : "s"} to Learning.`);
    };
    document.querySelectorAll("#rd-rating button").forEach((b) => {
      b.onclick = () => rate(+b.dataset.r);
    });
  }

  return { init };
})();
