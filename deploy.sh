#!/usr/bin/env bash
# Сборка + выкладка smit34.ru.
#
# ВАЖНО: править нужно index.html (в нём JSX и классы Tailwind) — это источник правды.
# На сервер уезжает СБОРКА из dist/, где JSX уже скомпилирован, а Tailwind собран в css.
# Заливать index.html напрямую больше нельзя: на нём нет ни Babel, ни Tailwind CDN.
set -euo pipefail

SRV=root@31.44.7.144
DST=/var/www/smit34.ru
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$DIR"
echo "==> сборка"
node build.mjs

echo "==> выкладка"
ssh "$SRV" "mkdir -p $DST/js $DST/css"
scp dist/js/*.js   "$SRV:$DST/js/"
scp dist/css/*.css "$SRV:$DST/css/"
scp dist/index.html "$SRV:$DST/index.html"

ssh "$SRV" "cd $DST && chmod 755 index.html && chmod 644 js/*.js css/*.css \
  && chown smit34ftp:www-data index.html && chown -R smit34ftp:www-data js css \
  && ls -t js/*.js | tail -n +4 | xargs -r rm -f \
  && ls -t css/*.css | tail -n +4 | xargs -r rm -f"

echo "==> готово: https://smit34.ru/"
