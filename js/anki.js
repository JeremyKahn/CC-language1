/* anki.js — Build a genuine Anki .apkg deck in the browser.
 *
 * An .apkg file is a zip archive containing an SQLite database
 * (collection.anki2, schema version 11) plus a "media" manifest. We build the
 * database with sql.js (SQLite compiled to wasm) and zip it with JSZip, both
 * loaded on demand from a CDN. If the CDN is unreachable we fall back to a
 * TSV file that Anki can import via File → Import.
 */
"use strict";

const AnkiExport = (() => {
  const SQLJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js";
  const SQLJS_WASM_DIR = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
  const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  let sqlPromise = null;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + url));
      document.head.appendChild(s);
    });
  }

  async function getSql() {
    if (!sqlPromise) {
      sqlPromise = (async () => {
        if (!window.initSqlJs) await loadScript(SQLJS_URL);
        return window.initSqlJs({ locateFile: (f) => SQLJS_WASM_DIR + f });
      })();
    }
    return sqlPromise;
  }

  async function getJSZip() {
    if (!window.JSZip) await loadScript(JSZIP_URL);
    return window.JSZip;
  }

  async function sha1hex(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function guid() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let g = "";
    for (let i = 0; i < 10; i++) g += chars[Math.floor(Math.random() * chars.length)];
    return g;
  }

  const SCHEMA = `
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
      scm integer not null, ver integer not null, dty integer not null, usn integer not null,
      ls integer not null, conf text not null, models text not null, decks text not null,
      dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
      mod integer not null, usn integer not null, tags text not null, flds text not null,
      sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
      ord integer not null, mod integer not null, usn integer not null, type integer not null,
      queue integer not null, due integer not null, ivl integer not null, factor integer not null,
      reps integer not null, lapses integer not null, left integer not null, odue integer not null,
      odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
      ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null,
      time integer not null, type integer not null);
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid);
    CREATE INDEX ix_notes_csum on notes (csum);
  `;

  function modelJSON(mid, deckId, language) {
    return {
      [mid]: {
        id: mid,
        name: `LinguaForge ${language}`,
        type: 0,
        mod: Math.floor(Date.now() / 1000),
        usn: -1,
        sortf: 0,
        did: deckId,
        tmpls: [
          {
            name: "Card 1",
            ord: 0,
            qfmt: "<div class='w'>{{Word}}</div>",
            afmt:
              "{{FrontSide}}<hr id='answer'><div class='t'>{{Translation}}</div>" +
              "<div class='ex'>{{Example}}</div>",
            bqfmt: "",
            bafmt: "",
            did: null,
          },
        ],
        flds: [
          { name: "Word", ord: 0, sticky: false, rtl: false, font: "Arial", size: 24, media: [] },
          { name: "Translation", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
          { name: "Example", ord: 2, sticky: false, rtl: false, font: "Arial", size: 18, media: [] },
        ],
        css:
          ".card { font-family: georgia, serif; font-size: 22px; text-align: center; }" +
          ".w { font-size: 30px; font-weight: bold; } .ex { color: #666; font-style: italic; margin-top: 10px; }",
        latexPre: "\\documentclass[12pt]{article}\\begin{document}",
        latexPost: "\\end{document}",
        req: [[0, "all", [0]]],
        tags: [],
        vers: [],
      },
    };
  }

  function deckJSON(deckId, name) {
    const now = Math.floor(Date.now() / 1000);
    const base = {
      newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
      conf: 1, usn: 0, desc: "", dyn: 0, collapsed: false,
      extendNew: 10, extendRev: 50, mod: now,
    };
    return {
      1: Object.assign({ id: 1, name: "Default" }, base),
      [deckId]: Object.assign({ id: deckId, name }, base),
    };
  }

  const DCONF = {
    1: {
      id: 1, name: "Default", replayq: true, lapse: { leechFails: 8, minInt: 1, delays: [10], leechAction: 0, mult: 0 },
      rev: { perDay: 100, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, ease4: 1.3, bury: true, minSpace: 1 },
      timer: 0, maxTaken: 60, usn: 0,
      new: { perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7], initialFactor: 2500, bury: true, order: 1 },
      mod: 0, autoplay: true,
    },
  };

  /** cards: [{word, translation, example}] */
  async function buildApkg({ deckName, language, cards }) {
    const SQL = await getSql();
    const JSZip = await getJSZip();
    const db = new SQL.Database();
    db.run(SCHEMA);

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const deckId = nowMs;
    const mid = nowMs + 1;

    const conf = {
      nextPos: 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0,
      sortBackwards: false, addToCur: true, curDeck: 1, newBury: true, newSpread: 0,
      dueCounts: true, curModel: String(mid), collapseTime: 1200,
    };

    db.run("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      1, nowSec, nowMs, nowMs, 11, 0, 0, 0,
      JSON.stringify(conf),
      JSON.stringify(modelJSON(mid, deckId, language)),
      JSON.stringify(deckJSON(deckId, deckName)),
      JSON.stringify(DCONF),
      "{}",
    ]);

    const insNote = db.prepare(
      "INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    );
    const insCard = db.prepare(
      "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const noteId = nowMs + 2 + i * 2;
      const cardId = noteId + 1;
      const flds = [c.word, c.translation || "", c.example || ""].join("\x1f");
      const csum = parseInt((await sha1hex(c.word)).slice(0, 8), 16);
      insNote.run([noteId, guid(), mid, nowSec, -1, "", flds, c.word, csum, 0, ""]);
      insCard.run([cardId, noteId, deckId, 0, nowSec, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
    }
    insNote.free();
    insCard.free();

    const dbBytes = db.export();
    db.close();

    const zip = new JSZip();
    zip.file("collection.anki2", dbBytes);
    zip.file("media", "{}");
    return zip.generateAsync({ type: "blob" });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function tsvFallback({ deckName, cards }) {
    const lines = cards.map(
      (c) => `${c.word}\t${(c.translation || "").replace(/\t/g, " ")}\t${(c.example || "").replace(/\t/g, " ")}`
    );
    const blob = new Blob(["#separator:tab\n#html:false\n" + lines.join("\n")], {
      type: "text/tab-separated-values;charset=utf-8",
    });
    download(blob, deckName.replace(/\W+/g, "_") + ".txt");
  }

  /** Public entry point: exports cards as .apkg, falling back to TSV. */
  async function exportDeck({ deckName, language, cards }) {
    try {
      const blob = await buildApkg({ deckName, language, cards });
      download(blob, deckName.replace(/\W+/g, "_") + ".apkg");
      return "apkg";
    } catch (e) {
      console.warn("apkg build failed, exporting TSV instead:", e);
      tsvFallback({ deckName, cards });
      return "tsv";
    }
  }

  return { exportDeck };
})();
