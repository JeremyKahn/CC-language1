/* vocab.js — the learner's two word sets (mastered / learning) and Anki export. */
"use strict";

const Vocab = (() => {
  function lists() {
    return Store.profile.vocab;
  }

  function add(word, translation, set) {
    word = word.trim();
    if (!word) return;
    const v = lists();
    delete v.mastered[word];
    delete v.learning[word];
    v[set][word] = { translation: (translation || "").trim(), addedAt: Date.now(), streak: 0 };
    Store.recomputeVocabSkill();
    render();
  }

  function remove(word) {
    const v = lists();
    delete v.mastered[word];
    delete v.learning[word];
    Store.recomputeVocabSkill();
    render();
  }

  function move(word, toSet) {
    const v = lists();
    const fromSet = toSet === "mastered" ? "learning" : "mastered";
    if (v[fromSet][word]) {
      v[toSet][word] = v[fromSet][word];
      delete v[fromSet][word];
      Store.recomputeVocabSkill();
      render();
    }
  }

  /** Called by other modes when a learning word is used successfully.
   *  After 5 successes the word is promoted to mastered. */
  function creditWord(word) {
    const v = lists();
    if (v.learning[word]) {
      v.learning[word].streak = (v.learning[word].streak || 0) + 1;
      if (v.learning[word].streak >= 5) {
        v.mastered[word] = v.learning[word];
        delete v.learning[word];
        App.toast(`⭐ "${word}" promoted to Mastered!`);
      }
      Store.recomputeVocabSkill();
    }
  }

  /** Record new words encountered (e.g. from listen&repeat or glossaries). */
  function addNewWords(entries) {
    const v = lists();
    let added = 0;
    for (const { word, translation } of entries) {
      const w = (word || "").trim();
      if (!w || v.mastered[w] || v.learning[w]) continue;
      v.learning[w] = { translation: (translation || "").trim(), addedAt: Date.now(), streak: 0 };
      added++;
    }
    if (added) {
      Store.recomputeVocabSkill();
      render();
    }
    return added;
  }

  /* ---------------- rendering ---------------- */

  function render() {
    if (!Store.profile) return;
    const v = lists();
    renderList("learning", v.learning);
    renderList("mastered", v.mastered);
    document.getElementById("vb-learning-count").textContent = `(${Object.keys(v.learning).length})`;
    document.getElementById("vb-mastered-count").textContent = `(${Object.keys(v.mastered).length})`;
    App.renderDashboard();
  }

  function renderList(set, words) {
    const el = document.getElementById(`vb-${set}-list`);
    el.innerHTML = "";
    const sorted = Object.keys(words).sort((a, b) => words[b].addedAt - words[a].addedAt);
    if (!sorted.length) {
      el.innerHTML = `<div class="muted small">No words yet.</div>`;
      return;
    }
    for (const w of sorted) {
      const item = document.createElement("div");
      item.className = "word-item";
      const moveLabel = set === "learning" ? "⭐" : "↩";
      const moveTitle = set === "learning" ? "Promote to Mastered" : "Move back to Learning";
      item.innerHTML =
        `<span class="w"></span><span class="t"></span>` +
        `<span class="ops"><button data-op="move" title="${moveTitle}">${moveLabel}</button>` +
        `<button data-op="del" title="Delete">🗑</button></span>`;
      item.querySelector(".w").textContent = w;
      item.querySelector(".t").textContent = words[w].translation || "";
      item.querySelector('[data-op="move"]').onclick = () =>
        move(w, set === "learning" ? "mastered" : "learning");
      item.querySelector('[data-op="del"]').onclick = () => remove(w);
      el.appendChild(item);
    }
  }

  /* ---------------- Anki export ---------------- */

  async function exportAnki(set) {
    const v = lists();
    const words = Object.keys(v[set]);
    if (!words.length) return App.toast("That list is empty.");
    const lang = Store.app.language.name;

    App.busy(`Preparing ${words.length} cards…`);
    try {
      // Fill in any missing translations, and get example sentences, via Claude.
      const out = await AI.call({
        system: `You create flashcard content for learners of ${lang}.`,
        user:
          `For each ${lang} word below give: a short English translation and one short, natural example ` +
          `sentence in ${lang} using the word (with an English translation in parentheses after it).\n` +
          words.map((w) => `- ${w}`).join("\n"),
        schema: {
          type: "object",
          properties: {
            cards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  word: { type: "string" },
                  translation: { type: "string" },
                  example: { type: "string" },
                },
                required: ["word", "translation", "example"],
                additionalProperties: false,
              },
            },
          },
          required: ["cards"],
          additionalProperties: false,
        },
        maxTokens: 16000,
      });

      const byWord = {};
      for (const c of out.cards) byWord[c.word] = c;
      const cards = words.map((w) => ({
        word: w,
        translation: v[set][w].translation || byWord[w]?.translation || "",
        example: byWord[w]?.example || "",
      }));
      // persist AI translations we just learned
      for (const c of cards) {
        if (!v[set][c.word].translation && c.translation) v[set][c.word].translation = c.translation;
      }
      Store.saveProfile();
      render();

      const deckName = `${lang} — ${set === "learning" ? "Learning" : "Mastered"} (${Store.app.user})`;
      const kind = await AnkiExport.exportDeck({ deckName, language: lang, cards });
      App.toast(kind === "apkg" ? "🃏 Anki deck (.apkg) downloaded — import it in Anki." : "Exported TSV (Anki: File → Import).");
    } catch (e) {
      App.toast("Export failed: " + e.message);
    } finally {
      App.busy(false);
    }
  }

  /* ---------------- wiring ---------------- */

  function init() {
    document.getElementById("vb-add").onclick = async () => {
      const word = document.getElementById("vb-word").value.trim();
      let trans = document.getElementById("vb-trans").value.trim();
      const set = document.getElementById("vb-set").value;
      if (!word) return;
      if (!trans) {
        try {
          App.busy("Translating…");
          const map = await AI.translateWords([word], Store.app.language.name);
          trans = map[word] || "";
        } catch (e) {
          App.toast(e.message);
        } finally {
          App.busy(false);
        }
      }
      add(word, trans, set);
      document.getElementById("vb-word").value = "";
      document.getElementById("vb-trans").value = "";
    };

    document.getElementById("vb-bulk").onclick = () =>
      document.getElementById("vb-bulk-box").classList.toggle("hidden");

    document.getElementById("vb-bulk-go").onclick = async () => {
      const text = document.getElementById("vb-bulk-text").value;
      const entries = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [w, t] = l.split(/\s*[=\t]\s*/);
          return { word: w, translation: t || "" };
        });
      if (!entries.length) return;
      const untranslated = entries.filter((e) => !e.translation).map((e) => e.word);
      if (untranslated.length) {
        try {
          App.busy(`Translating ${untranslated.length} words…`);
          const map = await AI.translateWords(untranslated, Store.app.language.name);
          for (const e of entries) if (!e.translation) e.translation = map[e.word] || "";
        } catch (e) {
          App.toast("Translation failed (" + e.message + ") — adding without translations.");
        } finally {
          App.busy(false);
        }
      }
      const n = addNewWords(entries);
      App.toast(`Added ${n} new words to Learning.`);
      document.getElementById("vb-bulk-text").value = "";
      document.getElementById("vb-bulk-box").classList.add("hidden");
    };

    document.getElementById("vb-anki-learning").onclick = () => exportAnki("learning");
    document.getElementById("vb-anki-mastered").onclick = () => exportAnki("mastered");
  }

  return { init, render, add, addNewWords, creditWord };
})();
