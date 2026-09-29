#!/bin/bash
# Единственный источник правды о зафиксированной сборке gitleaks: шаг в ci.yml
# (диапазон выкладки) и джоб в gates.yml (полная история по расписанию) зовут
# отсюда, чтобы пин версии и sha256 не жили в двух workflow-файлах и не
# разошлись при подъёме.
#
#   bash scripts/gitleaks-scan.sh "<git log opts, напр. --all>"
#
# Сборки зафиксированы под linux — оба вызова идут на раннере с Linux.
set -euo pipefail

LOG_OPTS="${1:-}"
if [ -z "$LOG_OPTS" ]; then
  echo "usage: bash scripts/gitleaks-scan.sh \"<git log opts>\"" >&2
  exit 2
fi

GL_VERSION=8.30.1
case "$(uname -m)" in
  x86_64|amd64)
    GL_ARCH=linux_x64
    GL_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  aarch64|arm64)
    GL_ARCH=linux_arm64
    GL_SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
    ;;
  *)
    echo "::error::Нет зафиксированной сборки gitleaks для $GL_VERSION под $(uname -m)"
    exit 1
    ;;
esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 3 -o "$WORK/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GL_VERSION}/gitleaks_${GL_VERSION}_${GL_ARCH}.tar.gz"
echo "${GL_SHA256}  $WORK/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$WORK/gitleaks.tar.gz" -C "$WORK"

echo "Сканирую: $LOG_OPTS"
"$WORK/gitleaks" git --config .gitleaks.toml --log-opts="$LOG_OPTS" --redact --no-banner --exit-code 1
