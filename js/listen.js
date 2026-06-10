/* listen.js — "Listen and repeat" mode.
 *
 * The tutor speaks a phrase; the learner repeats it. Success → a slightly
 * harder phrase. First failure → the same phrase replayed slowly and
 * carefully. Second failure → an easier phrase.
 */
"use strict";

const Listen = (() => {
  const PASS = 0.8; // similarity threshold counted as a successful repeat
  const NEAR = 0.55; // above this we encourage another try at the same phrase

  let current = null; // {phrase, translation, new_words}
  let failCount = 0;
  let streak = 0;
  let recording = null; // stop() fn while recording
  let busy = false;

  function level() {
    return Store.profile.listen.level;
  }

  function setLevel(l) {
    Store.profile.listen.level = Math.max(1, Math.min(10, Math.round(l * 10) / 10));
    Store.saveProfile();
    document.getElementById("lr-level").textContent = Math.round(level());
  }

  const LEVEL_GUIDE = {
    1: "a 2-4 word everyday phrase using only very basic vocabulary",
    2: "a 3-5 word everyday phrase, basic vocabulary",
    3: "a short simple sentence of 5-7 words",
    4: "a simple sentence of 6-9 words with one common verb tense",
    5: "a sentence of 8-11 words, possibly two clauses",
    6: "a sentence of 9-13 words with a subordinate clause",
    7: "a complex sentence of 12-16 words, some idiomatic phrasing",
    8: "a complex sentence of 14-18 words with idiomatic, colloquial phrasing",
    9: "a long native-level sentence of 16-22 words",
    10: "a long, fast, fully native-level sentence of 18-25 words with idioms",
  };

  async function nextPhrase() {
    const lang = Store.app.language.name;
    const p = Store.profile;
    const lvl = Math.round(level());
    const mastered = Object.keys(p.vocab.mastered).slice(-200);
    const learning = Object.keys(p.vocab.learning).slice(-100);
    const recent = p.listen.recent.slice(-12);

    const out = await AI.call({
      system:
        `You generate "listen and repeat" practice phrases for a learner of ${lang}. ` +
        `Output natural, correct ${lang} that a native speaker would actually say.`,
      user:
        `Difficulty level ${lvl}/10: produce ${LEVEL_GUIDE[lvl]}.\n` +
        (mastered.length
          ? `Prefer vocabulary the learner has MASTERED: ${mastered.join(", ")}\n`
          : "") +
        (learning.length
          ? `Try to include one or two words the learner is LEARNING: ${learning.join(", ")}\n`
          : "") +
        `You may introduce at most 1-2 genuinely new words; list them (dictionary form) with translations in new_words.\n` +
        (recent.length ? `Do NOT reuse these recent phrases: ${recent.join(" | ")}\n` : "") +
        `Return the phrase in ${lang}, its English translation, and new_words.`,
      schema: {
        type: "object",
        properties: {
          phrase: { type: "string" },
          translation: { type: "string" },
          new_words: {
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
        },
        required: ["phrase", "translation", "new_words"],
        additionalProperties: false,
      },
      maxTokens: 1024,
    });

    p.listen.recent.push(out.phrase);
    if (p.listen.recent.length > 30) p.listen.recent.shift();
    Store.saveProfile();
    return out;
  }

  async function present(slow = false) {
    const box = document.getElementById("lr-phrase-box");
    box.classList.remove("hidden");
    const ph = document.getElementById("lr-phrase");
    ph.textContent = current.phrase;
    ph.classList.add("blurred"); // hidden until the learner asks — this is listening practice
    const tr = document.getElementById("lr-translation");
    tr.textContent = current.translation;
    tr.classList.add("hidden");
    setFeedback(null);
    document.getElementById("lr-heard").textContent = "";
    try {
      await Speech.speak(current.phrase, { slow });
    } catch (e) {
      App.toast(e.message);
    }
  }

  async function startSession() {
    if (busy) return;
    busy = true;
    App.busy("Composing a phrase…");
    try {
      current = await nextPhrase();
      failCount = 0;
      document.getElementById("lr-start").classList.add("hidden");
      document.getElementById("lr-record").classList.remove("hidden");
      document.getElementById("lr-skip").classList.remove("hidden");
      App.busy(false);
      await present(false);
    } catch (e) {
      App.busy(false);
      App.toast(e.message);
    } finally {
      busy = false;
    }
  }

  async function toggleRecord() {
    const btn = document.getElementById("lr-record");
    if (!current) return;
    if (recording) {
      // stop & evaluate
      btn.classList.remove("armed");
      btn.textContent = "🎙 Click to record your repeat";
      btn.disabled = true;
      try {
        const stop = recording;
        recording = null;
        const heard = await stop();
        await evaluate(heard);
      } catch (e) {
        App.toast(e.message);
      } finally {
        btn.disabled = false;
      }
    } else {
      Speech.stop();
      try {
        recording = await Speech.startRecognition();
        btn.classList.add("armed");
        btn.textContent = "⏹ Recording… click to stop";
      } catch (e) {
        App.toast(e.message);
      }
    }
  }

  async function evaluate(heard) {
    const p = Store.profile;
    p.listen.attempts++;
    document.getElementById("lr-heard").textContent = heard ? `Heard: “${heard}”` : "(heard nothing)";
    const sim = Speech.similarity(current.phrase, heard || "");

    if (sim >= PASS) {
      p.listen.successes++;
      streak++;
      setFeedback(`✅ Excellent! (${Math.round(sim * 100)}% match)`, "good");
      // credit learning words contained in the phrase
      const norm = " " + Speech.normalize(current.phrase) + " ";
      for (const w of Object.keys(p.vocab.learning)) {
        if (norm.includes(" " + Speech.normalize(w) + " ")) Vocab.creditWord(w);
      }
      const lvl = level();
      Store.updateSkill("listening", Math.min(100, lvl * 10), 0.15);
      Store.updateSkill("pronunciation", Math.min(100, lvl * 10), 0.15);
      setLevel(lvl + 0.4);
      // offer new words from the phrase to the learning list
      if (current.new_words?.length) {
        const n = Vocab.addNewWords(current.new_words);
        if (n) App.toast(`Added ${n} new word${n > 1 ? "s" : ""} to your Learning list.`);
      }
      await pause(900);
      await advance();
    } else if (failCount === 0) {
      failCount = 1;
      setFeedback(
        sim >= NEAR
          ? `🙂 Almost (${Math.round(sim * 100)}%). Listen again — slowly this time.`
          : `🤔 Not quite. Listen again — slowly and carefully.`,
        "meh"
      );
      Store.updateSkill("listening", Math.max(0, level() * 10 - 15), 0.05);
      await pause(700);
      await present(true); // repeat slowly and carefully
    } else {
      setFeedback("💪 No problem — let's try something a little simpler.", "bad");
      setLevel(level() - 1);
      Store.updateSkill("listening", Math.max(0, level() * 10 - 10), 0.1);
      Store.updateSkill("pronunciation", Math.max(0, level() * 10 - 10), 0.1);
      streak = 0;
      await pause(1000);
      await advance();
    }
    document.getElementById("lr-streak").textContent = streak >= 2 ? `🔥 streak: ${streak}` : "";
    App.renderDashboard();
  }

  async function advance() {
    if (busy) return;
    busy = true;
    App.busy("Composing the next phrase…");
    try {
      current = await nextPhrase();
      failCount = 0;
      App.busy(false);
      await present(false);
    } catch (e) {
      App.busy(false);
      App.toast(e.message);
    } finally {
      busy = false;
    }
  }

  function setFeedback(msg, cls) {
    const el = document.getElementById("lr-feedback");
    if (!msg) {
      el.classList.add("hidden");
      return;
    }
    el.textContent = msg;
    el.className = "feedback " + (cls || "");
  }

  function pause(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function init() {
    document.getElementById("lr-start").onclick = startSession;
    document.getElementById("lr-record").onclick = toggleRecord;
    document.getElementById("lr-skip").onclick = advance;
    document.getElementById("lr-replay").onclick = () => current && Speech.speak(current.phrase);
    document.getElementById("lr-replay-slow").onclick = () =>
      current && Speech.speak(current.phrase, { slow: true });
    document.getElementById("lr-show").onclick = () => {
      document.getElementById("lr-phrase").classList.remove("blurred");
      document.getElementById("lr-translation").classList.remove("hidden");
    };
  }

  function refresh() {
    if (!Store.profile) return;
    document.getElementById("lr-level").textContent = Math.round(level());
  }

  return { init, refresh };
})();
