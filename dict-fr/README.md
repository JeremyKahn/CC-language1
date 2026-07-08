# dict-fr

Per-part-of-speech French lemma lists ranked by **film-subtitle frequency**,
derived from **Lexique 3.83** (New & Pallier; CC-BY). Frequency field is
`freqlemfilms2` = lemma frequency in the subtitle corpus, per million occurrences
(summed over all inflected forms of the lemma).

## Files
- `XXX.txt` — one file per Lexique `cgram` code (`:` → `-`, e.g. `ADJ:dem` → `ADJ-dem.txt`).
  Each line is a **lemma**; lines are sorted by **descending** subtitle frequency
  (ties alphabetical). 22 files.
- `dict-fr.tsv` — consolidated: columns `lemma`, `cgram`, `freqlemfilms2`, `rank`
  (rank is within each `cgram`). Sorted by `cgram`, then `rank`.
- `removed.tsv` — audit log of every entry the cleaning pass dropped, with reason.
- `clean_dict.py` — the generator; re-run against any Lexique TSV to regenerate.

51,048 lemmas kept, 70 removed.

## Cleaning applied
1. **Single-character lemmas** removed (letter-names in NOM, Roman-numeral letters
   in ADJ:num, elided clitic artifacts). Kept: `à` (PRE) and `y` (PRO:per), the two
   genuine one-letter words. NB: `ô` (interjection) was also removed by this rule.
2. **Digit-bearing lemmas** removed (abbreviated ordinals like `2e`, `7e`).
3. **AUX** restricted to `avoir`, `être` (dropped the mis-lemmatized `aurai`).
4. **ADJ:pos** restricted to true possessive determiners; possessive *pronoun*
   forms (`mien`, `tienne`, `vôtre`, …) and junk (`tiens-la-moi`) dropped.
   NB: singular determiner `leur` is filed under `PRO:pos` in Lexique, so it is
   absent here (only `leurs` is present).
5. **ART:def / ART:ind** de-junked (`de`, `la-la-la`, `pa`).
6. **CON / PRE** malformed apostrophe-less elisions dropped when the full form
   exists (`parce qu` → kept `parce que`; `afin d` → kept `afin de`; etc.).

## Notes / caveats
- Source is Lexique **3.83**, not Lexique 4. The `cgram` taxonomy and the meaning
  of `freqlemfilms2` are identical; to get Lexique-4 numbers, run `clean_dict.py`
  against a Lexique-4 TSV.
- Homographs still appear across sibling files by design: `tout` in both `ADJ` and
  `ADJ-ind`; `qui` in `PRO-int` and `PRO-rel`; `être`/`avoir` in both `VER` and `AUX`
  (lexical vs. auxiliary use).
- Legitimate multiword and borrowed lemmas are retained (`a priori`, `in vitro`,
  `celui-ci`, `parce que`, `alter ego`, …).
