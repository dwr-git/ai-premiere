#!/usr/bin/env bash
# Builds AI Видео: the browser app plus the assistant panel and its PHP, as one folder ready for
# the server, zipped:  $DIST/ai-premiere-build-<N>-<date>.zip  →  ai-premiere/
# The folder works under any name: every path in it is relative.
#
# Usage: studio/build/package.sh [--skip-build]
#   --skip-build  reuse the last build in $CARGO_TARGET_DIR/ai-premiere-app and dist/web-boot
#
# Needs: Rust with the wasm32-unknown-unknown target, the wasm-bindgen CLI at the version the app
# pins (WASM_BINDGEN in xtask/src/main.rs), trunk (for the small boot module), python3, gzip, zip;
# wasm-opt (binaryen) is used when it is on PATH. CI runs it in .github/workflows/studio.yml;
# nobody needs Rust on the server.
#
# The site holds the app's wasm gzipped and cut into parts (app/), started by the small
# ai-premiere-boot module (apps/ai-premiere-boot, built by trunk), so no file is larger than a part
# and the page can show download progress (studio/loader.js reads data-app-bytes).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../packaging/env.sh
. "$ROOT/packaging/env.sh"

APPBUILD="$CARGO_TARGET_DIR/ai-premiere-app" # wasm-bindgen output of apps/filmcraft-web
BOOT="$ROOT/dist/web-boot"                   # trunk output of apps/ai-premiere-boot

if [[ "${1:-}" != "--skip-build" ]]; then
  WASM_BINDGEN_VERSION="$(sed -n 's/^const WASM_BINDGEN: &str = "\(.*\)";$/\1/p' "$ROOT/xtask/src/main.rs")"
  command -v wasm-bindgen >/dev/null && wasm-bindgen --version | grep -qF "$WASM_BINDGEN_VERSION" ||
    { echo "error: wasm-bindgen CLI $WASM_BINDGEN_VERSION is needed (cargo install wasm-bindgen-cli --version $WASM_BINDGEN_VERSION --locked)" >&2; exit 1; }
  command -v trunk >/dev/null || { echo "error: trunk not found (cargo install trunk --locked)" >&2; exit 1; }
  (cd "$ROOT" && cargo build --target wasm32-unknown-unknown -p filmcraft-web --release)
  rm -rf "$APPBUILD"
  mkdir -p "$APPBUILD"
  wasm-bindgen --target web --no-typescript --out-dir "$APPBUILD" "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/filmcraft_web.wasm"
  if command -v wasm-opt >/dev/null; then
    # Smaller and faster (binaryen); the same features the upstream web build enables.
    wasm-opt -O2 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
      --enable-reference-types --enable-multivalue \
      "$APPBUILD/filmcraft_web_bg.wasm" -o "$APPBUILD/filmcraft_web_opt.wasm"
    /bin/mv -f "$APPBUILD/filmcraft_web_opt.wasm" "$APPBUILD/filmcraft_web_bg.wasm"
  else
    echo "warning: wasm-opt not found; the app ships unoptimised" >&2
  fi
  (cd "$ROOT/apps/ai-premiere-boot" && trunk build --release)
fi

WASM="$APPBUILD/filmcraft_web_bg.wasm"
GLUE="$APPBUILD/filmcraft_web.js"
[[ -f "$WASM" && -f "$GLUE" ]] || { echo "error: $APPBUILD has no app build; run without --skip-build" >&2; exit 1; }
[[ -f "$BOOT/index.html" ]] || { echo "error: $BOOT/index.html missing; run without --skip-build" >&2; exit 1; }
# Paths must be relative so the site works under any prefix (public_url = "./" in Trunk.toml).
if grep -Eq '(src|href)="/[^/]' "$BOOT/index.html"; then
  echo "error: $BOOT/index.html has root-absolute URLs; it would break when served from a sub-path" >&2
  exit 1
fi

# Some hosts and upload tools stumble on single files over 25 MiB; parts stay well under it.
PART_BYTES="${AI_PREMIERE_WEB_PART_BYTES:-20971520}" # 20 MiB
HASH="$(cat "$WASM" "$GLUE" | sha256sum | cut -c1-16)"

