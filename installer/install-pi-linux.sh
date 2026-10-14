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
TASK_SOURCE="https://raw.githubusercontent.com/slavamirniy/pi-router-extension/b6e01e787aac664f891bf115de92df27470f3241"
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
  local installed_version
  if command -v pi >/dev/null 2>&1 && installed_version="$(pi --version 2>/dev/null)" && [[ "$installed_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    ok "Using installed Pi $installed_version. Updating connection and plugins only."
    return 0
  fi
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
  curl --retry 2 --retry-all-errors --retry-delay 1 --connect-timeout 10 --max-time 90 --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$TASK_SOURCE/$file" -o "$TASK_TMP/$file"
  actual="$(node -e 'const fs=require("fs"),crypto=require("crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$TASK_TMP/$file")"
  [[ "$actual" == "$checksum" ]] || { err 'Extension integrity check failed.'; exit 1; }
done <<'MANIFEST'
index.ts 96cf696860a00cddc2723ab9bdee323a3c6e6afdb801b62b5bfd21ac33019788
models.mjs fe484ac7229d50a343ec06e810bca31eba722abdb84d5bb803d8267839ffbe8a
progress.mjs 3590b43cb261209a4cc4eb36de959e6112802286e2750ee778380341b31e0dc0
safety.mjs 76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba
installer/configure.mjs f971c96a5d8b4d133e9f20bba5fb4efb3c7aeb815f4a6cd1d9fc3982986f49fb
installer/friendly.mjs 819bcc275aade2a62e817bb170f1640dac1935ad99d3125d6b8327f0c8d8b398
installer/autoupdate/index.ts 80da32f295a23886f76b0ac0d2fd25c2662ce47ceca520bb8623d21be44ad856
installer/autoupdate/update.mjs 7dc23c9ade8a379debe873aa230ae6890253ab90a29983f1f3640e73d17843ab
installer/autoupdate/worker.mjs 069e1ca196a040236a6f77446058c0ceb0581d1677c546e179432c87ecc5bb44
installer/autoupdate/trust.mjs af4d57b531555bd7102f1bf48dbbded9ad801a85cc9cb319d5e0c6b35859e07f
installer/pi-friendly/bundle.json 1fd67ae0e94d930314b188fb2613c0cecdcd5940be74c19f9b3d5fca84b627f7
installer/pi-friendly/LICENSE 7619509f890e5995b858f525a59dad4346b788c598db54b6ad8f4e51cda7c1bd
installer/pi-friendly/activity.mjs a24f1ffbf7e53c3167a7fcbd0b93655ee63c46a3d506f41a8ed2fe4bdc93e3e3
installer/pi-friendly/billing-panel.mjs d50c65b2a4334fc3a1ab7432f0b09ec02f03d6b789e2447236aaa64c538d05f8
installer/pi-friendly/billing.mjs 8ab7983af2a91bf17fab15543ceaf16794b3030ee5b92bab9d45fec5ae0df6b2
installer/pi-friendly/buttons.mjs db08e99863e394f573d40d2a3578b45a1eed5fa3ef255c6e0bf13ff1d8fe4993
installer/pi-friendly/clipboard.mjs b46c0110745d169f4bab11b20f7c40dd82356476499ab39ebcb7983b42529aae
installer/pi-friendly/errors.mjs 7c8dd4288b9153c89d21dd3f91902b8052a21421776e80b6b259c84e8d439f06
installer/pi-friendly/exit-dialog.mjs 490c9ee135ea508c79bc671b3c92d89bd8b626bba960186e576c55b1a8d438d4
installer/pi-friendly/folder-picker.mjs 0e1bbc47354a8c28e4f1bb08dab97bad39a3518f5b2e2c84dcd0ac2e3d6f5f4e
installer/pi-friendly/friendly.mjs b0a81ed67b763c46985fa7444b0a1b1d77d1e6d7b88d526e2159d67a72666c5c
installer/pi-friendly/hover.mjs 1e7a997b044de13322ef46b2332ed010c1e630ad161ef7bc3cd94b2bc5dcad48
installer/pi-friendly/index.ts bcb1128593fe5c3855ce44ff4e8b2bb95b3bbd29123ed91118edc324fb9e0b5b
installer/pi-friendly/legal.mjs 4863b553ef2e4ac9717093be4a42411522d15520a7d9e2d54a8ae66afe1dc938
installer/pi-friendly/menu.mjs 9ca8cadc393640c5b8982db2348ed6afa188875d02b8e8fb9a5e1c5deb766c19
installer/pi-friendly/model-picker.mjs b1780b708aea29663432a48b89401530e60b9016dc09a1227f960d65d586c689
installer/pi-friendly/model-preference.mjs 11f3313f11cff5ebe8fe981855219de1c833100d3106c765308beec3d173f798
installer/pi-friendly/mouse.mjs 4f5c6433c8a8cd97020364a0777e650edb8552b4a8f5fd8ad0c51d1651e258e0
installer/pi-friendly/package.json 7b7437dc6e733c2468faa989453e9f454989b05695768238c54efbbfb74ecdee
installer/pi-friendly/project-form.mjs b4a5b24dcceafebd0a5e2454a99cc0ce38a38f3082b395671d3c92a2f4958c57
installer/pi-friendly/projects.mjs a20425991e8bd30722f5ed1258b63c71555a999ec171bb6d2c95afa5a5843e03
installer/pi-friendly/router/LICENSE 7aeb0fefd5b229a189394de001b6125e3e59a43135647b82c74cf739ca38a710
installer/pi-friendly/router/index.ts 386c717605f57f509ef78d23781f7d0801231435c18654522f5a9fa86aa0be56
installer/pi-friendly/router/models.mjs fe484ac7229d50a343ec06e810bca31eba722abdb84d5bb803d8267839ffbe8a
installer/pi-friendly/router/progress.mjs baca4338904c5050d16433d4ca83c6677775b1d9746cc599a42325695df191c0
installer/pi-friendly/router/safety.mjs 76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba
installer/pi-friendly/selection.mjs 38dfe2e4073550980a7b985e14e9a57ca16f0f8264ff4642578df3b8a077249a
installer/pi-friendly/surface.mjs d56af4cdeb0afc5f7f198c4c2902004dcd606181d62780bccd291807661121ad
installer/pi-friendly/uploads.mjs 618b6823070e88c842fe6269f662e46e2bf16a61200ccfd32c9cb9bfd92a36c2
installer/pi-friendly/voice-setup.mjs d880ed57c78da937f911d7c62eefc71115f0daa21c373335f9cbb568ef29b900
installer/pi-friendly/voice-worker.py fdec70d83c8a7d20a630cb0647e828157f6ce86767a3d566d97ed66e9288c44b
installer/pi-friendly/voice.mjs 97078047307376099175b9fe984df4b2e212f7628ce0fab96169e65a27236b5d
installer/pi-friendly/voice_audio.py 5dc8e5b2f236e6c32eee6c4aa6115f26e191929f31b9bd1e0a281f5d7306b70d
installer/pi-friendly/web-host.mjs 858a9ce030934bddc4da6f88759137232eb8a334a9d8f42271e900318d35cb59
installer/pi-friendly/web-messages.mjs 6677630d0619fa294f1a92373c20231d2b04ed234a5bb249620f416ab91a533b
installer/pi-friendly/web-rpc.mjs 495309052bfc3016a397cb32da788968fc428bc6d9cad3e9bf9b1618458b857f
installer/pi-friendly/web-server.mjs b252ac6ce715a1046f54523d6542acdd5a2f713e3876ce16c95b7bdc2e90576a
installer/pi-friendly/web/app.css 721759701b842deebb2f49435694fca8f76a14f766a14f5f658c5dee845b07fb
installer/pi-friendly/web/app.js e0b185bfdf1851f8e1162be07fdc1403841a27cf7e3d2809043d6a0dbc2e6275
installer/pi-friendly/web/billing-ui.js be46e4f16ce5cdd0269c91948e31d41aca9583a448bce717f4e67c737d9365c9
installer/pi-friendly/web/index.html 7d95459dd55ae5c50fd702a582cd9a300133e1fcbf5c638de674b172f38940a5
installer/pi-friendly/workspace.mjs 25c252e02be2a8a7037d36854d6d3adcf0a833de637304e33ac9ee924a0d9329
MANIFEST
printf '%s\0%s\0%s\0%s\0%s\0' "$TASK_API_KEY" "$TASK_BASE_URL" "$TASK_PROVIDER" "$TASK_DEFAULT_MODEL" "$TASK_CONFIG_DIR" | node "$TASK_TMP/installer/configure.mjs"
unset TASK_API_KEY
cleanup
TASK_TMP=''
if [[ "${PI_NO_START:-0}" != 1 ]]; then
  if [[ -r /dev/tty && -w /dev/tty ]]; then exec pi </dev/tty >/dev/tty 2>&1
  else echo 'Installation complete. Open a terminal and run: pi'; fi
fi
