#!/usr/bin/env python3
"""Russian names for the assistant's command search.

Reads the Russian interface catalog AI Видео is built with (crates/ui-egui/src/i18n/ru.tsv:
context, a tab, English, a tab, Russian; `#` starts a comment) and writes studio/ru-labels.json:

    {"text": {"Ripple Delete": "Удалить со сдвигом", ...}, "id": {}}

The assistant panel uses it to show and search commands (their labels and menu-path segments) in
Russian. Only context-free rows are used. Run by studio/build/package.sh.
"""

import json
import sys
from pathlib import Path


def unescape(s: str) -> str:
    return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    src = root / "crates" / "ui-egui" / "src" / "i18n" / "ru.tsv"
    dst = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("ru-labels.json")
    text: dict[str, str] = {}
    if not src.is_file():
        print(f"warning: {src} not found; command names stay English", file=sys.stderr)
    else:
        for line in src.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) != 3 or cols[0]:
                continue
            en, ru = unescape(cols[1]), unescape(cols[2]).strip()
            if en and ru:
                text[en] = ru
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps({"text": text, "id": {}}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{dst}: {len(text)} labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