OUT="$CARGO_TARGET_DIR/studio-package"
rm -rf "$OUT"
APP="$OUT/ai-premiere"
mkdir -p "$APP/app"
cp -R "$BOOT/." "$APP/"
# wasm-bindgen's inline JS snippets (eframe's text agent): the glue imports them relative to itself.
if [[ -d "$APPBUILD/snippets" ]]; then cp -R "$APPBUILD/snippets" "$APP/app/"; fi
# The app's glue by its content hash, named in parts.txt (`# loader …`): a fixed name could come from
# the browser's cache, or stay behind on the server, and an old glue can't start a new wasm. The
# fixed name stays too (the boot module's fallback).
GLUE_NAME="ai-premiere-$HASH.js"
cp "$GLUE" "$APP/app/$GLUE_NAME"
cp "$GLUE" "$APP/app/ai-premiere.js"
# The parts keep the content hash, so they can be cached forever. Their extension is one no server
# knows: a server that recognised gzip might decode or label it, and the page inflates the parts.
gzip -9 -n -c "$WASM" | (cd "$APP/app" && split -b "$PART_BYTES" - "ai-premiere-$HASH.part-")
{
  echo "ai-premiere-parts 1"
  echo "# loader $GLUE_NAME"
  for part in "$APP/app/ai-premiere-$HASH".part-*; do basename "$part"; done
} >"$APP/app/parts.txt"
wasm_bytes=$(wc -c <"$WASM" | tr -d ' ')
gzip_bytes=$(cat "$APP/app/ai-premiere-$HASH".part-* | wc -c | tr -d ' ')
sed -i.bak "s/data-app-bytes=\"0\"/data-app-bytes=\"$gzip_bytes\"/" "$APP/index.html" && rm -f "$APP/index.html.bak"
grep -q "data-app-bytes=\"$gzip_bytes\"" "$APP/index.html" || { echo "error: the page does not know the download size" >&2; exit 1; }
echo "app: $wasm_bytes bytes of wasm, shipped as $gzip_bytes bytes of gzip in $(($(wc -l <"$APP/app/parts.txt") - 2)) part(s)"
# The audio worklet the app loads relative to the page.
cp "$ROOT/apps/filmcraft-web/web/audio-worklet.js" "$APP/"

# The panel: studio/ next to index.html.
mkdir -p "$APP/studio"
cp "$ROOT/studio/web/studio.js" "$ROOT/studio/web/studio.css" "$ROOT/studio/web/config.js" "$ROOT/studio/web/loader.js" "$APP/studio/"
cp "$ROOT/studio/web/.htaccess" "$APP/studio/"
# AI Видео's own icon (icon id `video`, Dewiar, MIT OR Apache-2.0).
cp "$ROOT/studio/web/favicon.png" "$ROOT/studio/web/apple-touch-icon.png" "$APP/"
python3 "$ROOT/studio/build/make_labels.py" "$APP/studio/ru-labels.json"

