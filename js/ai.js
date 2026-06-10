/* ai.js — Claude API client (raw HTTP: this is a no-build static page, so the
 * official JS SDK isn't bundled; requests follow the documented Messages API
 * shape with the browser-access header). The user supplies their own key. */
"use strict";

const AI = (() => {
  const API_URL = "https://api.anthropic.com/v1/messages";

  function key() {
    return (Store.app.settings.anthropicKey || "").trim();
  }

  function model() {
    return Store.app.settings.model || "claude-opus-4-8";
  }

  function requireKey() {
    if (!key()) {
      throw new Error("No Anthropic API key set. Open ⚙️ Settings and paste your key.");
    }
  }

  async function call({ system, user, schema, maxTokens = 4096, thinking = false }) {
    requireKey();
    const body = {
      model: model(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    };
    if (thinking) body.thinking = { type: "adaptive" };
    if (schema) body.output_config = { format: { type: "json_schema", schema } };

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let resp;
      try {
        resp = await fetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key(),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        lastErr = new Error("Network error reaching api.anthropic.com: " + e.message);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        const text = (data.content || []).find((b) => b.type === "text");
        if (!text) throw new Error("Claude returned no text (stop_reason: " + data.stop_reason + ")");
        return schema ? JSON.parse(text.text) : text.text;
      }
      const msg = data.error?.message || resp.statusText;
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(`Claude API ${resp.status}: ${msg}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (resp.status === 401) throw new Error("Anthropic API key rejected (401). Check it in ⚙️ Settings.");
      throw new Error(`Claude API ${resp.status}: ${msg}`);
    }
    throw lastErr;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Translate a batch of target-language words into English.
   *  Returns {word: translation}. */
  async function translateWords(words, language) {
    const out = await call({
      system: `You are a precise bilingual dictionary for ${language}.`,
      user:
        `Give a short English translation (1-4 words) for each ${language} word below.\n` +
        words.map((w) => `- ${w}`).join("\n"),
      schema: {
        type: "object",
        properties: {
          entries: {
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
        required: ["entries"],
        additionalProperties: false,
      },
      maxTokens: 4096,
    });
    const map = {};
    for (const e of out.entries) map[e.word] = e.translation;
    return map;
  }

  return { call, translateWords };
})();
