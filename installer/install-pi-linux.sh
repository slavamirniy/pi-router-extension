#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PACKAGE_NAME="@earendil-works/pi-coding-agent"
PACKAGE_VERSION="0.84.4"
NVM_VERSION="v0.40.3"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=19
MIN_NODE_PATCH=0
TASK_API_KEY="${PI_API_KEY:-}"
TASK_BASE_URL="${PI_BASE_URL:-}"
TASK_PROVIDER="${PI_PROVIDER_NAME:-router}"
TASK_DEFAULT_MODEL="${PI_DEFAULT_MODEL:-}"
TASK_CONFIG_DIR="${PI_CODING_AGENT_DIR:-}"
unset PI_API_KEY PI_BASE_URL PI_PROVIDER_NAME PI_DEFAULT_MODEL
TASK_SOURCE="https://raw.githubusercontent.com/slavamirniy/pi-router-extension/f2db9fb7421192b04d113d44f4ef43bd51a06ac9"
[[ -n "$TASK_BASE_URL" ]] || { echo 'Set PI_BASE_URL to your API address, including /v1.' >&2; exit 1; }
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
err()  { printf "${RED}[ERR]${NC} %s\n" "$1" >&2; }
step() { printf "\n${CYAN}>>> %s${NC}\n" "$1"; }

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    err "Root privileges are required to install a system package, but sudo was not found."
    exit 1
  fi
}

on_error() {
  local code=$?
  err "Installation stopped with exit code $code."
  exit "$code"
}
trap on_error ERR

if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
  err "Do not run the entire script with sudo. Use: curl -fsSL <URL> | env PI_API_KEY='<key>' bash"
  exit 1
fi

choose_profile() {
  if [[ -n "${ZSH_VERSION:-}" || "${SHELL:-}" == */zsh ]]; then
    printf '%s' "$HOME/.zshrc"
  elif [[ -n "${BASH_VERSION:-}" || "${SHELL:-}" == */bash ]]; then
    printf '%s' "$HOME/.bashrc"
  else
    printf '%s' "$HOME/.profile"
  fi
}

install_curl_if_missing() {
  command -v curl >/dev/null 2>&1 && return 0

  step "Installing curl"
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y curl ca-certificates
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -Sy --noconfirm curl ca-certificates
  elif command -v apk >/dev/null 2>&1; then
    as_root apk add --no-cache curl ca-certificates bash
  else
    err "curl was not found and the package manager could not be detected. Install curl manually and run the installer again."
    exit 1
  fi
}

load_nvm() {
  export NVM_DIR="$HOME/.nvm"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    set +u
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    set -u
  fi
}

node_version_supported() {
  command -v node >/dev/null 2>&1 || return 1

  local version major minor patch
  version="$(node --version 2>/dev/null | sed 's/^v//')"
  IFS='.' read -r major minor patch <<< "$version"
  patch="${patch%%[^0-9]*}"

  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  [[ "$patch" =~ ^[0-9]+$ ]] || patch=0

  (( major > MIN_NODE_MAJOR )) && return 0
  (( major < MIN_NODE_MAJOR )) && return 1
  (( minor > MIN_NODE_MINOR )) && return 0
  (( minor < MIN_NODE_MINOR )) && return 1
  (( patch >= MIN_NODE_PATCH ))
}

install_node_if_needed() {
  if command -v npm >/dev/null 2>&1 && node_version_supported; then
    ok "Node.js $(node --version), npm $(npm --version)"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node --version) is too old. Pi requires Node.js 22.19.0 or newer."
  fi

  install_curl_if_missing
  step "Installing the current Node.js LTS with nvm"

  local profile
  profile="$(choose_profile)"
  touch "$profile"

  export NVM_DIR="$HOME/.nvm"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | PROFILE="$profile" bash
  fi

  load_nvm
  if ! command -v nvm >/dev/null 2>&1; then
    err "nvm could not be loaded. Open a new terminal and run the installer again."
    exit 1
  fi

  # nvm is not always compatible with `set -u`, so disable nounset while
  # running nvm functions and enable it again afterwards.
  set +u
  nvm install --lts
  nvm alias default 'lts/*'
  nvm use --lts
  set -u

  command -v npm >/dev/null 2>&1 || { err "npm was not installed."; exit 1; }
  node_version_supported || { err "The installed Node.js version is still too old."; exit 1; }
  ok "Node.js $(node --version), npm $(npm --version)"
}

