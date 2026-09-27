#!/bin/bash
# Loads the site in headless Chrome and reports any JavaScript errors thrown
# while the page starts up (bad script order, typos, missing globals).
# Usage: tools/smoke-test.sh      Exit code 0 = no errors, 1 = errors printed.
# Override the browser with CHROME=/path/to/chrome.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8765}"
TMP="$(mktemp -d)"
TEST="$ROOT/_smoke.html"

# Copy of index.html with an error catcher that writes into <html data-errs>.
HOOK="<script>window.__e=[];function __r(m){__e.push(m);document.documentElement.setAttribute('data-errs',JSON.stringify(__e))}addEventListener('error',e=>__r(e.message+' @ '+(e.filename||'').split('/').slice(-2).join('/')+':'+e.lineno));addEventListener('unhandledrejection',e=>__r('unhandled rejection: '+e.reason));</script>"
sed "s#<head>#<head>$HOOK#" "$ROOT/index.html" > "$TEST"

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!; disown
trap 'kill $SERVER 2>/dev/null; pkill -f "user-data-dir=$TMP" 2>/dev/null; rm -rf "$TMP" "$TEST"' EXIT
sleep 1

# Chrome dumps the DOM but may not exit while tiles are still loading, so poll.
"$CHROME" --headless=new --disable-gpu --user-data-dir="$TMP/profile" \
  --virtual-time-budget=6000 --dump-dom "http://localhost:$PORT/_smoke.html" > "$TMP/dom.html" 2>/dev/null &
disown
for _ in $(seq 1 60); do
  sleep 0.5
  grep -q '</html>' "$TMP/dom.html" 2>/dev/null && break
done

if ! grep -q '</html>' "$TMP/dom.html"; then
  echo "Chrome did not render the page"; exit 1
fi
ERRS="$(grep -o 'data-errs="[^"]*"' "$TMP/dom.html" | sed 's/&quot;/"/g')"
if [ -n "$ERRS" ]; then
  echo "JavaScript errors:"; echo "$ERRS"; exit 1
fi
echo "OK: page loaded with no JavaScript errors"
