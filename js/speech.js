/* speech.js — Text-to-speech and speech recognition.
 *
 * Primary engine (when an OpenAI key is set): OpenAI gpt-4o-mini-tts for
 * speaking (steerable pace and clarity across many languages) and
 * gpt-4o-transcribe for recognizing the learner's speech. These are currently
 * the most suitable hosted models for multilingual spoken interaction.
 *
 * Fallback engine: Chrome's built-in Web Speech API (speechSynthesis +
 * webkitSpeechRecognition) — free, no key required.
 */
"use strict";

const Speech = (() => {
  let currentAudio = null;
  let mediaRecorder = null;
  let recChunks = [];
  let browserRec = null;

  function engine() {
    const s = Store.app.settings;
    if (s.speech === "openai") return "openai";
    if (s.speech === "browser") return "browser";
    return s.openaiKey ? "openai" : "browser";
  }

  function bcp() {
    return Store.app.language?.bcp || "en-US";
  }

  function langName() {
    return Store.app.language?.name || "English";
  }

  /* ---------------- TTS ---------------- */

  async function speak(text, { slow = false } = {}) {
    stop();
    if (engine() === "openai") {
      try {
        return await speakOpenAI(text, slow);
      } catch (e) {
        console.warn("OpenAI TTS failed, falling back to browser:", e);
        return speakBrowser(text, slow);
      }
    }
    return speakBrowser(text, slow);
  }

  async function speakOpenAI(text, slow) {
    const key = Store.app.settings.openaiKey.trim();
    const instructions = slow
      ? `Speak in ${langName()}. Speak very slowly and extremely clearly, with a short pause between each word, enunciating every syllable, like a patient teacher helping a beginner repeat the phrase.`
      : `Speak in ${langName()}. Speak clearly at a relaxed, natural pace suitable for a language learner.`;
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: Store.app.settings.voice || "alloy",
        input: text,
        instructions,
        response_format: "mp3",
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`OpenAI TTS ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      currentAudio = new Audio(url);
      if (slow) currentAudio.playbackRate = 0.85; // belt-and-braces on top of instructions
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      currentAudio.onerror = () => reject(new Error("Audio playback failed"));
      currentAudio.play().catch(reject);
    });
  }

  function speakBrowser(text, slow) {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        return reject(new Error("This browser has no speech synthesis. Add an OpenAI key in Settings."));
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = bcp();
      u.rate = slow ? 0.55 : 0.9;
      const voice = speechSynthesis
        .getVoices()
        .find((v) => v.lang.toLowerCase().startsWith(bcp().slice(0, 2).toLowerCase()));
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = (e) => reject(new Error("Speech synthesis error: " + e.error));
      speechSynthesis.speak(u);
    });
  }

  function stop() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  /* ---------------- Recognition ---------------- */

  /** Start recording; returns a stop() function that resolves to the transcript. */
  async function startRecognition() {
    if (engine() === "openai") return startRecognitionOpenAI();
    return startRecognitionBrowser();
  }

  async function startRecognitionOpenAI() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    mediaRecorder.start();

    return () =>
      new Promise((resolve, reject) => {
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          try {
            const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || "audio/webm" });
            resolve(await transcribeOpenAI(blob));
          } catch (e) {
            reject(e);
          }
        };
        mediaRecorder.stop();
      });
  }

  async function transcribeOpenAI(blob) {
    const key = Store.app.settings.openaiKey.trim();
    const form = new FormData();
    form.append("file", blob, "speech.webm");
    form.append("model", "gpt-4o-transcribe");
    const iso = bcp().split("-")[0];
    if (iso) form.append("language", iso);
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`OpenAI transcription ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return data.text || "";
  }

  function startRecognitionBrowser() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error("This browser has no speech recognition. Use Chrome, or add an OpenAI key in Settings.");
    }
    browserRec = new SR();
    browserRec.lang = bcp();
    browserRec.interimResults = false;
    browserRec.maxAlternatives = 1;

    let transcript = "";
    let endResolve, endReject;
    const ended = new Promise((res, rej) => {
      endResolve = res;
      endReject = rej;
    });
    browserRec.onresult = (e) => {
      transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
    };
    browserRec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        endReject(new Error("Speech recognition error: " + e.error));
      }
    };
    browserRec.onend = () => endResolve(transcript);
    browserRec.start();

    return Promise.resolve(() => {
      browserRec.stop();
      return ended;
    });
  }

  /* ---------------- Comparison ---------------- */

  function normalize(s) {
    return s
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  /** Similarity 0..1 between what was expected and what was heard. */
  function similarity(expected, heard) {
    const a = normalize(expected);
    const b = normalize(heard);
    if (!a.length && !b.length) return 1;
    if (!a.length || !b.length) return 0;
    // strip spaces for char-level comparison so it also works for ja/zh
    const a2 = a.replace(/ /g, "");
    const b2 = b.replace(/ /g, "");
    return 1 - levenshtein(a2, b2) / Math.max(a2.length, b2.length);
  }

  return { speak, stop, startRecognition, similarity, normalize, engine };
})();