ensure_npm_bin_on_path() {
  local prefix bin_dir profile
  prefix="$(npm config get prefix)"
  bin_dir="$prefix/bin"

  if [[ -d "$bin_dir" ]]; then
    export PATH="$bin_dir:$PATH"
  elif [[ -d "$prefix" ]]; then
    export PATH="$prefix:$PATH"
  fi

  profile="$(choose_profile)"
  if [[ "$prefix" == "$HOME/.local" ]] && ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$profile" 2>/dev/null; then
    printf '\n# User npm binaries\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$profile"
  fi

  hash -r
}

install_or_update_pi() {
  step "Installing or updating Pi"

  local log_file
  log_file="$(mktemp)"

  local -a npm_install_args=(
    install
    --global
    "${PACKAGE_NAME}@${PACKAGE_VERSION}"
    --ignore-scripts
    --no-audit
    --no-fund
    --no-progress
    --loglevel=warn
  )

  if ! npm "${npm_install_args[@]}" 2>&1 | tee "$log_file"; then
    if grep -qiE 'EACCES|permission denied' "$log_file"; then
      warn "No permission to use the system npm directory. Switching global packages to $HOME/.local"
      npm config set prefix "$HOME/.local"
      mkdir -p "$HOME/.local/bin"
      ensure_npm_bin_on_path
      npm "${npm_install_args[@]}"
    else
      rm -f "$log_file"
      err "npm could not install ${PACKAGE_NAME}."
      exit 1
    fi
  fi

  rm -f "$log_file"
  ensure_npm_bin_on_path

  if ! command -v pi >/dev/null 2>&1; then
    err "Pi was installed, but the pi command was not found in PATH. Open a new terminal and run: pi"
    exit 1
  fi

  ok "Pi installed: $(pi --version 2>/dev/null | head -n 1 || printf 'version unavailable')"
}


if [[ "${PI_SKIP_INSTALL:-0}" != 1 ]]; then
  load_nvm
  install_node_if_needed
  install_or_update_pi
else
  node_version_supported || { err 'Node.js >=22.19 is required.'; exit 1; }
fi
command -v curl >/dev/null 2>&1 || { err 'curl is required.'; exit 1; }
TASK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/pi-router-install.XXXXXXXX")"
cleanup() { if [[ -n "${TASK_TMP:-}" && "${TASK_TMP##*/}" == pi-router-install.* ]]; then rm -rf -- "$TASK_TMP"; fi; return 0; }
trap cleanup EXIT
while read -r file checksum; do
  mkdir -p "$TASK_TMP/$(dirname "$file")"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$TASK_SOURCE/$file" -o "$TASK_TMP/$file"
  actual="$(node -e 'const fs=require("fs"),crypto=require("crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$TASK_TMP/$file")"
  [[ "$actual" == "$checksum" ]] || { err 'Extension integrity check failed.'; exit 1; }
done <<'MANIFEST'
index.ts 96cf696860a00cddc2723ab9bdee323a3c6e6afdb801b62b5bfd21ac33019788
models.mjs fe484ac7229d50a343ec06e810bca31eba722abdb84d5bb803d8267839ffbe8a
progress.mjs 3590b43cb261209a4cc4eb36de959e6112802286e2750ee778380341b31e0dc0
safety.mjs 76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba
installer/configure.mjs 8d9e00f8a2d4e763bbb8b6bc2734c89448d121b3ae88dd0bfe828a6971a96837
MANIFEST
printf '%s\0%s\0%s\0%s\0%s\0' "$TASK_API_KEY" "$TASK_BASE_URL" "$TASK_PROVIDER" "$TASK_DEFAULT_MODEL" "$TASK_CONFIG_DIR" | node "$TASK_TMP/installer/configure.mjs"
unset TASK_API_KEY
cleanup
TASK_TMP=''
if [[ "${PI_NO_START:-0}" != 1 ]]; then
  if [[ -r /dev/tty && -w /dev/tty ]]; then exec pi </dev/tty >/dev/tty 2>&1
  else echo 'Installation complete. Open a terminal and run: pi'; fi
fi
