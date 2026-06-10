/* grammar.js — AI-generated grammar curriculum: a sequence of grammar
 * elements, each taught (description + example sentences) and then tested
 * (multiple choice, fill-in-the-blank, and AI-graded translation). */
"use strict";

const Grammar = (() => {
  let lessonIdx = null; // index of the element currently shown
  let quiz = null; // {exercises, answers: []}

  function g() {
    return Store.profile.grammar;
  }

  /* ---------------- curriculum ---------------- */

  async function generateCurriculum() {
    const lang = Store.app.language.name;
    App.busy("Designing your grammar course…");
    try {
      const out = await AI.call({
        system:
          `You are an expert ${lang} teacher and applied linguist designing a grammar syllabus ` +
          `for an adult self-learner whose native language is English.`,
        user:
          `Produce an ordered curriculum of 18-24 elements of ${lang} grammar, sequenced from the ` +
          `most fundamental to advanced, so that each element builds on the previous ones. ` +
          `Each element gets a short English title and a one-sentence summary of what it covers.`,
        schema: {
          type: "object",
          properties: {
            elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                },
                required: ["title", "summary"],
                additionalProperties: false,
              },
            },
          },
          required: ["elements"],
          additionalProperties: false,
        },
        maxTokens: 8192,
        thinking: true,
      });
      g().curriculum = out.elements;
      g().current = 0;
      g().progress = {};
      Store.saveProfile();
      renderCurriculum();
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  function renderCurriculum() {
    const cur = g().curriculum;
    document.getElementById("gr-intro").classList.toggle("hidden", cur.length > 0);
    document.getElementById("gr-curriculum").classList.toggle("hidden", cur.length === 0);
    if (!cur.length) return;
    const ol = document.getElementById("gr-list");
    ol.innerHTML = "";
    cur.forEach((el, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="title"></span><span class="summary"></span>`;
      li.querySelector(".title").textContent = el.title;
      li.querySelector(".summary").textContent = el.summary;
      if (g().progress[i]?.done) li.classList.add("done");
      if (i === g().current) li.classList.add("current");
      li.onclick = () => openLesson(i);
      ol.appendChild(li);
    });
    App.renderDashboard();
  }

  /* ---------------- lesson ---------------- */

  async function openLesson(i) {
    const lang = Store.app.language.name;
    const el = g().curriculum[i];
    lessonIdx = i;
    document.getElementById("gr-quiz").classList.add("hidden");

    let lesson = g().progress[i]?.lesson;
    if (!lesson) {
      App.busy(`Preparing lesson: ${el.title}…`);
      try {
        const priorTitles = g().curriculum.slice(0, i).map((e) => e.title);
        lesson = await AI.call({
          system: `You are an expert, friendly teacher of ${lang} for English speakers.`,
          user:
            `Teach this element of ${lang} grammar: "${el.title}" — ${el.summary}\n` +
            (priorTitles.length
              ? `The learner has already covered: ${priorTitles.join("; ")}. Build on that; don't re-teach it.\n`
              : `This is the learner's first lesson.\n`) +
            `Write:\n1. A clear explanation in English (a few short paragraphs; use plain text, no markdown syntax).\n` +
            `2. 6-8 example sentences in ${lang} that showcase this element, each with an English translation ` +
            `and a one-phrase note on how the element appears in that sentence.`,
          schema: {
            type: "object",
            properties: {
              explanation: { type: "string" },
              examples: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sentence: { type: "string" },
                    translation: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["sentence", "translation", "note"],
                  additionalProperties: false,
                },
              },
            },
            required: ["explanation", "examples"],
            additionalProperties: false,
          },
          maxTokens: 8192,
          thinking: true,
        });
        g().progress[i] = Object.assign({}, g().progress[i], { lesson, taught: true });
        Store.saveProfile();
      } catch (e) {
        App.toast(e.message);
        App.busy(false);
        return;
      }
      App.busy(false);
    }

    document.getElementById("gr-lesson").classList.remove("hidden");
    document.getElementById("gr-lesson-title").textContent = `${i + 1}. ${el.title}`;
    const body = document.getElementById("gr-lesson-body");
    body.innerHTML = "";
    const expl = document.createElement("p");
    expl.textContent = lesson.explanation;
    expl.style.whiteSpace = "pre-wrap";
    body.appendChild(expl);
    for (const ex of lesson.examples) {
      const div = document.createElement("div");
      div.className = "example";
      div.innerHTML = `<div class="s"></div><div class="tr"></div><div class="tr note"></div>
        <button class="btn small ghost">🔊</button>`;
      div.querySelector(".s").textContent = ex.sentence;
      div.querySelector(".tr").textContent = ex.translation;
      div.querySelector(".note").textContent = "▸ " + ex.note;
      div.querySelector("button").onclick = () =>
        Speech.speak(ex.sentence).catch((e) => App.toast(e.message));
      body.appendChild(div);
    }
    document.getElementById("gr-lesson").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------------- quiz ---------------- */

  async function startQuiz() {
    if (lessonIdx === null) return;
    const lang = Store.app.language.name;
    const el = g().curriculum[lessonIdx];
    App.busy("Writing exercises…");
    try {
      const out = await AI.call({
        system: `You write grammar exercises for learners of ${lang} (native language English).`,
        user:
          `Create 6 exercises testing mastery of "${el.title}" (${el.summary}) in ${lang}: ` +
          `2 of type "multiple_choice", 2 of type "fill_blank", 2 of type "translate".\n` +
          `Rules per type:\n` +
          `- multiple_choice: question (in English, may quote ${lang}), exactly 4 options, answer_index 0-3, ` +
          `and a one-sentence explanation of the correct answer.\n` +
          `- fill_blank: a ${lang} sentence containing ___ for the missing word(s), the answer that fills the ` +
          `blank, an English hint, and an explanation.\n` +
          `- translate: an English sentence (source) for the learner to translate into ${lang}, chosen so that ` +
          `translating it requires using this grammar element.\n` +
          `Fill every field; use "" / [] / 0 for fields a type doesn't need.`,
        schema: {
          type: "object",
          properties: {
            exercises: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["multiple_choice", "fill_blank", "translate"] },
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  answer_index: { type: "integer" },
                  sentence: { type: "string" },
                  answer: { type: "string" },
                  hint: { type: "string" },
                  source: { type: "string" },
                  explanation: { type: "string" },
                },
                required: [
                  "type", "question", "options", "answer_index",
                  "sentence", "answer", "hint", "source", "explanation",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["exercises"],
          additionalProperties: false,
        },
        maxTokens: 8192,
        thinking: true,
      });
      quiz = { exercises: out.exercises, scores: new Array(out.exercises.length).fill(null) };
      renderQuiz();
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  function renderQuiz() {
    const el = g().curriculum[lessonIdx];
    document.getElementById("gr-quiz").classList.remove("hidden");
    document.getElementById("gr-quiz-title").textContent = el.title;
    document.getElementById("gr-quiz-result").classList.add("hidden");
    const body = document.getElementById("gr-quiz-body");
    body.innerHTML = "";
    quiz.exercises.forEach((ex, i) => body.appendChild(renderExercise(ex, i)));
    document.getElementById("gr-quiz").scrollIntoView({ behavior: "smooth" });
  }

  function renderExercise(ex, i) {
    const div = document.createElement("div");
    div.className = "exercise";
    const q = document.createElement("div");
    q.className = "q";
    div.appendChild(q);
    const verdict = document.createElement("div");
    verdict.className = "verdict";

    if (ex.type === "multiple_choice") {
      q.textContent = `${i + 1}. ${ex.question}`;
      const opts = document.createElement("div");
      opts.className = "opts";
      ex.options.forEach((opt, oi) => {
        const b = document.createElement("button");
        b.className = "btn";
        b.textContent = opt;
        b.onclick = () => {
          if (quiz.scores[i] !== null) return;
          const right = oi === ex.answer_index;
          b.classList.add(right ? "correct" : "wrong");
          if (!right) opts.children[ex.answer_index].classList.add("correct");
          verdict.textContent = (right ? "✅ " : "❌ ") + ex.explanation;
          recordScore(i, right ? 100 : 0);
        };
        opts.appendChild(b);
      });
      div.appendChild(opts);
    } else if (ex.type === "fill_blank") {
      q.textContent = `${i + 1}. Fill in the blank (${ex.hint})`;
      const sent = document.createElement("div");
      sent.textContent = ex.sentence;
      sent.style.margin = "0.3rem 0";
      div.appendChild(sent);
      const input = document.createElement("input");
      input.type = "text";
      input.className = "blank";
      const check = document.createElement("button");
      check.className = "btn small";
      check.textContent = "Check";
      check.onclick = () => {
        if (quiz.scores[i] !== null) return;
        const right =
          Speech.normalize(input.value) === Speech.normalize(ex.answer);
        verdict.textContent = right
          ? "✅ " + ex.explanation
          : `❌ Correct answer: “${ex.answer}”. ${ex.explanation}`;
        recordScore(i, right ? 100 : 0);
      };
      const row = document.createElement("div");
      row.className = "row gap";
      row.append(input, check);
      div.appendChild(row);
    } else {
      // translate — graded by Claude
      q.textContent = `${i + 1}. Translate into ${Store.app.language.name}:`;
      const src = document.createElement("div");
      src.textContent = "“" + ex.source + "”";
      src.style.margin = "0.3rem 0";
      div.appendChild(src);
      const input = document.createElement("input");
      input.type = "text";
      const check = document.createElement("button");
      check.className = "btn small";
      check.textContent = "Check";
      check.onclick = async () => {
        if (quiz.scores[i] !== null || !input.value.trim()) return;
        check.disabled = true;
        verdict.textContent = "Grading…";
        try {
          const grade = await gradeTranslation(ex.source, input.value);
          verdict.textContent =
            (grade.score >= 70 ? "✅ " : grade.score >= 40 ? "🟡 " : "❌ ") +
            `${grade.score}/100 — ${grade.feedback}` +
            (grade.corrected ? ` Suggested: “${grade.corrected}”` : "");
          recordScore(i, grade.score);
        } catch (e) {
          verdict.textContent = "Grading failed: " + e.message;
          check.disabled = false;
        }
      };
      const row = document.createElement("div");
      row.className = "row gap";
      row.append(input, check);
      div.appendChild(row);
    }
    div.appendChild(verdict);
    return div;
  }

  async function gradeTranslation(source, attempt) {
    const lang = Store.app.language.name;
    const el = g().curriculum[lessonIdx];
    return AI.call({
      system: `You grade a learner's English→${lang} translations, focusing on the grammar element being practised.`,
      user:
        `Grammar element under test: "${el.title}" (${el.summary}).\n` +
        `English source: ${source}\n` +
        `Learner's ${lang} translation: ${attempt}\n` +
        `Score 0-100 (correct use of the target element weighs most; minor spelling slips are cheap), ` +
        `give one sentence of feedback, and a corrected/ideal version.`,
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

  function recordScore(i, score) {
    quiz.scores[i] = score;
    if (quiz.scores.every((s) => s !== null)) finishQuiz();
  }

  function finishQuiz() {
    const avg = Math.round(quiz.scores.reduce((a, b) => a + b, 0) / quiz.scores.length);
    const passed = avg >= 70;
    const prog = (g().progress[lessonIdx] = Object.assign({}, g().progress[lessonIdx]));
    prog.score = Math.max(prog.score || 0, avg);
    prog.done = prog.done || passed;
    if (passed && lessonIdx === g().current && g().current < g().curriculum.length - 1) {
      g().current++;
    }
    Store.saveProfile();

    // grammar skill = share of curriculum mastered, blended with latest score
    const total = g().curriculum.length;
    const done = Object.values(g().progress).filter((p) => p.done).length;
    Store.profile.skills.grammar = Math.round((done / total) * 90 + (avg / 100) * 10);
    Store.saveProfile();

    const res = document.getElementById("gr-quiz-result");
    res.classList.remove("hidden");
    res.className = "feedback " + (passed ? "good" : "meh");
    res.textContent = passed
      ? `🎉 ${avg}/100 — element mastered! The next element is unlocked.`
      : `${avg}/100 — review the lesson and try again (70 needed to advance).`;
    renderCurriculum();
  }

  function init() {
    document.getElementById("gr-generate").onclick = generateCurriculum;
    document.getElementById("gr-regen").onclick = () => {
      if (confirm("Regenerate the curriculum? Your per-element progress will be reset.")) {
        generateCurriculum();
      }
    };
    document.getElementById("gr-practice").onclick = startQuiz;
  }

  function refresh() {
    if (!Store.profile) return;
    lessonIdx = null;
    quiz = null;
    document.getElementById("gr-lesson").classList.add("hidden");
    document.getElementById("gr-quiz").classList.add("hidden");
    renderCurriculum();
  }

  return { init, refresh };
})();
