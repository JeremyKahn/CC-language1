/* speech.js — Text-to-speech and speech recognition.
 *
 * Primary engine (when an OpenAI key is set): OpenAI gpt-4o-mini-tts for
 * speaking (steerable pace, clarity and expressiveness across many languages)
 * and gpt-4o-transcribe for recognizing the learner's speech. These are
 * currently the most suitable hosted models for multilingual spoken
 * interaction.
 *
 * Fallback engine: Chrome's built-in Web Speech API (speechSynthesis +
 * webkitSpeechRecognition) — free, no key required. Any fallback is reported
 * to the caller via onEngine and a toast, never silently.
 */
"use strict";

const Speech = (() => {
  const OPENAI_TTS_CHAR_LIMIT = 3000; // API limit is 4096; chunk well below it

  let currentAudio = null;
  let speakToken = 0; // bumped by stop() to cancel an in-flight chunk sequence
  let micStream = null; // kept open for the whole session so Chrome (esp. on
  // file:// pages, where grants are never remembered) asks for the mic once
  let recChunks = [];

  function engine() {
    const s = Store.app.settings;
    if (s.speech === "openai") return "openai";
    if (s.speech === "browser") return "browser";
    return (s.openaiKey || "").trim() ? "openai" : "browser";
  }

  function bcp() {
    return Store.app.language?.bcp || "en-US";
  }

  function langName() {
    return Store.app.language?.name || "English";
  }

  /* ---------------- TTS ---------------- */

  /** Speak text. `slow` may be false, true (very slow/careful), or "gentle"
   *  (a little slower than normal). onEngine (optional) is called when playback
   *  starts with {engine, voice, fallback?} describing what is ACTUALLY used. */
  async function speak(text, { slow = false, onEngine = null } = {}) {
    stop();
    const token = speakToken;
    if (engine() === "openai") {
      try {
        return await speakOpenAI(text, slow, onEngine, token);
      } catch (e) {
        if (token !== speakToken) return; // cancelled, not an error
        console.warn("OpenAI TTS failed, falling back to browser:", e);
        window.App?.toast("OpenAI voice failed (" + e.message + ") — using browser voice.");
        return speakBrowser(text, slow, onEngine, e.message);
      }
    }
    return speakBrowser(text, slow, onEngine);
  }

  /** Split text into chunks below the OpenAI input limit, on sentence (then
   *  word) boundaries, so long reading texts can be spoken. */
  function chunkText(text, max = OPENAI_TTS_CHAR_LIMIT) {
    if (text.length <= max) return [text];
    const sentences = text.match(/[^.!?。！？؟\n]+[.!?。！？؟]*\s*|\n+/g) || [text];
    const chunks = [];
    let cur = "";
    for (let s of sentences) {
      while (s.length > max) {
        // pathological sentence longer than the limit: hard-split on spaces
        let cut = s.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        if (cur) {
          chunks.push(cur);
          cur = "";
        }
        chunks.push(s.slice(0, cut));
        s = s.slice(cut);
      }
      if (cur.length + s.length > max) {
        chunks.push(cur);
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur.trim()) chunks.push(cur);
    return chunks;
  }

  async function speakOpenAI(text, slow, onEngine, token) {
    const key = Store.app.settings.openaiKey.trim();
    if (!key) throw new Error("no OpenAI key set");
    const voice = Store.app.settings.voice || "alloy";
    const instructions =
      slow === "gentle"
        ? `Speak in ${langName()}. Speak a little more slowly than a normal pace, clearly and warmly, like gently helping a learner repeat the phrase.`
        : slow
          ? `Speak in ${langName()}. Speak very slowly and extremely clearly, with a short pause between each word, enunciating every syllable, like a patient teacher helping a beginner repeat the phrase.`
          : `Read aloud in ${langName()} like a skilled, engaged audiobook narrator: natural, expressive intonation, varied pitch and rhythm, conveying the meaning and feeling of the text. Articulate clearly at a relaxed pace suitable for a language learner.`;

    const chunks = chunkText(text);
    let announced = false;
    for (const chunk of chunks) {
      if (token !== speakToken) return;
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice,
          input: chunk,
          instructions,
          response_format: "mp3",
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`OpenAI TTS ${resp.status}: ${err.error?.message || resp.statusText}`);
      }
      const blob = await resp.blob();
      if (token !== speakToken) return;
      if (!announced) {
        announced = true;
        onEngine?.({ engine: "openai", voice });
      }
      await playBlob(blob, slow, token);
    }
  }

  function playBlob(blob, slow, token) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      currentAudio = new Audio(url);
      // belt-and-braces on top of the spoken-pace instructions
      currentAudio.playbackRate = slow === "gentle" ? 0.92 : slow ? 0.85 : 1;
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      currentAudio.onpause = () => {
        // stop() pauses us mid-chunk: end quietly
        if (token !== speakToken) {
          URL.revokeObjectURL(url);
          resolve();
        }
      };
      currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      currentAudio.play().catch(reject);
    });
  }

  /** Chrome populates speechSynthesis.getVoices() asynchronously; wait for it. */
  function voicesReady() {
    return new Promise((resolve) => {
      const have = speechSynthesis.getVoices();
      if (have.length) return resolve(have);
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve(speechSynthesis.getVoices());
        }
      };
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 1200);
    });
  }

  function pickBrowserVoice(voices) {
    const prefix = bcp().slice(0, 2).toLowerCase();
    const match = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    if (!match.length) return null;
    // prefer Chrome's network "Google …" voices and OS "natural/premium" ones
    return (
      match.find((v) => /google/i.test(v.name)) ||
      match.find((v) => /natural|premium|enhanced|neural/i.test(v.name)) ||
      match.find((v) => v.lang.toLowerCase() === bcp().toLowerCase()) ||
      match[0]
    );
  }

  async function speakBrowser(text, slow, onEngine, fallbackReason) {
    if (!("speechSynthesis" in window)) {
      throw new Error("This browser has no speech synthesis. Add an OpenAI key in Settings.");
    }
    const voices = await voicesReady();
    const voice = pickBrowserVoice(voices);
    onEngine?.({
      engine: "browser",
      voice: voice ? voice.name : `default for ${bcp()}`,
      fallback: fallbackReason,
    });
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = bcp();
      u.rate = slow === "gentle" ? 0.78 : slow ? 0.55 : 0.9;
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") resolve();
        else reject(new Error("Speech synthesis error: " + e.error));
      };
      speechSynthesis.speak(u);
    });
  }

  function stop() {
    speakToken++;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  /* ---------------- Microphone ---------------- */

  /** One mic stream per session. Chrome never remembers the permission for
   *  file:// pages, so releasing the stream after each recording would cause
   *  a permission prompt on every attempt. */
  async function getMicStream() {
    if (micStream && micStream.getTracks().some((t) => t.readyState === "live")) {
      return micStream;
    }
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return micStream;
  }

  function releaseMic() {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
  }
  window.addEventListener("pagehide", releaseMic);

  /* ---------------- Recognition ---------------- */

  /** Start an automatic recording session. Returns {stop, cancel, result}:
   *  - result resolves to the transcript, or null if cancel() was called;
   *  - recording ends BY ITSELF when the speaker falls silent (voice-activity
   *    detection for the OpenAI engine; the Web Speech API does this natively);
   *  - stop() forces an early finish, cancel() discards the recording.
   *  onStatus receives "listening" | "hearing" | "transcribing". */
  async function listen({ onStatus } = {}) {
    if (engine() === "openai") return listenOpenAI(onStatus);
    return listenBrowser(onStatus);
  }

  let audioCtx = null; // shared; created after the first user gesture

  async function listenOpenAI(onStatus) {
    const stream = await getMicStream();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    recChunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    rec.start();
    onStatus?.("listening");

    let cancelled = false;
    let resolveResult, rejectResult;
    const result = new Promise((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    // Voice-activity detection: estimate the noise floor for 400ms, then
    // treat RMS spikes above it as speech; finish after sustained silence.
    const CALIBRATE_MS = 400;
    const SILENCE_MS = 1400; // pause that ends the recording once speech began
    const NOSPEECH_MS = 8000; // give up if the learner never speaks
    const MAX_MS = 25000;
    const t0 = performance.now();
    let speechStarted = false;
    let lastVoice = 0;
    let floorSum = 0;
    let floorN = 0;

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - t0 < CALIBRATE_MS) {
        floorSum += rms;
        floorN++;
        return;
      }
      const thresh = Math.max(0.012, (floorSum / Math.max(1, floorN)) * 3);
      if (rms > thresh) {
        if (!speechStarted) onStatus?.("hearing");
        speechStarted = true;
        lastVoice = now;
      }
      if (
        (speechStarted && now - lastVoice > SILENCE_MS) ||
        (!speechStarted && now - t0 > NOSPEECH_MS) ||
        now - t0 > MAX_MS
      ) {
        finish();
      }
    }, 100);

    function finish() {
      if (rec.state === "inactive") return;
      clearInterval(timer);
      try {
        source.disconnect();
      } catch (e) {
        /* already disconnected */
      }
      rec.onstop = async () => {
        // NB: the mic stream stays open (see getMicStream) — no track.stop()
        if (cancelled) return resolveResult(null);
        onStatus?.("transcribing");
        try {
          const blob = new Blob(recChunks, { type: rec.mimeType || "audio/webm" });
          resolveResult(await transcribeOpenAI(blob));
        } catch (e) {
          rejectResult(e);
        }
      };
      rec.stop();
    }

    return {
      stop: finish,
      cancel: () => {
        cancelled = true;
        finish();
      },
      result,
    };
  }

  function listenBrowser(onStatus) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error("This browser has no speech recognition. Use Chrome, or add an OpenAI key in Settings.");
    }
    const rec = new SR();
    rec.lang = bcp();
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let transcript = "";
    let cancelled = false;
    let resolveResult, rejectResult;
    const result = new Promise((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });
    rec.onresult = (e) => {
      transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
      onStatus?.("hearing");
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        rejectResult(new Error("Speech recognition error: " + e.error));
      }
    };
    rec.onend = () => resolveResult(cancelled ? null : transcript); // auto-ends on silence
    rec.start();
    onStatus?.("listening");

    return {
      stop: () => rec.stop(),
      cancel: () => {
        cancelled = true;
        rec.abort();
      },
      result,
    };
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

  return { speak, stop, listen, similarity, normalize, engine, releaseMic };
})();