# Open fonts for titles and captions (Liberation Sans/Serif/Mono, Carlito, Caladea; all with
# Cyrillic), loaded by the panel through window.aipremiere.addFont. AI_PREMIERE_FONTS_DIR is a folder
# of .ttf files and their licence texts (CI installs them from Ubuntu packages); never committed.
mkdir -p "$APP/fonts"
if [[ -n "${AI_PREMIERE_FONTS_DIR:-}" && -d "$AI_PREMIERE_FONTS_DIR" ]]; then
  cp "$AI_PREMIERE_FONTS_DIR"/*.ttf "$APP/fonts/"
  cp "$AI_PREMIERE_FONTS_DIR"/*.txt "$APP/fonts/" 2>/dev/null || true
fi
python3 - "$APP/fonts" <<'PY'
import json, os, sys
d = sys.argv[1]
fonts = sorted(f for f in os.listdir(d) if f.lower().endswith(".ttf"))
json.dump({"fonts": [{"file": f, "size": os.path.getsize(os.path.join(d, f))} for f in fonts]}, open(os.path.join(d, "manifest.json"), "w"))
print(f"fonts: {len(fonts)} file(s)")
PY

# The assistant's PHP: api/ next to index.html.
mkdir -p "$APP/api"
cp "$ROOT"/studio/api/*.php "$APP/api/"
cp "$ROOT/studio/api/.htaccess" "$APP/api/"

# Docs for whoever puts it on the server.
cp "$ROOT/studio/README.ru.md" "$APP/README.ru.md"
cp "$ROOT/studio/CHANGES.ru.md" "$APP/CHANGES.ru.md"
cp "$ROOT/studio/nginx.conf.example" "$APP/nginx.conf.example"
for f in LICENSE-MIT LICENSE-APACHE NOTICE ATTRIBUTION.md; do cp "$ROOT/$f" "$APP/"; done

# The panel's files keep their names between releases: a version in the URL makes browsers
# fetch the new ones after an update (config.js is meant to be edited on the server, so it is
# served with no-cache instead, see studio/web/.htaccess).
STAMP="${GITHUB_SHA:-${FILMCRAFT_BUILD_SHA:-}}"
STAMP="${STAMP:0:8}"
[ -n "$STAMP" ] || STAMP="$VERSION"
sed -i.bak \
  -e "s#href=\"studio/studio.css\"#href=\"studio/studio.css?v=$STAMP\"#" \
  -e "s#src=\"studio/studio.js\"#src=\"studio/studio.js?v=$STAMP\"#" \
  -e "s#src=\"studio/loader.js\"#src=\"studio/loader.js?v=$STAMP\"#" \
  "$APP/index.html"
rm -f "$APP/index.html.bak"
grep -q "studio/studio.js?v=$STAMP" "$APP/index.html" || { echo "error: the page does not load the assistant panel" >&2; exit 1; }
grep -q "studio/loader.js?v=$STAMP" "$APP/index.html" || { echo "error: the page does not load the start-up check" >&2; exit 1; }
# Nothing in the folder may load from another site: the app must work with no internet.
if grep -rIlE "(src|href)=\"(https?:)?//" "$APP" --include=*.html >/dev/null; then echo "error: a page loads something from another site" >&2; exit 1; fi

# Номер сборки (GitHub Actions передаёт AI_PREMIERE_BUILD) и дата — в имени архива и внутри папки,
# чтобы было видно, какая версия скачана и какая стоит на сервере (панель помощника пишет её в шапке).
BUILD="${AI_PREMIERE_BUILD:-local}"
BUILD_DATE="$(TZ=Europe/Minsk date +%Y-%m-%d)"
# Файлы, которые меняются от сборки к сборке, но могли бы сохранить прежний размер, получают
# «набивку» разной длины: программы заливки, которые пропускают файлы того же размера, всё равно
# их заменят.
PAD="$(printf '%*s' $(( (${BUILD//[^0-9]/} + 0) % 23 + 1 )) '' | tr ' ' '#')"
printf '{"build":"%s","date":"%s","commit":"%s","pad":"%s"}\n' "$BUILD" "$BUILD_DATE" "$STAMP" "$PAD" >"$APP/studio/version.json"
printf '# build %s, %s %s\n' "$BUILD" "$BUILD_DATE" "$PAD" >>"$APP/app/parts.txt"
sed -i.bak "s#<html lang=\"ru\"#<html lang=\"ru\" data-build=\"$BUILD\"#" "$APP/index.html" && rm -f "$APP/index.html.bak"
grep -q "data-build=\"$BUILD\"" "$APP/index.html" || { echo "error: the page has no build number" >&2; exit 1; }
# Каждая сборка — в своей папке b/<номер>/, index.php выбирает самую новую (studio/build/versioned.sh).
"$ROOT/studio/build/versioned.sh" "$APP" "$BUILD" "AI Видео"
# Каждый текстовый файл с постоянным именем получает в конце строку с номером сборки и набивкой.
# Файлы с отпечатком в имени и snippets/ не трогаем.
pad_file() {
  case "$1" in
    *.html) printf '\n<!-- build %s %s -->\n' "$BUILD" "$PAD" >>"$1" ;;
    *.js | *.css) printf '\n/* build %s %s */\n' "$BUILD" "$PAD" >>"$1" ;;
    *.php) tail -c 3 "$1" | grep -q '?>' || printf '\n// build %s %s\n' "$BUILD" "$PAD" >>"$1" ;;
  esac
}
while IFS= read -r f; do pad_file "$f"; done < <(find "$APP" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.php' \) | grep -vE '([-_][0-9a-f]{12,20}[-_.][^/]*$|/snippets/)')
cat "$APP"/b/*/index.html | grep -q "<!-- build $BUILD " || { echo "error: the page has no build padding" >&2; exit 1; }
ZIP="$DIST/ai-premiere-build-$BUILD-$BUILD_DATE.zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr9 "$ZIP" ai-premiere)
echo "wrote $ZIP"
ls -lh "$ZIP"
