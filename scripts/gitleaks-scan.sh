#!/bin/bash
# Единственный источник правды о зафиксированной сборке gitleaks: шаг в ci.yml
# (диапазон выкладки) и джоб в gates.yml (полная история по расписанию) зовут
# отсюда, чтобы пин версии и sha256 не жили в двух workflow-файлах и не
# разошлись при подъёме.
#
#   bash scripts/gitleaks-scan.sh "<git log opts, напр. --all>"
#
# Сборки зафиксированы под linux (раннеры CI) и macOS (ручной прогон с ноутбука);
# sha256 — из gitleaks_<ver>_checksums.txt релиза, сверены с самими архивами.
set -euo pipefail

LOG_OPTS="${1:-}"
if [ -z "$LOG_OPTS" ]; then
  echo "usage: bash scripts/gitleaks-scan.sh \"<git log opts>\"" >&2
  exit 2
fi

GL_VERSION=8.30.1
# R5-026/R5-033: выбор только по `uname -m` качал linux-сборку и на macOS —
# там она не запускается (exit 126). Выбираем по ОС и архитектуре вместе.
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64|Linux/amd64)
    GL_ARCH=linux_x64
    GL_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Linux/aarch64|Linux/arm64)
    GL_ARCH=linux_arm64
    GL_SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
    ;;
  Darwin/x86_64)
    GL_ARCH=darwin_x64
    GL_SHA256=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709
    ;;
  Darwin/arm64)
    GL_ARCH=darwin_arm64
    GL_SHA256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5
    ;;
  *)
    echo "::error::Нет зафиксированной сборки gitleaks для $GL_VERSION под $(uname -s) $(uname -m)"
    exit 1
    ;;
esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 3 -o "$WORK/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GL_VERSION}/gitleaks_${GL_VERSION}_${GL_ARCH}.tar.gz"
# shasum (perl) одинаков на Linux и macOS; у BSD sha256sum нет --status (R3-038).
echo "${GL_SHA256}  $WORK/gitleaks.tar.gz" | shasum -a 256 -c --status
tar -xzf "$WORK/gitleaks.tar.gz" -C "$WORK"

echo "Сканирую: $LOG_OPTS"
"$WORK/gitleaks" git --config .gitleaks.toml --log-opts="$LOG_OPTS" --redact --no-banner --exit-code 1
