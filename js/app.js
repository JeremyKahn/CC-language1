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
    Listen.stopAll(); // cancel any active recording/audio when navigating
    Reading.stopPractice();
    Drills.stopAll();
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.getElementById("view-" + name).classList.add("active");
    document.querySelector(`.tab[data-view="${name}"]`).classList.add("active");
    if (name === "grammar") Grammar.refresh();
    if (name === "listen") Listen.refresh();
    if (name === "vocab") Vocab.render();
    if (name === "drills") Drills.refresh();
    if (name === "dashboard") renderDashboard();
  }

  /* ---------------- dashboard ---------------- */

  const SKILL_KEYS = ["grammar", "vocabulary", "listening", "pronunciation", "reading"];

  function renderDashboard() {
    const p = Store.profile;
    if (!p) return;
    const bars = document.getElementById("skill-bars");
    bars.innerHTML = "";
    for (const key of SKILL_KEYS) {
      const val = Math.round(p.skills[key]);
      const row = document.createElement("div");
      row.className = "skill-row";
      const label = document.createElement("span");
      label.textContent = I18N.t("skill." + key);
      const bar = document.createElement("div");
      bar.className = "skill-bar";
      bar.innerHTML = `<div style="width:${val}%"></div>`;
      const num = document.createElement("b");
      num.textContent = val;
      row.append(label, bar, num);
      bars.appendChild(row);
    }
    document.getElementById("stat-mastered").textContent = Object.keys(p.vocab.mastered).length;
    document.getElementById("stat-learning").textContent = Object.keys(p.vocab.learning).length;
    document.getElementById("stat-listen-level").textContent = Math.round(p.listen.level);
    const done = Object.values(p.grammar.progress).filter((x) => x.done).length;
    document.getElementById("stat-grammar").textContent = `${done}/${p.grammar.curriculum.length || 0}`;
    document.getElementById("dash-title").textContent = I18N.t("dash.title", { lang: Store.app.language.name });
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
    document.getElementById("set-ui-lang").checked = !!s.uiInLang;
    const backdrop = document.getElementById("modal-backdrop");
    backdrop.classList.remove("hidden");
    backdrop.dataset.cancellable = "1";
    document.getElementById("modal-settings").classList.remove("hidden");
    document.getElementById("modal-profile").classList.add("hidden");
  }

  /** (Re)load the interface language and re-render everything. */
  async function applyUiLanguage() {
    await I18N.load(Store.app.language?.name, Store.app.settings.uiInLang);
    I18N.applyStatic();
    refreshAll();
  }

  const VOICE_SAMPLES = {
    es: "¡Hola! ¿Qué tal? Esta es una prueba de la voz.",
    fr: "Bonjour ! Comment allez-vous ? Ceci est un essai de la voix.",
    de: "Hallo! Wie geht es dir? Dies ist ein Stimmtest.",
    it: "Ciao! Come stai? Questa è una prova della voce.",
    pt: "Olá! Tudo bem? Este é um teste de voz.",
    ja: "こんにちは！お元気ですか？これは音声のテストです。",
    zh: "你好！你好吗？这是语音测试。",
    ko: "안녕하세요! 잘 지내세요? 음성 테스트입니다.",
    ru: "Привет! Как дела? Это проверка голоса.",
    ar: "مرحباً! كيف حالك؟ هذا اختبار للصوت.",
    hi: "नमस्ते! आप कैसे हैं? यह आवाज़ की जाँच है।",
    nl: "Hallo! Hoe gaat het? Dit is een stemtest.",
    pl: "Cześć! Jak się masz? To jest test głosu.",
    tr: "Merhaba! Nasılsın? Bu bir ses testi.",
    sv: "Hej! Hur mår du? Det här är ett rösttest.",
    el: "Γεια σου! Τι κάνεις; Αυτή είναι μια δοκιμή φωνής.",
    he: "שלום! מה שלומך? זוהי בדיקת קול.",
    vi: "Xin chào! Bạn khỏe không? Đây là bài kiểm tra giọng nói.",
    en: "Hello! How are you? This is a voice test.",
  };

  function testVoice() {
    // apply the modal's current values in memory so the test reflects them
    const s = Store.app.settings;
    s.anthropicKey = document.getElementById("set-anthropic-key").value.trim();
    s.openaiKey = document.getElementById("set-openai-key").value.trim();
    s.speech = document.getElementById("set-speech").value;
    s.voice = document.getElementById("set-voice").value;
    const iso = (Store.app.language?.bcp || "en-US").slice(0, 2);
    const sample = VOICE_SAMPLES[iso] || VOICE_SAMPLES.en;
    Speech.speak(sample, {
      onEngine: (info) =>
        toast(
          info.engine === "openai"
            ? `Using OpenAI gpt-4o-mini-tts, voice “${info.voice}”`
            : `Using browser voice “${info.voice}”` +
              (info.fallback ? ` — OpenAI failed: ${info.fallback}` : "")
        ),
    }).catch((e) => toast(e.message));
  }

  function saveSettings() {
    const s = Store.app.settings;
    const uiWas = s.uiInLang;
    s.anthropicKey = document.getElementById("set-anthropic-key").value.trim();
    s.openaiKey = document.getElementById("set-openai-key").value.trim();
    s.model = document.getElementById("set-model").value;
    s.speech = document.getElementById("set-speech").value;
    s.voice = document.getElementById("set-voice").value;
    s.uiInLang = document.getElementById("set-ui-lang").checked;
    Store.saveApp();
    closeModals();
    toast(I18N.t("toast.settingsSaved"));
    if (s.uiInLang !== uiWas) applyUiLanguage(); // toggle changed — relocalize
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
    applyUiLanguage(); // language changed → relocalize the interface, then render
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
    Drills.refresh();
  }

  /* ---------------- init ---------------- */

  function init() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.onclick = () => showView(t.dataset.view);
    });
    document.getElementById("btn-settings").onclick = openSettings;
    document.getElementById("set-save").onclick = saveSettings;
    document.getElementById("set-test").onclick = testVoice;
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
    Drills.init();

    if (Store.app.user && Store.app.language) {
      Store.loadProfile();
      applyUiLanguage(); // localizes (if enabled) and renders
    } else {
      openProfile(false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return { toast, busy, renderDashboard };
})();
