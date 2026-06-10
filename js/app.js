/* app.js — navigation, session (user + language) management, settings, dashboard. */
"use strict";

const App = (() => {
  /* ---------------- UI helpers ---------------- */

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  function busy(msg) {
    const el = document.getElementById("busy");
    if (msg) {
      document.getElementById("busy-msg").textContent = msg;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  /* ---------------- navigation ---------------- */

  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.getElementById("view-" + name).classList.add("active");
    document.querySelector(`.tab[data-view="${name}"]`).classList.add("active");
    if (name === "grammar") Grammar.refresh();
    if (name === "listen") Listen.refresh();
    if (name === "vocab") Vocab.render();
    if (name === "dashboard") renderDashboard();
  }

  /* ---------------- dashboard ---------------- */

  const SKILL_LABELS = {
    grammar: "Grammar",
    vocabulary: "Vocabulary",
    listening: "Listening comprehension",
    pronunciation: "Pronunciation",
    reading: "Reading comprehension",
  };

  function renderDashboard() {
    const p = Store.profile;
    if (!p) return;
    const bars = document.getElementById("skill-bars");
    bars.innerHTML = "";
    for (const [key, label] of Object.entries(SKILL_LABELS)) {
      const val = Math.round(p.skills[key]);
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `<span>${label}</span><div class="skill-bar"><div style="width:${val}%"></div></div><b>${val}</b>`;
      bars.appendChild(row);
    }
    document.getElementById("stat-mastered").textContent = Object.keys(p.vocab.mastered).length;
    document.getElementById("stat-learning").textContent = Object.keys(p.vocab.learning).length;
    document.getElementById("stat-listen-level").textContent = Math.round(p.listen.level);
    const done = Object.values(p.grammar.progress).filter((x) => x.done).length;
    document.getElementById("stat-grammar").textContent = `${done}/${p.grammar.curriculum.length || 0}`;
    document.querySelectorAll(".lang-name").forEach((el) => (el.textContent = Store.app.language.name));
    document.getElementById("who-chip").textContent = `${Store.app.user} · ${Store.app.language.name}`;
  }

  /* ---------------- settings modal ---------------- */

  function openSettings() {
    const s = Store.app.settings;
    document.getElementById("set-anthropic-key").value = s.anthropicKey;
    document.getElementById("set-openai-key").value = s.openaiKey;
    document.getElementById("set-model").value = s.model;
    document.getElementById("set-speech").value = s.speech;
    document.getElementById("set-voice").value = s.voice;
    const backdrop = document.getElementById("modal-backdrop");
    backdrop.classList.remove("hidden");
    backdrop.dataset.cancellable = "1";
    document.getElementById("modal-settings").classList.remove("hidden");
    document.getElementById("modal-profile").classList.add("hidden");
  }

  function saveSettings() {
    const s = Store.app.settings;
    s.anthropicKey = document.getElementById("set-anthropic-key").value.trim();
    s.openaiKey = document.getElementById("set-openai-key").value.trim();
    s.model = document.getElementById("set-model").value;
    s.speech = document.getElementById("set-speech").value;
    s.voice = document.getElementById("set-voice").value;
    Store.saveApp();
    closeModals();
    toast("Settings saved.");
  }

  /* ---------------- profile (user + language) modal ---------------- */

  function openProfile(cancellable) {
    const sel = document.getElementById("prof-lang");
    sel.innerHTML = "";
    for (const l of Store.LANGUAGES) {
      const o = document.createElement("option");
      o.value = l.name;
      o.textContent = l.name;
      sel.appendChild(o);
    }
    const other = document.createElement("option");
    other.value = "__custom__";
    other.textContent = "Other…";
    sel.appendChild(other);
    sel.onchange = () =>
      document.getElementById("prof-custom-wrap").classList.toggle("hidden", sel.value !== "__custom__");

    const dl = document.getElementById("prof-user-list");
    dl.innerHTML = "";
    for (const u of Store.app.users) {
      const o = document.createElement("option");
      o.value = u;
      dl.appendChild(o);
    }
    if (Store.app.user) document.getElementById("prof-user").value = Store.app.user;
    if (Store.app.language) sel.value = Store.app.language.name;

    const backdrop = document.getElementById("modal-backdrop");
    backdrop.classList.remove("hidden");
    document.getElementById("modal-profile").classList.remove("hidden");
    document.getElementById("modal-settings").classList.add("hidden");
    backdrop.dataset.cancellable = cancellable ? "1" : "";
  }

  function saveProfile() {
    const user = document.getElementById("prof-user").value.trim();
    if (!user) return toast("Enter your name.");
    const sel = document.getElementById("prof-lang");
    let language;
    if (sel.value === "__custom__") {
      const name = document.getElementById("prof-custom-name").value.trim();
      const code = document.getElementById("prof-custom-code").value.trim() || "en-US";
      if (!name) return toast("Enter the language name.");
      language = { name, bcp: code };
    } else {
      const l = Store.LANGUAGES.find((x) => x.name === sel.value);
      language = { name: l.name, bcp: l.bcp };
    }
    Store.setSession(user, language);
    closeModals();
    refreshAll();
    if (!Store.app.settings.anthropicKey) {
      openSettings();
      toast("Paste your Anthropic API key to enable the AI tutor.");
    }
  }

  function closeModals() {
    document.getElementById("modal-backdrop").classList.add("hidden");
    document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
  }

  function refreshAll() {
    renderDashboard();
    Vocab.render();
    Listen.refresh();
    Grammar.refresh();
  }

  /* ---------------- init ---------------- */

  function init() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.onclick = () => showView(t.dataset.view);
    });
    document.getElementById("btn-settings").onclick = openSettings;
    document.getElementById("set-save").onclick = saveSettings;
    document.getElementById("set-cancel").onclick = closeModals;
    document.getElementById("who-chip").onclick = () => openProfile(true);
    document.getElementById("prof-save").onclick = saveProfile;
    document.getElementById("modal-backdrop").onclick = (e) => {
      if (e.target.id === "modal-backdrop" && e.target.dataset.cancellable) closeModals();
    };

    Vocab.init();
    Listen.init();
    Reading.init();
    Grammar.init();

    if (Store.app.user && Store.app.language) {
      Store.loadProfile();
      refreshAll();
    } else {
      openProfile(false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return { toast, busy, renderDashboard };
})();
