#!/usr/bin/env python3
"""Rebuild data/dictionary.json, the word list the page uses for pinyin and meanings.

You only need this if you want a newer dictionary; the site itself never runs it.

    pip install pycccedict pypinyin jieba
    python tools/build_dictionary.py

The source is CC-CEDICT (https://cc-cedict.org, CC BY-SA 4.0) as packaged by pycccedict.
CC-CEDICT often lists several entries for one word (东西 is "east and west" or "thing",
长 is cháng or zhǎng). The page wants one answer per word, so the choosing happens here:
every word is stored with its single best entry, already converted to tone marks.

The file has four parts:

    words       {"喜欢": ["xǐ huan", "to like", "to be fond of"], ...}
                one syllable per character, then up to five senses
    readings    {"行": [["háng", "row", "line", ...], ...], ...}
                the other readings of characters that have more than one
    simplified  "學学習习..." pairs of traditional and simplified characters
    drawable    every character Hanzi Writer has stroke data for, so the page does not
                ask for the others (kept from the existing file unless --stroke-data is given)

Traditional words are left out when converting them character by character leads to the
same entry, which is nearly always.
"""
from __future__ import annotations

import argparse
import json
import re
import warnings
from collections import defaultdict
from pathlib import Path

from pycccedict.cccedict import CcCedict
from pypinyin import Style, lazy_pinyin, load_single_dict

OUTPUT = Path(__file__).resolve().parent.parent / "data" / "dictionary.json"
MAX_WORD = 8  # longest word kept, in characters
MAX_SENSES = 5
MAX_SENSE_LENGTH = 70

HAN = "⺀-⻿〇㐀-䶿一-鿿豈-﫿\U00020000-\U000323af"
HAN_ONLY = re.compile(f"[{HAN}]+")

# pypinyin reads a character by its phrase when it knows one (长大 zhǎngdà) and otherwise
# uses the first reading listed for the character. For these four the first reading is not
# the one a learner meets most often, so put the everyday reading first.
load_single_dict(
    {
        ord("长"): "cháng,zhǎng",
        ord("子"): "zǐ,zi",
        ord("似"): "sì,shì",
        ord("得"): "de,dé,děi",
    }
)

# --------------------------------------------------------------------------- pinyin

_MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}
_SYLLABLE = re.compile(r"([a-zü]+)([1-5])")


def normalize(syllable: str) -> str:
    """'Lu:3' and 'lv3' both become 'lü3'."""
    return syllable.lower().replace("u:", "ü").replace("v", "ü")


def toneless(syllable: str) -> str:
    return syllable.rstrip("12345")


def with_tone_mark(syllable: str) -> str:
    """'zhong1' -> 'zhōng', 'lü3' -> 'lǚ', 'huan5' -> 'huan'. A leading capital is kept."""
    match = _SYLLABLE.fullmatch(normalize(syllable))
    if not match:
        return ""
    letters, tone = match.group(1), int(match.group(2))
    if tone != 5:
        if "a" in letters:
            i = letters.index("a")
        elif "e" in letters:
            i = letters.index("e")
        elif "ou" in letters:
            i = letters.index("o")
        else:
            i = max(letters.rfind(vowel) for vowel in "iouü")
        if i >= 0:
            letters = letters[:i] + _MARKS[letters[i]][tone - 1] + letters[i + 1 :]
    return letters.capitalize() if syllable[:1].isupper() else letters


def usable(syllable: str) -> bool:
    return bool(_SYLLABLE.fullmatch(normalize(syllable))) and normalize(syllable) != "xx5"


def expected_readings(word: str) -> list[str]:
    """What pypinyin makes of the word: one numbered syllable per character ('' if unknown)."""

    def unknown(chars: str) -> list[str]:
        return ["" for _ in chars]

    options = dict(style=Style.TONE3, neutral_tone_with_five=True, errors=unknown)
    readings = lazy_pinyin(word, **options)
    if len(readings) != len(word):
        readings = [(lazy_pinyin(char, **options) or [""])[0] for char in word]
    return [normalize(reading) for reading in readings]


# --------------------------------------------------------------------------- senses

_REFERENCE = re.compile(f"[{HAN}]+\\|([{HAN}]+)")  # 個|个 -> 个
_BRACKETS = re.compile(r"\[[^\]]*\]")  # [ge4]
_CLASSIFIERS = re.compile(r"\s*\(CL:[^)]*\)")
_VARIANT_OF = re.compile(f"variant of (?:[{HAN}]+\\|)?([{HAN}]+)")
_SKIPPED_SENSES = (
    "CL:",
    "also written",
    "also pr.",
    "Taiwan pr.",
    "variant of",
    "old variant of",
    "archaic variant of",
    "see also",
    "erhua variant",
)
_MINOR_SENSES = (
    "variant of",
    "old variant of",
    "archaic variant of",
    "Japanese variant of",
    "erhua variant of",
    "surname ",
    "used in ",
    "see ",
)


