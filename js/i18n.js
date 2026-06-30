/* i18n.js — Optional interface localization into the language being learned.
 *
 * One canonical English string table (EN) is the source of truth. Every static
 * UI string is tagged in the HTML with data-i18n / data-i18n-ph (placeholder) /
 * data-i18n-title (title attr); dynamic strings (feedback, toasts) call t().
 *
 * French is shipped built-in (instant, offline, hand-checked). For any other
 * language, the whole table is translated by one cached Claude call the first
 * time the option is enabled, then stored in localStorage.
 */
"use strict";

const I18N = (() => {
  const EN = {
    // header / nav
    "chip.title": "Click to switch user / language",
    "settings.title": "Settings",
    "tab.dashboard": "📊 Dashboard",
    "tab.listen": "🎧 Listen & Repeat",
    "tab.reading": "📖 Reading",
    "tab.vocab": "📚 Vocabulary",
    "tab.grammar": "🧩 Grammar",
    "tab.drills": "🎯 Drills",

    // dashboard
    "dash.title": "Your progress in {lang}",
    "dash.mastered": "words mastered",
    "dash.learning": "words learning",
    "dash.listenLevel": "listen & repeat level",
    "dash.grammarMastered": "grammar elements mastered",
    "dash.gettingStarted": "Getting started",
    "dash.step1": "Open ⚙️ Settings and paste your Anthropic API key (required) and, ideally, an OpenAI API key for high-quality speech.",
    "dash.step2": "Add a few words you know to Vocabulary → Mastered, and words you're working on to Learning (or just start practising — the app builds your lists as you go).",
    "dash.step3": "Try Listen & Repeat to train listening and pronunciation, Reading for custom texts, and Grammar for a structured course.",
    "skill.grammar": "Grammar",
    "skill.vocabulary": "Vocabulary",
    "skill.listening": "Listening comprehension",
    "skill.pronunciation": "Pronunciation",
    "skill.reading": "Reading comprehension",

    // listen & repeat
    "listen.h2": "Listen & Repeat",
    "listen.difficulty": "Difficulty level:",
    "listen.cutExcellent": "Difficulty-up cutoff (excellent)",
    "listen.cutPass": "Next-phrase cutoff (pass)",
    "listen.replay": "🔊 Play again",
    "listen.replaySlow": "🐢 Slowly",
    "listen.show": "👁 Show text",
    "listen.start": "▶ Start session",
    "listen.record": "🎙 Record",
    "listen.skip": "Skip ↷",
    "listen.end": "⏹ End session",
    "listen.help": "The tutor says a phrase and the microphone opens automatically — just repeat it; recording stops by itself when you finish speaking. A near-perfect repeat raises the difficulty; a decent one moves on at the same level. If you miss, the phrase is repeated slowly; if you miss again, you get a simpler one.",
    // listen — dynamic
    "listen.recording": "🎙 Listening — speak now (click when done)",
    "listen.transcribing": "⏳ Transcribing…",
    "listen.youSaid": "🎙 You said: “{heard}”",
    "listen.heardNothing": "🎙 (heard nothing)",
    "listen.excellent": "✅ Excellent — {pct}% match. Difficulty up!",
    "listen.good": "👍 Good enough — {pct}% match. New phrase at the same level.",
    "listen.notQuiteAgain": "🤔 {pct}% — not quite. Listen and try again.",
    "listen.notQuiteSlow": "🤔 {pct}% — not quite. Now listen slowly and try once more.",
    "listen.notQuite": "🤔 {pct}% — not quite.",
    "listen.simpler": "💪 No problem — let's try something a little simpler.",
    "listen.streak": "🔥 streak: {n}",
    "listen.composing": "Composing a phrase…",
    "listen.ending": "Ending after this phrase…",
    "listen.newWords": "Added {n} new word(s) to your Learning list.",

    // reading
    "reading.h2": "Reading practice",
    "reading.length": "Length (words)",
    "reading.ratio": "Share of \"learning\" words",
    "reading.topic": "Topic (optional)",
    "reading.topicPh": "e.g. a trip to the market, football, a folk tale…",
    "reading.generate": "✍️ Generate text",
    "reading.pdf": "⬇️ Download PDF",
    "reading.readAloud": "🔊 Read aloud",
    "reading.stop": "⏹ Stop",
    "reading.glossary": "Glossary",
    "reading.translateAll": "🌐 Translate all",
    "reading.hide": "🙈 Hide",
    "reading.show": "👁 Show",
    "reading.addAll": "+ all → Learning",
    "reading.clear": "🗑 Clear",
    "reading.clickHint": "Click any word in the text below to add it to the glossary.",
    "reading.glossEmpty": "— glossary is empty —",
    "reading.understand": "How well did you understand it?",
    "reading.preparing": "Preparing audio…",
    // reading — sentence-by-sentence repeat practice
    "reading.practice": "🎙 Repeat sentence by sentence",
    "reading.practiceStop": "⏹ Stop practice",
    "reading.practiceIntro": "I'll read each sentence — repeat it after me. If you miss one, I'll break it into shorter phrases to repeat.",
    "reading.practiceSentence": "Sentence {i} of {n}",
    "reading.practicePhrase": "phrase {j} of {k}",
    "reading.practiceBreaking": "breaking it into phrases…",
    "reading.practiceDone": "Practice complete! 🎉",
    "reading.sumSatisfactory": "Sentences repeated satisfactorily on the first try: {pct}% ({pass} of {total})",
    "reading.sumOverall": "Average match on the full sentence: {pct}%",
    "reading.missedHint": "Missed words are shown in bold.",

    // vocab
    "vocab.h2": "Vocabulary",
    "vocab.wordPh": "word in target language",
    "vocab.transPh": "translation (or leave blank → AI)",
    "vocab.toLearning": "→ Learning",
    "vocab.toMastered": "→ Mastered",
    "vocab.add": "Add",
    "vocab.bulk": "Bulk add…",
    "vocab.bulkPh": "One word per line (optionally: word = translation). Missing translations are filled in by AI.",
    "vocab.bulkGo": "Add all to Learning",
    "vocab.learning": "Learning",
    "vocab.mastered": "Mastered",
    "vocab.anki": "🃏 Anki deck",
    "vocab.ankiHint": "Anki export downloads a ready-to-import .apkg deck (cards: word → translation + example sentence).",
    "vocab.empty": "No words yet.",

    // grammar
    "grammar.h2": "Grammar course",
    "grammar.intro": "The AI builds a sequenced grammar curriculum for your language, teaches each element with examples, then tests you on it.",
    "grammar.generate": "🧩 Generate curriculum",
    "grammar.curriculum": "Curriculum",
    "grammar.regen": "↻ Regenerate curriculum",
    "grammar.testMe": "📝 Test me on this",
    "grammar.exercises": "Exercises —",

    // drills
    "drills.h2": "Custom drills",
    "drills.describe": "Describe the exercises you want",
    "drills.descPh": "e.g. Drill me on the genders of common nouns; or: all tenses, moods and persons for 100 verbs; or: make a short story in English, then break it into sentences to translate aloud.",
    "drills.type": "Type of exercise",
    "drills.typeMc": "Multiple choice",
    "drills.typeShort": "Short written answer",
    "drills.typeLong": "Long written answer",
    "drills.typeSpoken": "Spoken answer",
    "drills.typeTranslate": "English → spoken {lang}",
    "drills.count": "Number of exercises",
    "drills.generate": "⚡ Generate exercises",
    // drills — dynamic
    "drills.needDesc": "Describe the exercises you want first.",
    "drills.generating": "Generating your exercises…",
    "drills.setTitle": "{n} exercises · {type}",
    "drills.check": "Check",
    "drills.record": "🎙 Record answer",
    "drills.answerPh": "Type your answer…",
    "drills.grading": "Grading…",
    "drills.gradeFailed": "Grading failed: {msg}",
    "drills.correctAnswer": "Correct answer: “{answer}”.",
    "drills.suggested": "Suggested: “{corrected}”",
    "drills.complete": "All {n} exercises complete — average score {pct}%.",

    // settings modal
    "set.title": "Settings",
    "set.anthropic": "Anthropic API key (text generation — required)",
    "set.model": "Claude model",
    "set.openai": "OpenAI API key (speech — recommended)",
    "set.speech": "Speech engine",
    "set.voice": "OpenAI voice",
    "set.test": "🔊 Test",
    "set.uiInLang": "Show the interface in the language I'm learning",
    "set.keysNote": "Keys are stored only in this browser's localStorage and sent only to api.anthropic.com / api.openai.com.",
    "set.cancel": "Cancel",
    "set.save": "Save",

    // profile modal
    "prof.title": "Who is learning what?",
    "prof.user": "Your name",
    "prof.userPh": "e.g. Jeremy",
    "prof.lang": "Language to learn",
    "prof.customName": "Language name",
    "prof.customCode": "BCP-47 code",
    "prof.start": "Start learning",

    // misc toasts
    "toast.settingsSaved": "Settings saved.",
    "toast.translatingUI": "Translating the interface…",
    "toast.uiReady": "Interface language ready.",
  };

  // Hand-checked French translation (built-in: instant, works offline).
  const FR = {
    "chip.title": "Cliquez pour changer d'utilisateur / de langue",
    "settings.title": "Paramètres",
    "tab.dashboard": "📊 Tableau de bord",
    "tab.listen": "🎧 Écouter et répéter",
    "tab.reading": "📖 Lecture",
    "tab.vocab": "📚 Vocabulaire",
    "tab.grammar": "🧩 Grammaire",
    "tab.drills": "🎯 Exercices",

    "dash.title": "Votre progression en {lang}",
    "dash.mastered": "mots maîtrisés",
    "dash.learning": "mots en apprentissage",
    "dash.listenLevel": "niveau écouter et répéter",
    "dash.grammarMastered": "éléments de grammaire maîtrisés",
    "dash.gettingStarted": "Pour commencer",
    "dash.step1": "Ouvrez ⚙️ Paramètres et collez votre clé API Anthropic (obligatoire) et, idéalement, une clé API OpenAI pour une voix de qualité.",
    "dash.step2": "Ajoutez quelques mots que vous connaissez à Vocabulaire → Maîtrisés, et les mots que vous travaillez à En apprentissage (ou commencez simplement à pratiquer — l'application construit vos listes au fur et à mesure).",
    "dash.step3": "Essayez Écouter et répéter pour travailler la compréhension orale et la prononciation, Lecture pour des textes personnalisés, et Grammaire pour un cours structuré.",
    "skill.grammar": "Grammaire",
    "skill.vocabulary": "Vocabulaire",
    "skill.listening": "Compréhension orale",
    "skill.pronunciation": "Prononciation",
    "skill.reading": "Compréhension écrite",

    "listen.h2": "Écouter et répéter",
    "listen.difficulty": "Niveau de difficulté :",
    "listen.cutExcellent": "Seuil de montée en difficulté (excellent)",
    "listen.cutPass": "Seuil pour la phrase suivante (réussite)",
    "listen.replay": "🔊 Réécouter",
    "listen.replaySlow": "🐢 Lentement",
    "listen.show": "👁 Afficher le texte",
    "listen.start": "▶ Démarrer la séance",
    "listen.record": "🎙 Enregistrer",
    "listen.skip": "Passer ↷",
    "listen.end": "⏹ Terminer la séance",
    "listen.help": "Le tuteur prononce une phrase et le micro s'ouvre automatiquement — répétez-la ; l'enregistrement s'arrête tout seul quand vous avez fini de parler. Une répétition presque parfaite augmente la difficulté ; une répétition correcte passe à la suivante au même niveau. Si vous échouez, la phrase est répétée lentement ; si vous échouez encore, vous en recevez une plus simple.",
    "listen.recording": "🎙 À l'écoute — parlez maintenant (cliquez quand c'est fini)",
    "listen.transcribing": "⏳ Transcription…",
    "listen.youSaid": "🎙 Vous avez dit : « {heard} »",
    "listen.heardNothing": "🎙 (rien entendu)",
    "listen.excellent": "✅ Excellent — {pct}% de correspondance. Difficulté augmentée !",
    "listen.good": "👍 Assez bien — {pct}% de correspondance. Nouvelle phrase au même niveau.",
    "listen.notQuiteAgain": "🤔 {pct}% — pas tout à fait. Réécoutez et réessayez.",
    "listen.notQuiteSlow": "🤔 {pct}% — pas tout à fait. Écoutez maintenant lentement et réessayez.",
    "listen.notQuite": "🤔 {pct}% — pas tout à fait.",
    "listen.simpler": "💪 Pas de souci — essayons quelque chose d'un peu plus simple.",
    "listen.streak": "🔥 série : {n}",
    "listen.composing": "Composition d'une phrase…",
    "listen.ending": "Fin après cette phrase…",
    "listen.newWords": "{n} nouveau(x) mot(s) ajouté(s) à votre liste En apprentissage.",

    "reading.h2": "Exercice de lecture",
    "reading.length": "Longueur (mots)",
    "reading.ratio": "Proportion de mots « en apprentissage »",
    "reading.topic": "Sujet (facultatif)",
    "reading.topicPh": "ex. une visite au marché, le football, un conte…",
    "reading.generate": "✍️ Générer un texte",
    "reading.pdf": "⬇️ Télécharger le PDF",
    "reading.readAloud": "🔊 Lire à voix haute",
    "reading.stop": "⏹ Arrêter",
    "reading.glossary": "Glossaire",
    "reading.translateAll": "🌐 Tout traduire",
    "reading.hide": "🙈 Masquer",
    "reading.show": "👁 Afficher",
    "reading.addAll": "+ tout → En apprentissage",
    "reading.clear": "🗑 Vider",
    "reading.clickHint": "Cliquez sur un mot du texte ci-dessous pour l'ajouter au glossaire.",
    "reading.glossEmpty": "— le glossaire est vide —",
    "reading.understand": "Avez-vous bien compris le texte ?",
    "reading.preparing": "Préparation de l'audio…",
    "reading.practice": "🎙 Répéter phrase par phrase",
    "reading.practiceStop": "⏹ Arrêter l'exercice",
    "reading.practiceIntro": "Je lis chaque phrase — répétez-la après moi. Si vous en manquez une, je la découpe en segments plus courts à répéter.",
    "reading.practiceSentence": "Phrase {i} sur {n}",
    "reading.practicePhrase": "segment {j} sur {k}",
    "reading.practiceBreaking": "découpage en segments…",
    "reading.practiceDone": "Exercice terminé ! 🎉",
    "reading.sumSatisfactory": "Phrases répétées correctement du premier coup : {pct}% ({pass} sur {total})",
    "reading.sumOverall": "Correspondance moyenne sur la phrase entière : {pct}%",
    "reading.missedHint": "Les mots manqués sont affichés en gras.",

    "vocab.h2": "Vocabulaire",
    "vocab.wordPh": "mot dans la langue cible",
    "vocab.transPh": "traduction (ou laissez vide → IA)",
    "vocab.toLearning": "→ En apprentissage",
    "vocab.toMastered": "→ Maîtrisés",
    "vocab.add": "Ajouter",
    "vocab.bulk": "Ajout en lot…",
    "vocab.bulkPh": "Un mot par ligne (au besoin : mot = traduction). Les traductions manquantes sont fournies par l'IA.",
    "vocab.bulkGo": "Tout ajouter à En apprentissage",
    "vocab.learning": "En apprentissage",
    "vocab.mastered": "Maîtrisés",
    "vocab.anki": "🃏 Paquet Anki",
    "vocab.ankiHint": "L'export Anki télécharge un paquet .apkg prêt à importer (cartes : mot → traduction + phrase d'exemple).",
    "vocab.empty": "Aucun mot pour l'instant.",

    "grammar.h2": "Cours de grammaire",
    "grammar.intro": "L'IA construit un programme de grammaire progressif pour votre langue, enseigne chaque élément avec des exemples, puis vous teste dessus.",
    "grammar.generate": "🧩 Générer le programme",
    "grammar.curriculum": "Programme",
    "grammar.regen": "↻ Régénérer le programme",
    "grammar.testMe": "📝 Testez-moi là-dessus",
    "grammar.exercises": "Exercices —",

    "drills.h2": "Exercices personnalisés",
    "drills.describe": "Décrivez les exercices que vous voulez",
    "drills.descPh": "ex. Faites-moi travailler le genre des noms courants ; ou : tous les temps, modes et personnes pour 100 verbes ; ou : écrivez une courte histoire en anglais, puis découpez-la en phrases à traduire à voix haute.",
    "drills.type": "Type d'exercice",
    "drills.typeMc": "Choix multiple",
    "drills.typeShort": "Réponse écrite courte",
    "drills.typeLong": "Réponse écrite longue",
    "drills.typeSpoken": "Réponse orale",
    "drills.typeTranslate": "Anglais → {lang} à l'oral",
    "drills.count": "Nombre d'exercices",
    "drills.generate": "⚡ Générer les exercices",
    "drills.needDesc": "Décrivez d'abord les exercices que vous voulez.",
    "drills.generating": "Génération de vos exercices…",
    "drills.setTitle": "{n} exercices · {type}",
    "drills.check": "Vérifier",
    "drills.record": "🎙 Enregistrer la réponse",
    "drills.answerPh": "Saisissez votre réponse…",
    "drills.grading": "Évaluation…",
    "drills.gradeFailed": "Échec de l'évaluation : {msg}",
    "drills.correctAnswer": "Bonne réponse : « {answer} ».",
    "drills.suggested": "Suggestion : « {corrected} »",
    "drills.complete": "Les {n} exercices sont terminés — score moyen {pct}%.",

    "set.title": "Paramètres",
    "set.anthropic": "Clé API Anthropic (génération de texte — obligatoire)",
    "set.model": "Modèle Claude",
    "set.openai": "Clé API OpenAI (voix — recommandée)",
    "set.speech": "Moteur vocal",
    "set.voice": "Voix OpenAI",
    "set.test": "🔊 Tester",
    "set.uiInLang": "Afficher l'interface dans la langue que j'apprends",
    "set.keysNote": "Les clés sont stockées uniquement dans le localStorage de ce navigateur et envoyées uniquement à api.anthropic.com / api.openai.com.",
    "set.cancel": "Annuler",
    "set.save": "Enregistrer",

    "prof.title": "Qui apprend quoi ?",
    "prof.user": "Votre nom",
    "prof.userPh": "ex. Jeremy",
    "prof.lang": "Langue à apprendre",
    "prof.customName": "Nom de la langue",
    "prof.customCode": "Code BCP-47",
    "prof.start": "Commencer à apprendre",

    "toast.settingsSaved": "Paramètres enregistrés.",
    "toast.translatingUI": "Traduction de l'interface…",
    "toast.uiReady": "Langue de l'interface prête.",
  };

  const BUILTIN = { French: FR };

  let dict = EN; // active dictionary

  function interpolate(s, vars) {
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  function t(key, vars) {
    const s = dict[key] != null ? dict[key] : EN[key] != null ? EN[key] : key;
    return interpolate(s, vars);
  }

  /** Whether the UI is currently shown in the target language. */
  function active() {
    return dict !== EN;
  }

  /** Apply all tagged static strings in the DOM. */
  function applyStatic(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  function cacheKey(langName) {
    return "linguaforge.i18n." + langName;
  }

  /** Translate the whole EN table for a language via one Claude call. */
  async function fetchTranslation(langName) {
    const keys = Object.keys(EN);
    const out = await AI.call({
      system:
        `You localize a language-learning app's interface into ${langName}. ` +
        `Translate naturally and concisely, as a native UI would read. Keep any leading emoji and ` +
        `the {placeholders} in braces exactly as-is. Keep it short enough to fit buttons and labels.`,
      user:
        `Translate each interface string into ${langName}. Return a translation for every id.\n\n` +
        keys.map((k) => `${k}: ${EN[k]}`).join("\n"),
      schema: {
        type: "object",
        properties: {
          strings: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, text: { type: "string" } },
              required: ["id", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["strings"],
        additionalProperties: false,
      },
      maxTokens: 16000,
    });
    const d = {};
    for (const { id, text } of out.strings) if (id in EN) d[id] = text;
    return d;
  }

  /** Load (and cache) the dictionary for langName, or English if !on. */
  async function load(langName, on) {
    if (!on || langName === "English") {
      dict = EN;
      return;
    }
    if (BUILTIN[langName]) {
      dict = Object.assign({}, EN, BUILTIN[langName]);
      return;
    }
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(cacheKey(langName)));
    } catch (e) {
      /* ignore */
    }
    if (cached) {
      dict = Object.assign({}, EN, cached);
      return;
    }
    // need an AI translation
    App.toast(t("toast.translatingUI"));
    App.busy(t("toast.translatingUI"));
    try {
      const d = await fetchTranslation(langName);
      localStorage.setItem(cacheKey(langName), JSON.stringify(d));
      dict = Object.assign({}, EN, d);
      App.toast(t("toast.uiReady"));
    } catch (e) {
      dict = EN;
      App.toast("Could not translate the interface (" + e.message + ") — keeping English.");
    } finally {
      App.busy(false);
    }
  }

  /** True if this language can be shown instantly (built-in or cached). */
  function isInstant(langName) {
    if (langName === "English" || BUILTIN[langName]) return true;
    return !!localStorage.getItem(cacheKey(langName));
  }

  return { t, applyStatic, load, active, isInstant, EN };
})();
