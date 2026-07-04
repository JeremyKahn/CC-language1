/* drills.js — Custom drills tab: saved drills, wordlists, spaced repetition.
 *
 * A DRILL is a saved definition: {id, title, desc, type, count}. Created and
 * edited in a form; auto-saved to the profile. Editing can overwrite the
 * drill or be saved as a new one.
 *
 * A WORDLIST is {id, name, kind: "static"|"dynamic", words, prompt, batch}.
 * Static lists are made by hand, by file upload, or AI-generated once.
 * Dynamic lists are AI-generated and GROW: when the learner has learned ≥75%
 * of the list's words (for the drill being practised), a new batch of `batch`
 * words — different from all existing ones — is generated and appended.
 *
 * SPACED REPETITION is tracked per (drill, wordlist) PAIR — the same word in
 * two drills (e.g. noun meaning vs noun gender) has independent records:
 *   srs["drillId::wlId"] = { completed, limit, words: { word: {s, last, n} } }
 *   - s     estimated probability (0-1) the learner answers this word right,
 *           updated after each drill by an EMA: s += 0.4*(score/100 - s),
 *           starting from 0.2 the first time a word appears. A word counts
 *           as LEARNED when s ≥ 0.8 (≈ three good answers in a row).
 *   - last  value of `completed` when the word last appeared (drill counts,
 *           not wall-clock time); n = times drilled.
 *   - limit (dynamic wordlists only) each pair's WINDOW into the wordlist:
 *           the words of a dynamic list are kept in generation order, and a
 *           pair is only drilled on the first `limit` of them, starting at
 *           the list's initial size. Learning 75% of the window extends it
 *           by `batch` — first unlocking words another drill's practice
 *           already generated, and only generating new words when the window
 *           passes the end of the list. So a list grown to 75 by a "meaning"
 *           drill still tests a fresh "gender" drill on the original 50
 *           until those genders are learned.
 * Selection of N exercise words: need = (1 - s) + 0.25·min(1, since/6) for
 * seen words (recent misses dominate; long-unseen adds a bonus), 0.9 for
 * never-seen words. Top N by need (with a little jitter); words that were
 * recently missed badly may be included twice; short lists cycle. The final
 * selection is shuffled and handed to the AI, one exercise per word. */
"use strict";