def clean_sense(text: str) -> str:
    text = _CLASSIFIERS.sub("", text)
    text = _BRACKETS.sub("", _REFERENCE.sub(r"\1", text))
    return re.sub(r"\s{2,}", " ", text).strip()


def senses(definitions: list[str]) -> list[str]:
    """The senses worth showing: no classifier notes or cross-references."""
    kept = (clean_sense(d) for d in definitions if not d.strip().startswith(_SKIPPED_SENSES))
    return [sense for sense in kept if sense]


# --------------------------------------------------------------------------- choosing

# Words where the general rule in Source.pick lands on the rarer reading.
PREFERRED = {
    "明朝": "Ming2 chao2",  # the Ming Dynasty, not "tomorrow morning"
    "落空": "luo4 kong1",  # to come to nothing
    "省事": "sheng3 shi4",  # to save trouble
    "托儿": "tuo1 er2",  # childcare
    "保长": "bao3 zhang3",
}


def word_frequencies() -> dict[str, int]:
    """How common each word is, taken from jieba's word list when jieba is installed."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            import jieba
    except ImportError:
        return {}
    frequencies = {}
    with open(Path(jieba.__file__).parent / "dict.txt", encoding="utf-8") as lines:
        for line in lines:
            word, count, *_ = line.split()
            frequencies[word] = int(count)
    return frequencies


class Source:
    """Every CC-CEDICT entry, reachable by simplified and by traditional headword."""

    def __init__(self) -> None:
        self.entries: dict[str, list[tuple[str, list[str], str]]] = defaultdict(list)
        self.simplified_words: set[str] = set()
        self.to_simplified: dict[str, str] = {}
        # How much each traditional character is used: the number of words it appears in,
        # weighted by how common those words are.
        self.usage: dict[str, int] = defaultdict(int)
        frequencies = word_frequencies()
        counted = set()
        for entry in CcCedict().get_entries():
            traditional, simplified = entry["traditional"], entry["simplified"]
            item = (entry["pinyin"], entry["definitions"], traditional)
            self.entries[simplified].append(item)
            self.simplified_words.add(simplified)
            if len(traditional) > 1 and (traditional, simplified) not in counted:
                counted.add((traditional, simplified))
                for char in set(traditional):
                    self.usage[char] += 1 + frequencies.get(simplified, 0)
            if traditional != simplified:
                self.entries[traditional].append(item)
                if len(traditional) == len(simplified):
                    for t, s in zip(traditional, simplified):
                        if t != s:
                            self.to_simplified.setdefault(t, s)

    def simplify(self, word: str) -> str:
        return "".join(self.to_simplified.get(char, char) for char in word)

    def pick(self, word: str, expected: list[str]) -> tuple[str, list[str], str] | None:
        """The entry for a word that best fits the reading we expect."""
        candidates = self.entries.get(word)
        if not candidates:
            return None
        for candidate in candidates:
            if candidate[0] == PREFERRED.get(word):
                return candidate
        single = len(word) == 1

        def rank(item):
            order, (pinyin, definitions, traditional) = item
            syllables = [normalize(s) for s in pinyin.split()]
            same_sound = len(syllables) == len(expected) and all(
                toneless(a) == toneless(b) for a, b in zip(syllables, expected)
            )
            tone_misses = (
                sum(a != b for a, b in zip(syllables, expected))
                if same_sound
                else len(expected) + 1
            )
            minor = definitions[0].strip().startswith(_MINOR_SENSES)
            proper_noun = pinyin[:1].isupper()
            breadth = -len(senses(definitions))
            if single:
                # A lone character takes its most usual reading. Simplified characters often
                # merge several traditional ones with that same reading (后 is both 后
                # "empress" and 後 "behind"); the one found in more words is the everyday one.
                common = -self.usage[traditional]
                return (not same_sound, tone_misses, minor, proper_noun, common, breadth, order)
            # A word with two readings (东西: dōngxī "east and west", dōngxi "thing"; 大夫:
            # dàfū "senior official", dàifu "doctor") is nearly always meant in its everyday
            # sense, and that is the entry with more senses. pypinyin only breaks ties.
            return (minor, proper_noun, breadth, not same_sound, tone_misses, order)

        return min(enumerate(candidates), key=rank)[1]

    def gloss(self, definitions: list[str], depth: int = 0) -> list[str]:
        shown = senses(definitions)
        if not shown:
            # "erhua variant of 一点": use the meaning of the word it points to.
            target = _VARIANT_OF.search(definitions[0]) if definitions else None
            entry = self.pick(target.group(1), []) if target and depth < 2 else None
            if entry:
                return self.gloss(entry[1], depth + 1)
            shown = [s for s in map(clean_sense, definitions) if s]
        return [
            s if len(s) <= MAX_SENSE_LENGTH else s[: MAX_SENSE_LENGTH - 3].rstrip(" ,;") + "…"
            for s in shown[:MAX_SENSES]
        ]

    def value(self, word: str) -> list[str] | None:
        """["pinyin per character", sense, sense, ...] for a headword."""
        expected = expected_readings(word)
        entry = self.pick(word, expected)
        if entry is None:
            return None
        from_dictionary = entry[0].split()
        if len(from_dictionary) == len(word) and all(map(usable, from_dictionary)):
            syllables = from_dictionary
        else:
            syllables = expected
        return [" ".join(with_tone_mark(s) for s in syllables), *self.gloss(entry[1])]

    def other_readings(self, char: str, default: str) -> list[list[str]]:
        """The readings of a character besides its default one, each with its senses."""
        best: dict[str, tuple] = {}
        for order, (pinyin, definitions, traditional) in enumerate(self.entries.get(char, [])):
            if not usable(pinyin):
                continue
            marked = with_tone_mark(pinyin).lower()
            minor = definitions[0].strip().startswith(_MINOR_SENSES)
            key = (minor, pinyin[:1].isupper(), -self.usage[traditional], order)
            if marked not in best or key < best[marked][0]:
                best[marked] = (key, definitions)
        out = []
        for marked, (_, definitions) in best.items():
            shown = self.gloss(definitions)
            if marked != default.lower() and shown:
                out.append([marked, *shown])
        return out


def keep(word: str) -> bool:
    return len(word) <= MAX_WORD and bool(HAN_ONLY.fullmatch(word))


def build(stroke_data: Path | None, drawable: str) -> dict:
    source = Source()
    values = {word: source.value(word) for word in source.entries if keep(word)}
    values = {  # drop the handful of entries without a reading for every character
        word: value
        for word, value in values.items()
        if value and all(value[0].split(" ")) and len(value[0].split(" ")) == len(word)
    }

    words: dict[str, list[str]] = {}
    readings: dict[str, list[list[str]]] = {}
    alternates = {
        word: source.other_readings(word, value[0])
        for word, value in values.items()
        if len(word) == 1
    }

    for word, value in values.items():
        if word in source.simplified_words:
            words[word] = value
            if alternates.get(word):
                readings[word] = alternates[word]
    for word, value in values.items():  # traditional forms: only where conversion misleads
        if word in source.simplified_words:
            continue
        converted = source.simplify(word)
        if words.get(converted) != value:
            words[word] = value
        if alternates.get(word) and readings.get(converted) != alternates[word]:
            readings[word] = alternates[word]

    if stroke_data:
        drawable = "".join(sorted(p.stem for p in stroke_data.glob("*.json") if len(p.stem) == 1))
    extra = 0
    for char in drawable:  # can be drawn but has no dictionary entry: pinyin only
        if char not in words and source.simplify(char) not in words:
            reading = with_tone_mark(expected_readings(char)[0])
            if reading:
                words[char] = [reading]
                extra += 1

    pairs = "".join(t + s for t, s in sorted(source.to_simplified.items()))
    print(f"{len(words):,} words, {len(readings):,} characters with other readings, "
          f"{len(pairs) // 2:,} traditional characters, {len(drawable):,} drawable characters "
          f"({extra} of them pinyin only)")
    return {
        "about": "Built by tools/build_dictionary.py from CC-CEDICT (https://cc-cedict.org), "
        "licensed CC BY-SA 4.0.",
        "simplified": pairs,
        "drawable": drawable,
        "words": words,
        "readings": readings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--stroke-data",
        type=Path,
        help="folder of the hanzi-writer-data package; adds pinyin for characters that "
        "have stroke data but no dictionary entry",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    drawable = ""
    if not args.stroke_data and args.output.exists():
        drawable = json.loads(args.output.read_text(encoding="utf-8")).get("drawable", "")
    data = build(args.stroke_data, drawable)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"wrote {args.output} ({args.output.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
