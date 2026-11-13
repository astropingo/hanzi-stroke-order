#!/usr/bin/env python3
"""Rebuild data/radicals.json: the radical of every character and what each radical means.

You only need this if you want newer data; the site itself never runs it.

    curl -LO https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt
    python tools/build_radicals.py dictionary.txt

The source is Make Me a Hanzi (https://github.com/skishore/makemeahanzi), the same project
the stroke data comes from, so the radical named here is the one drawn in red.

The file has two parts:

    chars     "你亻好女..." pairs of a character and its radical
    radicals  {"亻": ["rén", "man, person; people"], ...} pinyin and English meaning
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "data" / "radicals.json"

# Radical forms that Make Me a Hanzi lists without a meaning or pinyin, or with an
# unhelpful one ("kwukyel" is the Korean name of a stroke).
FIXES = {
    "⺀": ["bīng", "ice"],
    "⺈": ["dāo", "knife"],
    "⺊": ["bǔ", "divination"],
    "⺌": ["xiǎo", "small"],
    "⺍": ["xiǎo", "small"],
    "⺗": ["xīn", "heart; mind; soul"],
    "⺳": ["wǎng", "net, network"],
    "⺼": ["ròu", "meat, flesh"],
    "氺": ["shuǐ", "water"],
    "龶": ["shēng", "life; birth; growth"],
    "丷": ["bā", "eight"],
    "乛": ["yǐ", "second; hook"],
    "丨": ["gǔn", "line"],
    "子": ["zǐ", "son, child; seed, egg; fruit; small thing"],
    "卜": ["bǔ", "divination, fortune-telling; prophecy"],
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", type=Path, help="Make Me a Hanzi's dictionary.txt")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    entries = {}
    with args.source.open(encoding="utf-8") as lines:
        for line in lines:
            entry = json.loads(line)
            entries[entry["character"]] = entry

    pairs = []
    radicals: dict[str, list[str]] = {}
    for char, entry in entries.items():
        radical = entry.get("radical")
        if not radical:
            continue
        pairs.append(char + radical)
        if radical not in radicals:
            source = entries.get(radical, {})
            pinyin = (source.get("pinyin") or [""])[0]
            meaning = " ".join((source.get("definition") or "").split())  # also drops odd spaces
            fix = FIXES.get(radical)
            radicals[radical] = fix if fix else [pinyin, meaning]

    data = {
        "about": "Built by tools/build_radicals.py from Make Me a Hanzi "
        "(https://github.com/skishore/makemeahanzi).",
        "chars": "".join(pairs),
        "radicals": radicals,
    }
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(pairs):,} characters, {len(radicals)} radicals; wrote {args.output}")


if __name__ == "__main__":
    main()