const Drills = (() => {
  let current = null; // active run: {drillId, wlId, type, desc, lang, words, exercises, scores, listener}
  let editingDrill; // undefined = form closed, null = creating, "<id>" = editing
  let editingWl; // same convention for the wordlist form

  const LEARNED_AT = 0.8; // s ≥ this → word is "learned"
  const GROW_AT = 0.75; // share of a dynamic list learned → add a new batch
  const EMA_ALPHA = 0.4;
  const S_INIT = 0.2;

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

  function el(id) {
    return document.getElementById(id);
  }

  function D() {
    const p = Store.profile;
    if (!p.drills) {
      p.drills = { saved: [], wordlists: [], srs: {}, sel: { drill: null, wl: null } };
    }
    if (!p.drills.sel) p.drills.sel = { drill: null, wl: null };
    return p.drills;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function typeLabel(type) {
    return I18N.t(TYPE_KEY[type], { lang: Store.app.language?.name || "" });
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ================= drills: list + form ================= */

  function renderSavedDrills() {
    const d = D();
    const list = el("dr-saved-list");
    list.innerHTML = "";
    el("dr-saved-empty").classList.toggle("hidden", d.saved.length > 0);
    for (const drill of d.saved) {
      const row = document.createElement("div");
      row.className = "saved-item" + (d.sel.drill === drill.id ? " selected" : "");
      const main = document.createElement("div");
      main.className = "saved-main";
      const t = document.createElement("div");
      t.className = "saved-title";
      t.textContent = drill.title;
      const m = document.createElement("div");
      m.className = "muted small";
      m.textContent = typeLabel(drill.type) + " · " + I18N.t("drills.nEx", { n: drill.count });
      main.append(t, m);
      const ops = document.createElement("div");
      ops.className = "row gap";
      const edit = document.createElement("button");
      edit.className = "btn small";
      edit.textContent = "✎";
      edit.onclick = (e) => {
        e.stopPropagation();
        openDrillForm(drill.id);
      };
      const del = document.createElement("button");
      del.className = "btn small ghost";
      del.textContent = "🗑";
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm(I18N.t("drills.deleteConfirm", { title: drill.title }))) return;
        d.saved = d.saved.filter((x) => x.id !== drill.id);
        for (const k of Object.keys(d.srs)) if (k.startsWith(drill.id + "::")) delete d.srs[k];
        if (d.sel.drill === drill.id) d.sel.drill = null;
        Store.saveProfile();
        renderAll();
      };
      ops.append(edit, del);
      row.append(main, ops);
      row.onclick = () => {
        d.sel.drill = drill.id;
        Store.saveProfile();
        renderAll();
      };
      list.appendChild(row);
    }
  }

  function openDrillForm(id) {
    editingDrill = id ?? null;
    const drill = id ? D().saved.find((x) => x.id === id) : null;
    el("dr-form-heading").textContent = I18N.t(drill ? "drills.formEdit" : "drills.formNew");
    el("dr-title").value = drill ? drill.title : "";
    el("dr-desc").value = drill ? drill.desc : "";
    el("dr-count").value = drill ? drill.count : 20;
    el("dr-choices").value = drill ? drill.choices || 4 : 4;
    const type = drill ? drill.type : "multiple_choice";
    document.querySelectorAll('input[name="dr-type"]').forEach((r) => (r.checked = r.value === type));
    updateChoicesVis();
    el("dr-save-new").classList.toggle("hidden", !drill);
    el("dr-form").classList.remove("hidden");
    el("dr-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function closeDrillForm() {
    editingDrill = undefined;
    el("dr-form").classList.add("hidden");
  }

  /** The choices count only applies to multiple-choice drills. */
  function updateChoicesVis() {
    const r = document.querySelector('input[name="dr-type"]:checked');
    el("dr-choices-wrap").classList.toggle("hidden", !r || r.value !== "multiple_choice");
  }

  function saveDrillForm(asNew) {
    const d = D();
    const desc = el("dr-desc").value.trim();
    if (!desc) return App.toast(I18N.t("drills.needDesc"));
    const title = el("dr-title").value.trim() || desc.slice(0, 40) + (desc.length > 40 ? "…" : "");
    const typeRadio = document.querySelector('input[name="dr-type"]:checked');
    const type = typeRadio ? typeRadio.value : "multiple_choice";
    let count = parseInt(el("dr-count").value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 100) count = 100;
    let choices = parseInt(el("dr-choices").value, 10);
    if (!Number.isFinite(choices) || choices < 2) choices = 2;
    if (choices > 8) choices = 8;

    if (editingDrill && !asNew) {
      const drill = d.saved.find((x) => x.id === editingDrill);
      if (drill) Object.assign(drill, { title, desc, type, count, choices });
      d.sel.drill = editingDrill;
    } else {
      const drill = { id: uid(), title, desc, type, count, choices };
      d.saved.push(drill);
      d.sel.drill = drill.id;
    }
    Store.saveProfile();
    closeDrillForm();
    renderAll();
    App.toast(I18N.t("drills.savedToast"));
  }

  /* ================= wordlists: list + form ================= */

  function renderWordlists() {
    const d = D();
    const list = el("wl-list");
    list.innerHTML = "";
    el("wl-empty").classList.toggle("hidden", d.wordlists.length > 0);

    // fixed "no wordlist" choice (run the drill from its description alone)
    const none = document.createElement("div");
    none.className = "saved-item" + (d.sel.wl === null ? " selected" : "");
    const noneLbl = document.createElement("div");
    noneLbl.className = "muted";
    noneLbl.textContent = I18N.t("drills.wlNone");
    none.appendChild(noneLbl);
    none.onclick = () => {
      d.sel.wl = null;
      Store.saveProfile();
      renderAll();
    };
    list.appendChild(none);

    for (const wl of d.wordlists) {
      const row = document.createElement("div");
      row.className = "saved-item" + (d.sel.wl === wl.id ? " selected" : "");
      const main = document.createElement("div");
      main.className = "saved-main";
      const t = document.createElement("div");
      t.className = "saved-title";
      t.textContent = (wl.kind === "dynamic" ? "🌱 " : "📌 ") + wl.name;
      const m = document.createElement("div");
      m.className = "muted small";
      m.textContent =
        I18N.t(wl.kind === "dynamic" ? "drills.dynamicShort" : "drills.staticShort") +
        " · " +
        I18N.t("drills.nWords", { n: wl.words.length });
      main.append(t, m);
      const ops = document.createElement("div");
      ops.className = "row gap";
      const edit = document.createElement("button");
      edit.className = "btn small";
      edit.textContent = "✎";
      edit.onclick = (e) => {
        e.stopPropagation();
        openWlForm(wl.id);
      };
      const del = document.createElement("button");
      del.className = "btn small ghost";
      del.textContent = "🗑";
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm(I18N.t("drills.wlDeleteConfirm", { name: wl.name }))) return;
        d.wordlists = d.wordlists.filter((x) => x.id !== wl.id);
        for (const k of Object.keys(d.srs)) if (k.endsWith("::" + wl.id)) delete d.srs[k];
        if (d.sel.wl === wl.id) d.sel.wl = null;
        Store.saveProfile();
        renderAll();
      };
      ops.append(edit, del);
      row.append(main, ops);
      row.onclick = () => {
        d.sel.wl = wl.id;
        Store.saveProfile();
        renderAll();
      };
      list.appendChild(row);
    }
  }

  function wlKind() {
    const r = document.querySelector('input[name="wl-kind"]:checked');
    return r ? r.value : "static";
  }

  function wlSrc() {
    const r = document.querySelector('input[name="wl-src"]:checked');
    return r ? r.value : "hand";
  }

  /** Show/hide the wordlist form's sub-sections for the current kind/source. */
  function updateWlFormVis() {
    const creating = editingWl === null;
    const dynamic = wlKind() === "dynamic";
    el("wl-src-row").classList.toggle("hidden", dynamic || !creating);
    el("wl-upload-row").classList.toggle("hidden", dynamic || !creating || wlSrc() !== "upload");
    const aiVisible = dynamic || (creating && wlSrc() === "ai");
    el("wl-ai-row").classList.toggle("hidden", !aiVisible);
    el("wl-batch-wrap").classList.toggle("hidden", !dynamic);
    // when editing, the list already has words: hide the initial-generation controls
    el("wl-count-wrap").classList.toggle("hidden", !creating);
    el("wl-gen").classList.toggle("hidden", !creating);
    el("wl-count-label").textContent = I18N.t(dynamic ? "drills.wlInitCount" : "drills.wlCount");
  }

  function openWlForm(id) {
    editingWl = id ?? null;
    const wl = id ? D().wordlists.find((x) => x.id === id) : null;
    el("wl-form-heading").textContent = I18N.t(wl ? "drills.wlFormEdit" : "drills.wlFormNew");
    el("wl-name").value = wl ? wl.name : "";
    el("wl-words").value = wl ? wl.words.join("\n") : "";
    el("wl-prompt").value = wl ? wl.prompt || "" : "";
    el("wl-batch").value = wl ? wl.batch || 10 : 10;
    el("wl-count").value = 30;
    el("wl-file").value = "";
    const kind = wl ? wl.kind : "static";
    document.querySelectorAll('input[name="wl-kind"]').forEach((r) => (r.checked = r.value === kind));
    document.querySelectorAll('input[name="wl-src"]').forEach((r) => (r.checked = r.value === "hand"));
    el("wl-save-new").classList.toggle("hidden", !wl);
    updateWlFormVis();
    el("wl-form").classList.remove("hidden");
    el("wl-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function closeWlForm() {
    editingWl = undefined;
    el("wl-form").classList.add("hidden");
  }

  /** Parse pasted/uploaded text into a deduplicated word array. Multi-line
   *  input: one word per line (anything after , ; tab or = is dropped — so
   *  "word = translation" files work). Single-line input: comma-separated. */
  function parseWords(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    let toks;
    if (lines.length > 1) toks = lines.map((l) => l.split(/[,;\t=]/)[0].trim());
    else toks = (lines[0] || "").split(/[,;\t]/).map((s) => s.trim());
    const seen = new Set();
    const out = [];
    for (const w of toks) {
      const k = w.toLowerCase();
      if (w && !seen.has(k)) {
        seen.add(k);
        out.push(w);
      }
    }
    return out;
  }

  function saveWlForm(asNew) {
    const d = D();
    const name = el("wl-name").value.trim();
    if (!name) return App.toast(I18N.t("drills.wlNeedName"));
    const kind = wlKind();
    const words = parseWords(el("wl-words").value);
    if (!words.length) return App.toast(I18N.t("drills.wlNeedWords"));
    const prompt = el("wl-prompt").value.trim();
    if (kind === "dynamic" && !prompt) return App.toast(I18N.t("drills.wlDynNeedPrompt"));
    let batch = parseInt(el("wl-batch").value, 10);
    if (!Number.isFinite(batch) || batch < 1) batch = 10;
    if (batch > 100) batch = 100;

    if (editingWl && !asNew) {
      const wl = d.wordlists.find((x) => x.id === editingWl);
      if (wl) {
        Object.assign(wl, { name, kind, words, prompt, batch });
        if (wl.initial == null) wl.initial = words.length; // pre-window profiles
      }
      d.sel.wl = editingWl;
    } else {
      // `initial` fixes the starting window every (drill, wordlist) pair gets
      // into a dynamic list, even after other drills have grown it
      const wl = { id: uid(), name, kind, words, prompt, batch, initial: words.length };
      d.wordlists.push(wl);
      d.sel.wl = wl.id;
    }
    Store.saveProfile();
    closeWlForm();
    renderAll();
    App.toast(I18N.t("drills.wlSavedToast"));
  }

  /** AI-generate words from the form's prompt into the review textarea. */
  async function genWlWords() {
    const prompt = el("wl-prompt").value.trim();
    if (!prompt) return App.toast(I18N.t("drills.wlNeedPrompt"));
    let count = parseInt(el("wl-count").value, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 500) count = 500;
    App.busy(I18N.t("drills.wlGenerating"));
    try {
      const words = await generateWords(prompt, count, []);
      el("wl-words").value = words.join("\n");
    } catch (e) {
      App.toast(e.message);
    } finally {
      App.busy(false);
    }
  }

  /** One AI call producing `count` words for `prompt`, none of them in `exclude`. */
  async function generateWords(prompt, count, exclude) {
    const lang = Store.app.language.name;
    const out = await AI.call({
      system: `You create vocabulary lists in ${lang} for a language learner (native language English).`,
      user:
        `Create exactly ${count} ${lang} words or short expressions matching this request: "${prompt}"\n` +
        `Give each in its normal dictionary form, one entry per item, no translations, no numbering, no duplicates.` +
        (exclude.length
          ? `\nThe list must NOT contain any of these (they are already in the wordlist): ${exclude.join(", ")}`
          : ""),
      schema: {
        type: "object",
        properties: { words: { type: "array", items: { type: "string" } } },
        required: ["words"],
        additionalProperties: false,
      },
      maxTokens: Math.min(16000, 500 + count * 25),
    });
    const seen = new Set(exclude.map((w) => w.toLowerCase()));
    const words = [];
    for (const w of out.words || []) {
      const t = w.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        words.push(t);
      }
    }
    if (!words.length) throw new Error("The AI returned no words — try rephrasing the prompt.");
    return words.slice(0, count);
  }

  function handleWlFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const words = parseWords(String(reader.result || ""));
      el("wl-words").value = words.join("\n");
      if (!el("wl-name").value.trim()) el("wl-name").value = file.name.replace(/\.[^.]*$/, "");
    };
    reader.readAsText(file);
  }

  /* ================= spaced repetition ================= */

  function pairKey(drillId, wlId) {
    return drillId + "::" + wlId;
  }

  function getPair(drillId, wlId) {
    const srs = D().srs;
    const k = pairKey(drillId, wlId);
    if (!srs[k]) srs[k] = { completed: 0, words: {} };
    return srs[k];
  }

  /** The pair for (drill, wordlist), with its window initialized/clamped for
   *  dynamic lists: a new pair starts at the list's initial size, not its
   *  current (possibly already-grown) size. */
  function pairFor(drillId, wl) {
    const pair = getPair(drillId, wl.id);
    if (wl.kind === "dynamic") {
      if (pair.limit == null) pair.limit = Math.min(wl.initial ?? wl.words.length, wl.words.length);
      if (pair.limit > wl.words.length) pair.limit = wl.words.length; // words were hand-removed
    }
    return pair;
  }

  /** The words this pair is currently drilled on (a dynamic list's window). */
  function activeWords(wl, pair) {
    return wl.kind === "dynamic" && pair.limit != null ? wl.words.slice(0, pair.limit) : wl.words;
  }

  /** How urgently a word needs to be drilled (see file header). */
  function need(pair, word) {
    const st = pair.words[word];
    if (!st) return 0.9; // never seen: high, but a fresh miss ranks higher
    const since = pair.completed - st.last;
    return 1 - st.s + 0.25 * Math.min(1, since / 6);
  }

  /** Pick n words for the next set: highest need first (a little jitter to
   *  vary ties), recently-missed words may appear twice, short lists cycle.
   *  Returned in random order. */
  function selectWords(pair, allWords, n) {
    const scored = allWords.map((w) => {
      const raw = need(pair, w);
      return { w, raw, jittered: raw + Math.random() * 0.08 };
    });
    scored.sort((a, b) => b.jittered - a.jittered);
    let sel = scored.slice(0, n).map((x) => x.w);
    if (sel.length < n) {
      // fewer words than exercises: cycle through, worst-known first
      let i = 0;
      while (sel.length < n) sel.push(scored[i++ % scored.length].w);
    } else {
      // a word the learner recently missed badly (seen, high need) earns a
      // second slot in the set, displacing the least-needed picks
      const dups = scored
        .filter((x) => pair.words[x.w] && x.raw >= 0.95)
        .slice(0, Math.floor(n / 5))
        .map((x) => x.w);
      if (dups.length) sel.splice(n - dups.length, dups.length, ...dups);
    }
    return shuffle(sel);
  }

  function learnedCount(pair, words) {
    return words.filter((w) => (pair.words[w]?.s ?? 0) >= LEARNED_AT).length;
  }

  /** After a completed set: EMA-update each drilled word, bump the pair's
   *  drill counter, and mark when each word was last seen. */
  function updateSrs(pair, words, scores) {
    words.forEach((w, i) => {
      if (scores[i] == null) return;
      const q = scores[i] / 100;
      const st = pair.words[w] || (pair.words[w] = { s: S_INIT, last: 0, n: 0 });
      st.s = Math.round((st.s + EMA_ALPHA * (q - st.s)) * 1000) / 1000;
      st.n++;
    });
    pair.completed++;
    for (const w of new Set(words)) {
      if (pair.words[w]) pair.words[w].last = pair.completed;
    }
    Store.saveProfile();
  }

  /** When ≥75% of this pair's window is learned, extend the window by a
   *  batch. Words another pair's practice already generated are unlocked
   *  first; new words are AI-generated only when the window passes the end
   *  of the list (and they're appended for every pair to reach later). */
  async function maybeGrowWordlist(wl, pair) {
    if (wl.kind !== "dynamic" || !wl.prompt) return;
    const active = activeWords(wl, pair);
    if (!active.length || learnedCount(pair, active) / active.length < GROW_AT) return;
    const oldLimit = pair.limit;
    const newLimit = oldLimit + (wl.batch || 10);
    const missing = newLimit - wl.words.length;
    if (missing > 0) {
      App.busy(I18N.t("drills.wlGrowing"));
      try {
        const fresh = await generateWords(wl.prompt, missing, wl.words);
        wl.words.push(...fresh);
      } catch (e) {
        App.toast(e.message);
      } finally {
        App.busy(false);
      }
    }
    pair.limit = Math.min(newLimit, wl.words.length);
    Store.saveProfile();
    renderWordlists();
    renderRun();
    const unlocked = pair.limit - oldLimit;
    if (unlocked > 0) {
      App.toast(
        missing > 0
          ? I18N.t("drills.wlGrew", { n: unlocked, name: wl.name })
          : I18N.t("drills.wlUnlocked", { n: unlocked, name: wl.name })
      );
    }
  }

  /* ================= run: generate + do a set ================= */

  function selectedDrill() {
    const d = D();
    return d.saved.find((x) => x.id === d.sel.drill) || null;
  }

  function selectedWl() {
    const d = D();
    return d.sel.wl ? d.wordlists.find((x) => x.id === d.sel.wl) || null : null;
  }

  function renderRun() {
    const info = el("dr-run-info");
    info.innerHTML = "";
    const drill = selectedDrill();
    el("dr-generate").disabled = !drill;
    if (!drill) {
      info.textContent = I18N.t("drills.runNoDrill");
      return;
    }
    const line1 = document.createElement("div");
    line1.textContent = I18N.t("drills.runInfo", {
      title: drill.title,
      type: typeLabel(drill.type),
      n: drill.count,
    });
    info.appendChild(line1);
    const wl = selectedWl();
    if (wl) {
      const pair = pairFor(drill.id, wl);
      const active = activeWords(wl, pair);
      const line2 = document.createElement("div");
      line2.textContent = I18N.t("drills.runInfoWl", {
        name: wl.name,
        total: active.length,
        learned: learnedCount(pair, active),
        completed: pair.completed,
      });
      const line3 = document.createElement("div");
      line3.textContent = I18N.t("drills.runSrsNote");
      info.append(line2, line3);
    }
  }

  async function generate() {
    const drill = selectedDrill();
    if (!drill) return App.toast(I18N.t("drills.runNoDrill"));
    const lang = Store.app.language.name;
    const wl = selectedWl();

    let words = null;
    if (wl) {
      const pair = pairFor(drill.id, wl);
      words = selectWords(pair, activeWords(wl, pair), drill.count);
    }
    const count = words ? words.length : drill.count;

    stopAll();
    App.busy(I18N.t("drills.generating"));
    try {
      const out = await AI.call({
        system:
          `You are an expert ${lang} teacher creating practice exercises for an adult learner whose ` +
          `native language is English. Follow the learner's request closely.`,
        user: buildPrompt(lang, drill.desc, drill.type, count, words, drill.choices || 4),
        schema: exerciseSchema(),
        maxTokens: Math.min(32000, 1500 + count * 320),
      });
      let exercises = (out.exercises || []).slice(0, count);
      if (!exercises.length) throw new Error("The AI returned no exercises — try rephrasing your request.");
      if (words && exercises.length < words.length) words = words.slice(0, exercises.length);
      current = {
        drillId: drill.id,
        wlId: wl ? wl.id : null,
        title: drill.title,
        type: drill.type,
        desc: drill.desc,
        lang,
        words, // null, or words[i] = target word of exercise i
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

  function buildPrompt(lang, desc, type, count, words, choices) {
    let common =
      `Create exactly ${count} ${lang} practice exercises.\n` +
      `Learner's request (follow it closely): "${desc}"\n\n`;
    if (words) {
      common +=
        `Each exercise must be built around one TARGET WORD from the numbered list below: ` +
        `the i-th exercise tests the i-th word (same order, one exercise per word; a repeated ` +
        `word gets a different exercise each time). The exercise must genuinely test the learner ` +
        `on that word in the way the request describes.\n` +
        words.map((w, i) => `${i + 1}. ${w}`).join("\n") +
        `\n\n`;
    }
    const rules = {
      multiple_choice:
        `Type: multiple choice.\n` +
        `For each exercise set: prompt = the question (in English, may quote ${lang}); ` +
        `options = exactly ${choices} answer choices; answer_index = the 0-based index (0-${choices - 1}) ` +
        `of the correct option; answer = the text of the correct option; explanation = one sentence on ` +
        `why it's correct. Leave accept = [].`,
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
        (words
          ? `Each English sentence must be chosen so its ${lang} translation requires the exercise's target word.`
          : `If the request asks for a story, write a coherent short story in English and use its consecutive sentences as the prompts, in order.`),
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

  /* ================= rendering a set ================= */

  function render() {
    el("dr-output").classList.remove("hidden");
    el("dr-set-title").textContent = I18N.t("drills.runSet", {
      title: current.title,
      n: current.exercises.length,
    });
    const list = el("dr-list");
    list.innerHTML = "";
    current.exercises.forEach((ex, i) => list.appendChild(renderDrill(ex, i)));
    const summary = el("dr-summary");
    summary.className = "feedback hidden";
    summary.textContent = "";
    el("dr-output").scrollIntoView({ behavior: "smooth" });
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

    const summary = el("dr-summary");
    summary.classList.remove("hidden");
    summary.className = "feedback " + (avg >= 70 ? "good" : avg >= 40 ? "meh" : "bad");
    summary.textContent = I18N.t("drills.complete", { n: scores.length, pct: avg });

    // spaced-repetition bookkeeping (only when a wordlist was used)
    const wl = current.wlId ? D().wordlists.find((x) => x.id === current.wlId) : null;
    if (current.words && wl) {
      const pair = pairFor(current.drillId, wl);
      updateSrs(pair, current.words, scores);
      const active = activeWords(wl, pair);
      summary.textContent +=
        " " +
        I18N.t("drills.learnedNow", {
          learned: learnedCount(pair, active),
          total: active.length,
        });
      renderRun();
      maybeGrowWordlist(wl, pair); // async; toasts if the list grows
    }
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

  function renderAll() {
    renderSavedDrills();
    renderWordlists();
    renderRun();
  }

  function refresh() {
    // keep the "English → spoken {lang}" radio label in sync with the language
    const lbl = el("dr-type-translate");
    if (lbl) lbl.textContent = typeLabel("translate_spoken");
    if (!Store.profile) return;
    // a generated set belongs to one language; drop it on a language switch
    if (current && current.lang !== Store.app.language?.name) {
      current = null;
      el("dr-output").classList.add("hidden");
      el("dr-list").innerHTML = "";
    }
    closeDrillForm();
    closeWlForm();
    renderAll();
  }

  function init() {
    el("dr-new").onclick = () => openDrillForm(null);
    document.querySelectorAll('input[name="dr-type"]').forEach((r) => (r.onchange = updateChoicesVis));
    el("dr-save").onclick = () => saveDrillForm(false);
    el("dr-save-new").onclick = () => saveDrillForm(true);
    el("dr-cancel").onclick = closeDrillForm;
    el("wl-new").onclick = () => openWlForm(null);
    el("wl-save").onclick = () => saveWlForm(false);
    el("wl-save-new").onclick = () => saveWlForm(true);
    el("wl-cancel").onclick = closeWlForm;
    el("wl-gen").onclick = genWlWords;
    el("wl-file").onchange = (e) => handleWlFile(e.target.files[0]);
    document.querySelectorAll('input[name="wl-kind"], input[name="wl-src"]').forEach((r) => {
      r.onchange = updateWlFormVis;
    });
    el("dr-generate").onclick = generate;
  }

  return { init, refresh, stopAll };
})();
