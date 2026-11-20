#!/usr/bin/env bash
# Единственная команда, которую пользователь `deploy` может звать через sudo
# (/etc/sudoers.d/jw-deploy). Ставится РУКАМИ и принадлежит root:
#   sudo install -o root -g root -m 0755 deploy/jw-deploy.sh /usr/local/sbin/jw-deploy
# Выкатка этот файл не обновляет — иначе `deploy` переписал бы свою же границу.
#
# Граница: `deploy` может заменить бандл сайта и код службы (они и так его
# работа), но не получить root. Поэтому каталоги — только свои /tmp/jw-*
# пользователя deploy, ссылки при копировании не разыменовываются, права и
# владельцы выставляются здесь, а не берутся из источника.
set -euo pipefail

WEB=/var/www/justwriting
API=/opt/justwriting/api
OWNER=deploy

die() { echo "jw-deploy: $*" >&2; exit 1; }

# Каталог от выкатки: /tmp/jw-dist.XXXX или /tmp/jw-api.XXXX пользователя deploy.
# Читаем его ПРАВАМИ deploy (tar от его имени) и распаковываем в каталог root:
# дальше root работает только с копией, которую deploy уже не подменит. Иначе
# ссылка, подставленная между проверкой и копированием, отдала бы root-у
# чужой файл (гонка; находка ревью 20.11).
STAGE=
trap '[ -n "$STAGE" ] && rm -rf "$STAGE"' EXIT
stage_from() {
  local d=$1 kind=$2
  [[ "$d" =~ ^/tmp/jw-${kind}\.[A-Za-z0-9]+$ ]] || die "чужой каталог: $d"
  STAGE=$(mktemp -d /root/jw-stage.XXXXXX)
  runuser -u "$OWNER" -- tar -C "$d" -cf - . | tar -xf - -C "$STAGE" --no-same-owner --no-same-permissions
  # tar возвращает корню копии права «.» из архива (0700 от mktemp у deploy), а
  # rsync -p переносит их на сам $WEB — сайт закрылся бы (проверено 20.11).
  # Приватность копии даёт /root (0700), а не этот каталог.
  chmod 0755 "$STAGE"
}

# Только обычные файлы и каталоги, без setuid и записи для чужих (биты x
# остаются: .bin в node_modules); ссылки
# копируются как ссылки и не выводят за пределы дерева (--safe-links).
copy_tree() { rsync -rlpt --safe-links --no-specials --no-devices --chmod=ug-s,go-w "$@"; }

case "${1:-}" in
  client-publish)
    stage_from "${2:-}" dist
    if [ -f "$WEB/index.html" ]; then cp "$WEB/index.html" "$WEB/index.html.prev"; fi
    if [ -f "$WEB/sw.js" ]; then cp "$WEB/sw.js" "$WEB/sw.js.prev"; fi
    # Без --delete: открытая до выкатки страница догружает куски старого бандла.
    copy_tree "$STAGE"/ "$WEB"/
    chown -R www-data:www-data "$WEB"
    ;;
  client-rollback)
    if [ -f "$WEB/index.html.prev" ]; then cp "$WEB/index.html.prev" "$WEB/index.html"; fi
    if [ -f "$WEB/sw.js.prev" ]; then cp "$WEB/sw.js.prev" "$WEB/sw.js"; fi
    chown www-data:www-data "$WEB/index.html" "$WEB/sw.js" 2>/dev/null || true
    echo "откат клиента выполнен: восстановлены index.html.prev и sw.js.prev"
    ;;
  client-cleanup)
    find "$WEB/assets" -type f -mtime +14 -delete
    ;;
  api-snapshot)
    # M-3/R5-009: прошлый снимок — первым, свежий server.mjs.prev — до подмены.
    rm -rf "$API/node_modules.prev" "$API/package.json.prev" "$API/package-lock.json.prev"
    cp "$API/server.mjs" "$API/server.mjs.prev"
    ;;
  api-install)
    # В каталоге: server.mjs и stage/{package.json,package-lock.json,node_modules},
    # собранные `npm ci` от имени deploy (не root).
    stage_from "${2:-}" api
    d=$STAGE
    for f in server.mjs stage/package.json stage/package-lock.json; do
      [ -f "$d/$f" ] && [ ! -L "$d/$f" ] || die "нет файла: $f"
    done
    [ -d "$d/stage/node_modules" ] && [ ! -L "$d/stage/node_modules" ] || die "нет stage/node_modules"
    # L-9: снимок старого дерева жёсткими ссылками — откат восстанавливает и пакеты.
    cp -al "$API/node_modules" "$API/node_modules.prev"
    cp "$API/package.json" "$API/package.json.prev"
    cp "$API/package-lock.json" "$API/package-lock.json.prev"
    copy_tree --delete "$d/stage/node_modules/" "$API/node_modules/"
    install -o justwriting -g justwriting -m 0644 "$d/stage/package.json" "$d/stage/package-lock.json" "$API/"
    install -o justwriting -g justwriting -m 0644 "$d/server.mjs" "$API/server.mjs"
    chown -R justwriting:justwriting "$API/node_modules"
    systemctl restart justwriting
    sleep 5
    systemctl is-active --quiet justwriting
    ;;
  api-cleanup)
    rm -rf "$API/node_modules.prev" "$API/package.json.prev" "$API/package-lock.json.prev"
    ;;
  api-rollback)
    if [ -f "$API/server.mjs.prev" ]; then cp "$API/server.mjs.prev" "$API/server.mjs"; fi
    if [ -d "$API/node_modules.prev" ]; then
      rsync -a --delete "$API/node_modules.prev/" "$API/node_modules/"
      cp "$API/package.json.prev" "$API/package.json"
      cp "$API/package-lock.json.prev" "$API/package-lock.json"
      rm -rf "$API/node_modules.prev" "$API/package.json.prev" "$API/package-lock.json.prev"
      echo "откат зависимостей выполнен"
    fi
    systemctl restart justwriting
    echo "откат службы выполнен"
    ;;
  *)
    die "команды: client-publish DIR | client-rollback | client-cleanup | api-snapshot | api-install DIR | api-cleanup | api-rollback"
    ;;
esac
