/* storage.js — localStorage persistence, per user + language. */
"use strict";

const LANGUAGES = [
  { name: "Spanish", code: "es", bcp: "es-ES" },
  { name: "French", code: "fr", bcp: "fr-FR" },
  { name: "German", code: "de", bcp: "de-DE" },
  { name: "Italian", code: "it", bcp: "it-IT" },
  { name: "Portuguese", code: "pt", bcp: "pt-BR" },
  { name: "Japanese", code: "ja", bcp: "ja-JP" },
  { name: "Mandarin Chinese", code: "zh", bcp: "zh-CN" },
  { name: "Korean", code: "ko", bcp: "ko-KR" },
  { name: "Russian", code: "ru", bcp: "ru-RU" },
  { name: "Arabic", code: "ar", bcp: "ar-SA" },
  { name: "Hindi", code: "hi", bcp: "hi-IN" },
  { name: "Dutch", code: "nl", bcp: "nl-NL" },
  { name: "Polish", code: "pl", bcp: "pl-PL" },
  { name: "Turkish", code: "tr", bcp: "tr-TR" },
  { name: "Swedish", code: "sv", bcp: "sv-SE" },
  { name: "Greek", code: "el", bcp: "el-GR" },
  { name: "Hebrew", code: "he", bcp: "he-IL" },
  { name: "Vietnamese", code: "vi", bcp: "vi-VN" },
  { name: "English", code: "en", bcp: "en-US" },
];

const Store = (() => {
  const APP_KEY = "linguaforge.app";

  function loadApp() {
    try {
      return JSON.parse(localStorage.getItem(APP_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveApp(app) {
    localStorage.setItem(APP_KEY, JSON.stringify(app));
  }

  const app = Object.assign(
    {
      user: null,
      language: null, // {name, bcp}
      users: [],
      settings: {
        anthropicKey: "",
        openaiKey: "",
        model: "claude-opus-4-8",
        speech: "auto",
        voice: "alloy",
        uiInLang: false,
      },
    },
    loadApp()
  );

  function profileKey(user, langName) {
    return `linguaforge.profile.${user}.${langName}`;
  }

  function defaultProfile() {
    return {
      skills: { grammar: 0, vocabulary: 0, listening: 0, pronunciation: 0, reading: 0 },
      vocab: { mastered: {}, learning: {} }, // word -> {translation, addedAt, streak}
      listen: { level: 1, successes: 0, attempts: 0, recent: [], passCut: 75, excellentCut: 92 },
      grammar: { curriculum: [], current: 0, progress: {} }, // progress[idx] = {taught, score, done}
      reading: { sessions: 0 },
      // drills: saved drill definitions, wordlists, and spaced-repetition state.
      // srs["<drillId>::<wordlistId>"] = { completed, words: { word: {s, last, n} } }
      // — learning is tracked per (drill, wordlist) PAIR: the same word in two
      // different drills has two independent records.
      drills: { saved: [], wordlists: [], srs: {}, sel: { drill: null, wl: null } },
    };
  }

  let profile = null;

  function loadProfile() {
    if (!app.user || !app.language) {
      profile = null;
      return null;
    }
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(profileKey(app.user, app.language.name)));
    } catch (e) {
      /* corrupted entry — start fresh */
    }
    profile = Object.assign(defaultProfile(), p || {});
    // deep-merge nested defaults so old saves survive schema additions
    const d = defaultProfile();
    for (const k of Object.keys(d)) {
      if (typeof d[k] === "object" && !Array.isArray(d[k])) {
        profile[k] = Object.assign({}, d[k], profile[k]);
      }
    }
    return profile;
  }

  function saveProfile() {
    if (profile && app.user && app.language) {
      localStorage.setItem(profileKey(app.user, app.language.name), JSON.stringify(profile));
    }
  }

  function setSession(user, language) {
    app.user = user;
    app.language = language;
    if (!app.users.includes(user)) app.users.push(user);
    saveApp(app);
    loadProfile();
  }

  function updateSkill(name, target, weight) {
    // exponential moving average toward a target value (0-100)
    const s = profile.skills;
    s[name] = Math.max(0, Math.min(100, s[name] + weight * (target - s[name])));
    saveProfile();
  }

  function recomputeVocabSkill() {
    const m = Object.keys(profile.vocab.mastered).length;
    const l = Object.keys(profile.vocab.learning).length;
    // sqrt scale: ~100 mastered → 32, ~1000 mastered → 95+
    profile.skills.vocabulary = Math.min(100, Math.round(Math.sqrt(m) * 3 + Math.sqrt(l)));
    saveProfile();
  }

  return {
    LANGUAGES,
    app,
    saveApp: () => saveApp(app),
    get profile() {
      return profile;
    },
    loadProfile,
    saveProfile,
    setSession,
    updateSkill,
    recomputeVocabSkill,
  };
})();
