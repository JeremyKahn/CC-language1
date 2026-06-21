/* listen.js — "Listen and repeat" mode.
 *
 * The tutor speaks a phrase; recording starts automatically and stops by
 * itself when the learner falls silent. Scoring (character-level Levenshtein
 * similarity on normalized text) uses two tiers:
 *   - >= ADVANCE (75%): good enough — move on to the next phrase, same level;
 *   - >= LEVELUP (92%): excellent — move on AND raise the difficulty.
 * First failure → the same phrase replayed slowly and carefully.
 * Second failure → an easier phrase.
 */
"use strict";

const Listen = (() => {
  // Cutoffs are user-adjustable sliders, stored per user+language:
  //   passCut (70-90):       move on to a new phrase at the same level
  //   excellentCut (90-100): near-perfect repeat — difficulty goes up
  function passCut() {
    return (Store.profile.listen.passCut ?? 75) / 100;
  }
  function excellentCut() {
    return (Store.profile.listen.excellentCut ?? 92) / 100;
  }

  let current = null; // {phrase, translation, new_words}
  let failCount = 0;
  let streak = 0;
  let listener = null; // active Speech.listen() handle
  let sessionOn = false;
  let busy = false;
  let endRequested = false; // End pressed: finish the current phrase, then stop

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

  /* ---------------- play → record → evaluate loop ---------------- */

  /** Say the current phrase (text blurred — this is listening practice). */
  async function present(slow = false) {
    const box = document.getElementById("lr-phrase-box");
    box.classList.remove("hidden");
    const ph = document.getElementById("lr-phrase");
    ph.textContent = current.phrase;
    ph.classList.add("blurred");
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

  /** Briefly show the original phrase with the learner's transcript below it
   *  (done only when moving on to the next phrase). */
  function reveal(heard) {
    document.getElementById("lr-phrase").classList.remove("blurred");
    document.getElementById("lr-heard").textContent = heard
      ? I18N.t("listen.youSaid", { heard })
      : I18N.t("listen.heardNothing");
  }

  function recordBtn() {
    return document.getElementById("lr-record");
  }

  function setRecordUI(state) {
    const btn = recordBtn();
    btn.classList.toggle("armed", state === "listening" || state === "hearing");
    btn.disabled = state === "transcribing";
    btn.textContent =
      state === "listening" || state === "hearing"
        ? I18N.t("listen.recording")
        : state === "transcribing"
          ? I18N.t("listen.transcribing")
          : I18N.t("listen.record");
  }

  /** Start recording automatically; resolves after evaluation. */
  async function startListening() {
    if (listener || !current || !sessionOn) return;
    try {
      listener = await Speech.listen({ onStatus: setRecordUI });
    } catch (e) {
      listener = null;
      setRecordUI("idle");
      App.toast(e.message);
      return;
    }
    let heard;
    try {
      heard = await listener.result;
    } catch (e) {
      App.toast(e.message);
      heard = "";
    }
    listener = null;
    setRecordUI("idle");
    if (heard === null) return; // cancelled (replay, skip, navigation…)
    await evaluate(heard || "");
  }

  function cancelListening() {
    if (listener) listener.cancel();
  }

  async function startSession() {
    if (busy) return;
    busy = true;
    sessionOn = true;
    endRequested = false;
    App.busy(I18N.t("listen.composing"));
    try {
      current = await nextPhrase();
      failCount = 0;
      document.getElementById("lr-start").classList.add("hidden");
      recordBtn().classList.remove("hidden");
      document.getElementById("lr-skip").classList.remove("hidden");
      document.getElementById("lr-end").classList.remove("hidden");
      App.busy(false);
      await present(false);
      busy = false;
      startListening();
    } catch (e) {
      App.busy(false);
      App.toast(e.message);
      busy = false;
    }
  }

  /** End button: finish the current phrase (let it be evaluated and shown),
   *  then stop just before the next phrase would be composed. */
  function endSession() {
    if (!sessionOn || endRequested) return;
    endRequested = true;
    if (listener) {
      // a take is in progress — finish it now so it gets evaluated, then end
      App.toast(I18N.t("listen.ending"));
      listener.stop();
    } else if (!busy) {
      // nothing in flight (no take, not composing) — end immediately
      finalizeEnd();
    } else {
      App.toast(I18N.t("listen.ending"));
    }
  }

  /** Tear down the session UI. Keeps the last phrase's feedback on screen. */
  function finalizeEnd() {
    sessionOn = false;
    endRequested = false;
    cancelListening();
    Speech.stop();
    current = null;
    streak = 0;
    document.getElementById("lr-start").classList.remove("hidden");
    recordBtn().classList.add("hidden");
    document.getElementById("lr-skip").classList.add("hidden");
    document.getElementById("lr-end").classList.add("hidden");
    document.getElementById("lr-streak").textContent = "";
  }

  async function evaluate(heard) {
    const p = Store.profile;
    p.listen.attempts++;
    const sim = Speech.similarity(current.phrase, heard);
    const pct = Math.round(sim * 100);
    const lvl = level();

    if (sim >= passCut()) {
      // passed — credit vocabulary either way
      p.listen.successes++;
      streak++;
      const norm = " " + Speech.normalize(current.phrase) + " ";
      for (const w of Object.keys(p.vocab.learning)) {
        if (norm.includes(" " + Speech.normalize(w) + " ")) Vocab.creditWord(w);
      }
      if (current.new_words?.length) {
        const n = Vocab.addNewWords(current.new_words);
        if (n) App.toast(I18N.t("listen.newWords", { n }));
      }

      if (sim >= excellentCut()) {
        setFeedback(I18N.t("listen.excellent", { pct }), "good");
        Store.updateSkill("listening", Math.min(100, lvl * 10), 0.15);
        Store.updateSkill("pronunciation", Math.min(100, lvl * 10), 0.15);
        setLevel(lvl + 0.4);
      } else {
        setFeedback(I18N.t("listen.good", { pct }), "good");
        Store.updateSkill("listening", Math.min(100, lvl * 10 - 5), 0.08);
        Store.updateSkill("pronunciation", Math.min(100, lvl * 10 - 5), 0.08);
      }
      reveal(heard);
      await moveOn();
    } else if (failCount === 0 && !endRequested) {
      // first miss → same phrase again, slowly (text stays hidden)
      failCount = 1;
      setFeedback(I18N.t("listen.notQuiteSlow", { pct }), "meh");
      Store.updateSkill("listening", Math.max(0, lvl * 10 - 15), 0.05);
      App.renderDashboard();
      await pause(700);
      await present(true);
      startListening();
      return;
    } else if (failCount === 0) {
      // first miss but End was pressed — show feedback and stop, no level drop
      setFeedback(I18N.t("listen.notQuite", { pct }), "meh");
      Store.updateSkill("listening", Math.max(0, lvl * 10 - 15), 0.05);
      reveal(heard);
      await moveOn();
    } else {
      // second miss → drop to a simpler phrase
      setFeedback(I18N.t("listen.simpler"), "bad");
      setLevel(lvl - 1);
      Store.updateSkill("listening", Math.max(0, level() * 10 - 10), 0.1);
      Store.updateSkill("pronunciation", Math.max(0, level() * 10 - 10), 0.1);
      streak = 0;
      reveal(heard);
      await moveOn();
    }
  }

  /** After a phrase's feedback is shown: pause briefly, then either compose
   *  the next phrase or — if End was pressed — stop here. */
  async function moveOn() {
    document.getElementById("lr-streak").textContent = streak >= 2 ? I18N.t("listen.streak", { n: streak }) : "";
    App.renderDashboard();
    if (endRequested) {
      finalizeEnd();
      return;
    }
    await pause(1500);
    if (endRequested) {
      finalizeEnd();
      return;
    }
    await advance();
  }

  async function advance() {
    if (busy || !sessionOn || endRequested) return;
    busy = true;
    cancelListening();
    try {
      current = await nextPhrase(); // composed silently — no spinner
      failCount = 0;
      busy = false;
      if (!sessionOn || endRequested) {
        finalizeEnd();
        return;
      }
      await present(false);
      startListening();
    } catch (e) {
      App.toast(e.message);
      busy = false;
    }
  }

  async function replay(slow) {
    if (!current) return;
    cancelListening();
    try {
      await Speech.speak(current.phrase, { slow });
    } catch (e) {
      App.toast(e.message);
    }
    startListening();
  }

  /** Cancel any active recording/audio (e.g. when navigating away).
   *  The session itself stays on; clicking Record resumes the loop. */
  function stopAll() {
    cancelListening();
    Speech.stop();
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

  function wireCutoff(id, key) {
    const input = document.getElementById(id);
    const label = document.getElementById(id + "-val");
    input.oninput = () => {
      Store.profile.listen[key] = +input.value;
      Store.saveProfile();
      label.textContent = input.value + "%";
    };
  }

  function init() {
    document.getElementById("lr-start").onclick = startSession;
    document.getElementById("lr-end").onclick = endSession;
    document.getElementById("lr-record").onclick = () => {
      if (listener) listener.stop(); // finish the take now
      else startListening(); // manual restart if auto-record was cancelled
    };
    document.getElementById("lr-skip").onclick = advance;
    document.getElementById("lr-replay").onclick = () => replay(false);
    document.getElementById("lr-replay-slow").onclick = () => replay(true);
    document.getElementById("lr-show").onclick = () => {
      document.getElementById("lr-phrase").classList.remove("blurred");
      document.getElementById("lr-translation").classList.remove("hidden");
    };
    wireCutoff("lr-cut-excellent", "excellentCut");
    wireCutoff("lr-cut-pass", "passCut");
  }

  function refresh() {
    if (!Store.profile) return;
    document.getElementById("lr-level").textContent = Math.round(level());
    for (const [id, key] of [
      ["lr-cut-excellent", "excellentCut"],
      ["lr-cut-pass", "passCut"],
    ]) {
      const v = Store.profile.listen[key] ?? (key === "passCut" ? 75 : 92);
      document.getElementById(id).value = v;
      document.getElementById(id + "-val").textContent = v + "%";
    }
  }

  return { init, refresh, stopAll };
})();
