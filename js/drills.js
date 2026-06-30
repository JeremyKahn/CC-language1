/* drills.js — Custom drills tab. The learner describes the exercises they want,
 * picks one of five types, and a count; the AI generates that many exercises.
 * Each exercise is graded right after it's answered:
 *   - multiple_choice / short_written  → graded locally
 *   - long_written                     → AI-graded
 *   - spoken / translate_spoken        → recorded, transcribed, then AI-graded
 * A running total score is shown once every exercise has been answered. */
"use strict";

const Drills = (() => {
  let current = null; // {desc, type, lang, exercises, scores: [], listener}

  // i18n keys for each type's human label (the title + radio captions reuse these)
  const TYPE_KEY = {
    multiple_choice: "drills.typeMc",
    short_written: "drills.typeShort",
    long_written: "drills.typeLong",
    spoken: "drills.typeSpoken",
    translate_spoken: "drills.typeTranslate",
  };

  // which dashboard skill a drill set nudges when finished
  const TYPE_SKILL = {
    multiple_choice: "grammar",
    short_written: "vocabulary",
    long_written: "grammar",
    spoken: "pronunciation",
    translate_spoken: "pronunciation",
  };

  const isSpoken = (t) => t === "spoken" || t === "translate_spoken";

  function typeLabel(type) {
    return I18N.t(TYPE_KEY[type], { lang: Store.app.language?.name || "" });
  }

  function selectedType() {
    const r = document.querySelector('input[name="dr-type"]:checked');
    return r ? r.value : "multiple_choice";
  }

  /* ---------------- generation ---------------- */

  async function generate() {
    const lang = Store.app.language.name;
    const desc = document.getElementById("dr-desc").value.trim();
    if (!desc) return App.toast(I18N.t("drills.needDesc"));
    const type = selectedType();
    let count = parseInt(document.getElementById("dr-count").value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 100) count = 100;
    document.getElementById("dr-count").value = count;

    stopAll();
    App.busy(I18N.t("drills.generating"));
    try {
      const out = await AI.call({
        system:
          `You are an expert ${lang} teacher creating practice exercises for an adult learner whose ` +
          `native language is English. Follow the learner's request closely.`,
        user: buildPrompt(lang, desc, type, count),
        schema: exerciseSchema(),
        maxTokens: Math.min(32000, 1500 + count * 320),
      });
      const exercises = (out.exercises || []).slice(0, count);
      if (!exercises.length) throw new Error("The AI returned no exercises — try rephrasing your request.");
      current = {
        desc,
        type,
        lang,
        exercises,
        scores: new Array(exercises.length).fill(null),
        listener: null,
      };
      render();
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  function buildPrompt(lang, desc, type, count) {
    const common =
      `Create exactly ${count} ${lang} practice exercises.\n` +
      `Learner's request (follow it closely): "${desc}"\n\n`;
    const rules = {
      multiple_choice:
        `Type: multiple choice.\n` +
        `For each exercise set: prompt = the question (in English, may quote ${lang}); ` +
        `options = exactly 4 answer choices; answer_index = the 0-based index of the correct option; ` +
        `answer = the text of the correct option; explanation = one sentence on why it's correct. ` +
        `Leave accept = [].`,
      short_written:
        `Type: short written answer (the answer is a single word or a very short phrase in ${lang}).\n` +
        `For each: prompt = a clear instruction or question (in English, may quote ${lang}) whose answer is ` +
        `short; answer = the expected ${lang} answer; accept = any other answers that should also be accepted ` +
        `(alternative spellings/synonyms), else []; explanation = one brief sentence. Leave options = [], answer_index = 0.`,
      long_written:
        `Type: long written answer (the learner writes a full sentence, or a few, in ${lang}).\n` +
        `For each: prompt = the task (in English, may quote ${lang}); answer = a model/ideal ${lang} answer; ` +
        `explanation = one sentence on what a good answer must include. Leave options = [], answer_index = 0, accept = [].`,
      spoken:
        `Type: spoken answer (the learner answers OUT LOUD in ${lang}).\n` +
        `For each: prompt = a question or task (in English, may quote ${lang}) to be answered by speaking in ${lang}; ` +
        `answer = a model spoken ${lang} answer; explanation = one sentence on what a good answer includes. ` +
        `Leave options = [], answer_index = 0, accept = [].`,
      translate_spoken:
        `Type: English → spoken ${lang} translation (the learner reads an English sentence and SPEAKS its ${lang} translation).\n` +
        `For each: prompt = the English sentence to translate and say aloud; answer = the ideal ${lang} translation; ` +
        `explanation = one sentence on the key translation points. Leave options = [], answer_index = 0, accept = []. ` +
        `If the request asks for a story, write a coherent short story in English and use its consecutive sentences as the prompts, in order.`,
    };
    return common + rules[type] + `\n\nFill every field; use ""/[]/0 for fields this type does not need.`;
  }

  function exerciseSchema() {
    return {
      type: "object",
      properties: {
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              answer_index: { type: "integer" },
              answer: { type: "string" },
              accept: { type: "array", items: { type: "string" } },
              explanation: { type: "string" },
            },
            required: ["prompt", "options", "answer_index", "answer", "accept", "explanation"],
            additionalProperties: false,
          },
        },
      },
      required: ["exercises"],
      additionalProperties: false,
    };
  }

  /* ---------------- rendering ---------------- */

  function render() {
    document.getElementById("dr-output").classList.remove("hidden");
    document.getElementById("dr-set-title").textContent = I18N.t("drills.setTitle", {
      n: current.exercises.length,
      type: typeLabel(current.type),
    });
    const list = document.getElementById("dr-list");
    list.innerHTML = "";
    current.exercises.forEach((ex, i) => list.appendChild(renderDrill(ex, i)));
    const summary = document.getElementById("dr-summary");
    summary.className = "feedback hidden";
    summary.textContent = "";
    document.getElementById("dr-output").scrollIntoView({ behavior: "smooth" });
  }

  function renderDrill(ex, i) {
    const type = current.type;
    const div = document.createElement("div");
    div.className = "drill exercise";

    const q = document.createElement("div");
    q.className = "q";
    q.textContent = `${i + 1}. ${ex.prompt}`;
    div.appendChild(q);

    const verdict = document.createElement("div");
    verdict.className = "verdict";

    if (type === "multiple_choice") {
      const opts = document.createElement("div");
      opts.className = "opts";
      ex.options.forEach((opt, oi) => {
        const b = document.createElement("button");
        b.className = "btn";
        b.textContent = opt;
        b.onclick = () => {
          if (current.scores[i] !== null) return;
          const right = oi === ex.answer_index;
          b.classList.add(right ? "correct" : "wrong");
          if (!right && opts.children[ex.answer_index]) {
            opts.children[ex.answer_index].classList.add("correct");
          }
          verdict.textContent = (right ? "✅ " : "❌ ") + ex.explanation;
          div.classList.add("graded");
          recordScore(i, right ? 100 : 0);
        };
        opts.appendChild(b);
      });
      div.appendChild(opts);
    } else if (type === "short_written" || type === "long_written") {
      const long = type === "long_written";
      const field = document.createElement(long ? "textarea" : "input");
      if (long) field.rows = 3;
      else field.type = "text";
      field.placeholder = I18N.t("drills.answerPh");
      const check = document.createElement("button");
      check.className = "btn small";
      check.textContent = I18N.t("drills.check");
      const row = document.createElement("div");
      row.className = "answer-row row gap wrap";
      row.append(field, check);
      div.appendChild(row);

      check.onclick = async () => {
        if (current.scores[i] !== null || !field.value.trim()) return;
        if (long) {
          check.disabled = true;
          verdict.textContent = I18N.t("drills.grading");
          try {
            const grade = await gradeAnswer(ex, field.value.trim(), false);
            showVerdict(verdict, grade);
            div.classList.add("graded");
            recordScore(i, grade.score);
          } catch (e) {
            verdict.textContent = I18N.t("drills.gradeFailed", { msg: e.message });
            check.disabled = false;
          }
        } else {
          // short written: local exact-ish match against answer + accepted variants
          const right = matchesShort(field.value, ex);
          verdict.textContent = right
            ? "✅ " + ex.explanation
            : `❌ ${I18N.t("drills.correctAnswer", { answer: ex.answer })} ${ex.explanation}`;
          div.classList.add("graded");
          recordScore(i, right ? 100 : 0);
        }
      };
    } else {
      // spoken / translate_spoken
      const status = document.createElement("div");
      status.className = "muted small";
      const heard = document.createElement("div");
      heard.className = "heard";
      const rec = document.createElement("button");
      rec.className = "btn record";
      rec.textContent = I18N.t("drills.record");
      const row = document.createElement("div");
      row.className = "answer-row row gap wrap";
      row.append(rec, status);
      div.append(row, heard);
      rec.onclick = () => recordAnswer(ex, i, { rec, status, heard, verdict, div });
    }

    div.appendChild(verdict);
    return div;
  }

  /* ---------------- short-answer local matching ---------------- */

  function matchesShort(value, ex) {
    const n = Speech.normalize(value);
    const candidates = [ex.answer, ...(ex.accept || [])].map((s) => Speech.normalize(s));
    return candidates.includes(n);
  }

  /* ---------------- spoken: record → transcribe → grade ---------------- */

  async function recordAnswer(ex, i, els) {
    if (current.scores[i] !== null) return;
    els.rec.disabled = true;
    els.rec.classList.add("armed");
    els.verdict.textContent = "";

    // Context for the speech-to-text model: the drill description plus this
    // exercise's (English) prompt. Deliberately NOT the expected answer — so the
    // recognizer is biased toward the topic, not handed the answer to echo back.
    const sttContext = [current.desc, ex.prompt].filter(Boolean).join(". ");

    let listener;
    try {
      listener = await Speech.listen({
        prompt: sttContext,
        onStatus: (s) => {
          if (s === "listening" || s === "hearing") els.status.textContent = I18N.t("listen.recording");
          else if (s === "transcribing") els.status.textContent = I18N.t("listen.transcribing");
        },
      });
    } catch (e) {
      App.toast(e.message);
      els.rec.disabled = false;
      els.rec.classList.remove("armed");
      return;
    }
    current.listener = listener;

    let transcript;
    try {
      transcript = await listener.result;
    } catch (e) {
      transcript = "";
    }
    current.listener = null;
    els.rec.classList.remove("armed");
    els.status.textContent = "";

    if (transcript === null) {
      // cancelled (e.g. navigated away)
      els.rec.disabled = false;
      return;
    }
    els.heard.textContent = transcript
      ? I18N.t("listen.youSaid", { heard: transcript })
      : I18N.t("listen.heardNothing");
    if (!transcript) {
      els.rec.disabled = false; // nothing heard — let them try again
      return;
    }

    els.verdict.textContent = I18N.t("drills.grading");
    try {
      const grade = await gradeAnswer(ex, transcript, true);
      showVerdict(els.verdict, grade);
      els.div.classList.add("graded");
      recordScore(i, grade.score);
    } catch (e) {
      els.verdict.textContent = I18N.t("drills.gradeFailed", { msg: e.message });
      els.rec.disabled = false;
    }
  }

  /* ---------------- AI grading (long written + all spoken) ---------------- */

  async function gradeAnswer(ex, attempt, spoken) {
    const lang = Store.app.language.name;
    const translate = current.type === "translate_spoken";
    const source = translate
      ? `English sentence to translate: ${ex.prompt}\n`
      : `Exercise prompt: ${ex.prompt}\n`;
    return AI.call({
      system: `You grade a learner's ${lang} answers to practice exercises. Be encouraging but accurate.`,
      user:
        source +
        `Ideal/model answer: ${ex.answer}\n` +
        `Learner's answer: ${attempt}\n` +
        (spoken
          ? `(This answer was transcribed from speech, so judge meaning and grammar leniently on minor ` +
            `spelling/homophone artifacts of transcription — focus on whether what they said is correct ${lang}.)\n`
          : "") +
        `Score the answer 0-100, give one sentence of feedback, and provide a corrected or ideal ${lang} version.`,
      schema: {
        type: "object",
        properties: {
          score: { type: "integer" },
          feedback: { type: "string" },
          corrected: { type: "string" },
        },
        required: ["score", "feedback", "corrected"],
        additionalProperties: false,
      },
      maxTokens: 1024,
      thinking: true,
    });
  }

  function showVerdict(verdictEl, grade) {
    const icon = grade.score >= 70 ? "✅ " : grade.score >= 40 ? "🟡 " : "❌ ";
    verdictEl.textContent =
      icon + `${grade.score}/100 — ${grade.feedback}` +
      (grade.corrected ? " " + I18N.t("drills.suggested", { corrected: grade.corrected }) : "");
  }

  /* ---------------- scoring / summary ---------------- */

  function recordScore(i, score) {
    current.scores[i] = score;
    if (current.scores.every((s) => s !== null)) finish();
  }

  function finish() {
    const scores = current.scores;
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    Store.updateSkill(TYPE_SKILL[current.type], avg, 0.1);
    App.renderDashboard();

    const summary = document.getElementById("dr-summary");
    summary.classList.remove("hidden");
    summary.className =
      "feedback " + (avg >= 70 ? "good" : avg >= 40 ? "meh" : "bad");
    summary.textContent = I18N.t("drills.complete", { n: scores.length, pct: avg });
    summary.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------------- lifecycle ---------------- */

  /** Cancel any in-progress recording (e.g. when navigating away). */
  function stopAll() {
    if (current && current.listener) {
      current.listener.cancel();
      current.listener = null;
    }
    Speech.stop();
  }

  function refresh() {
    // keep the "English → spoken {lang}" radio label in sync with the language
    const lbl = document.getElementById("dr-type-translate");
    if (lbl) lbl.textContent = typeLabel("translate_spoken");
    // a generated set belongs to one language; drop it on a language switch
    if (current && current.lang !== Store.app.language?.name) {
      current = null;
      document.getElementById("dr-output").classList.add("hidden");
      document.getElementById("dr-list").innerHTML = "";
    }
  }

  function init() {
    document.getElementById("dr-generate").onclick = generate;
    refresh();
  }

  return { init, refresh, stopAll };
})();
