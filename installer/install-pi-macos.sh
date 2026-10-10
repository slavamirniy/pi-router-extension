#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(uname -s)" == Darwin ]] || { echo 'This installer is for macOS.' >&2; exit 1; }
[[ -n "${PI_API_KEY:-}" && -n "${PI_BASE_URL:-}" ]] || { echo 'API key and /v1 address are required.' >&2; exit 1; }
TASK_START="${PI_NO_START:-0}"
export PI_NO_START=1
TASK_MAC_TMP="$(mktemp -d "${TMPDIR:-/tmp}/ai-diy-install.XXXXXXXX")"
cleanup_mac() { [[ "${TASK_MAC_TMP##*/}" == ai-diy-install.* ]] && rm -rf -- "$TASK_MAC_TMP"; }
trap cleanup_mac EXIT
TASK_ASSETS='https://raw.githubusercontent.com/slavamirniy/pi-router-extension/cc566974dd517f4c438aa84ca6ac05a3eb5defac'
curl --retry 2 --retry-all-errors --retry-delay 1 --connect-timeout 10 --max-time 90 -fsSL --proto '=https' --tlsv1.2 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/v1.0.9/installer/install-pi-linux.sh' -o "$TASK_MAC_TMP/common.sh"
TASK_COMMON_HASH='4e59484f59cf8f8e785a5234a40fe1fdacc005d65694ad7363d0b88719cd86e5'
[[ "$(shasum -a 256 "$TASK_MAC_TMP/common.sh" | cut -d ' ' -f 1)" == "$TASK_COMMON_HASH" ]] || { echo 'Installer integrity check failed.' >&2; exit 1; }
bash "$TASK_MAC_TMP/common.sh"
unset PI_API_KEY PI_BASE_URL PI_DEFAULT_MODEL
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  set +u
  . "$NVM_DIR/nvm.sh"
  set -u
fi
TASK_NPM_PREFIX="$(npm config get prefix)"
export PATH="$TASK_NPM_PREFIX/bin:$PATH"
TASK_NODE="$(command -v node)"
TASK_PI="$(command -v pi)"
for task_file in installer/desktop.mjs assets/ai-diy.icns; do
  mkdir -p "$TASK_MAC_TMP/$(dirname "$task_file")"
  curl --retry 2 --retry-all-errors --retry-delay 1 --connect-timeout 10 --max-time 90 -fsSL --proto '=https' --tlsv1.2 "$TASK_ASSETS/$task_file" -o "$TASK_MAC_TMP/$task_file"
done
TASK_MAC_TMP="$TASK_MAC_TMP" "$TASK_NODE" -e 'const fs=require("fs"),c=require("crypto"),p=require("path");for(const [f,h] of [["installer/desktop.mjs","3951fdceccaee938081d8716a28621a91a50b69de5f023341392adee57ef0fd1"],["assets/ai-diy.icns","b6502574a941ea5c87d067a46dd515a6adc0609ffe3d09faca8c78840616bad4"]]){if(c.createHash("sha256").update(fs.readFileSync(p.join(process.env.TASK_MAC_TMP,f))).digest("hex")!==h)throw Error("Installer integrity check failed")}'
"$TASK_NODE" "$TASK_MAC_TMP/installer/desktop.mjs" "$HOME" "$TASK_NODE" "$TASK_PI" "$TASK_MAC_TMP/assets/ai-diy.icns"
if [[ "$TASK_START" != 1 ]]; then open "$HOME/Desktop/AI своими руками.app"; fi
