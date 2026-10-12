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
TASK_SOURCE="https://raw.githubusercontent.com/slavamirniy/pi-router-extension/8b4e16c7733942a201e2048a4868232ec2370403"
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
installer/configure.mjs be10058cd2fbe5634ec69d0099edb9587758c0b05d58261818635cf5b6f42d61
installer/friendly.mjs 85a7972af7c1bf9ac4dbec6efd31f1d888a3c0da9044cc186d1aa8fed669750d
installer/pi-friendly/bundle.json 675d83529ebed23b60e84cb6e4a336571a0e592fa9be2ca4fa800d24db5776b9
installer/pi-friendly/activity.mjs 88e5d10d5f4058038744f5ed9787edc81bb2e0990288bfed172d4216f8d9fb8c
installer/pi-friendly/buttons.mjs 3296455c173d266e8af49d542780a5c23afc8935d37b88380a82d0ecfecc67df
installer/pi-friendly/clipboard.mjs fe40cdf182c2ca91e7513f2782dbb0e7e69bc989b0c3671260fe63bc9bd2b719
installer/pi-friendly/errors.mjs 567914532d7fc26c9203fec036a87419f70b039e1b6e6e65e06edcdb0bf2c327
installer/pi-friendly/exit-dialog.mjs 1d4fa0b3cd9b32b9d3b3825028e0202d53b91f39a57bd4876965317020605971
installer/pi-friendly/folder-picker.mjs a992b884a104e02ea2c59fa1eece028f1d57b008e2a0bf8dca6e58a10d96e4e5
installer/pi-friendly/friendly.mjs e2d9b08f20ae920b694269acd85c45510fe236ff05cbf8b5c1657ad3a2309b61
installer/pi-friendly/hover.mjs b5cc892ce3a02282e20803a358759a785e8b024a6927c207eefacefafbc91f1d
installer/pi-friendly/index.ts 8cd979f656bd8ed0772344088b25bdefbc1efa500999987b804cf9d5e2c26a5b
installer/pi-friendly/LICENSE 94a5c5d74147e19c336747bda0baa9c923363cb3fac320f95743cba72a59d186
installer/pi-friendly/menu.mjs a4e82e05c988c4d3635c4a3e0ef8aef3344e17c04d19f1c23f8edca1eb7bbad3
installer/pi-friendly/model-preference.mjs 6e1376482dcd1893a8ad808f295e451bd49aca5df5ef75d285d1be168f0c132c
installer/pi-friendly/mouse.mjs 6cafdb25d417a4ff3056e0a12c3b83750f7378bb290dd88e29ebaec86447d43f
installer/pi-friendly/package.json 05e7ded88ec4b722ec026b4c75967cd26aa40b5000510a8093f6fad39afa454c
installer/pi-friendly/project-form.mjs 9dc9c41756ad2d1b8f3912e493fc89e84242e9a39e63dec99339b2fc6d41acaf
installer/pi-friendly/projects.mjs 60104d3681188fb5e04cab39d0a5e7478d75c91c4f01b55d4f05c2918392d717
installer/pi-friendly/README.md bbc15f165120576b1e7f92ecc102570a1e7d1ee4a937c6fb285e10bf79d85fb9
installer/pi-friendly/selection.mjs 7c6fe45e6afa0c4abd996352ae5a217e4fe9205efb097e0e2c8e2cea805110ca
installer/pi-friendly/surface.mjs fcacd29a3859927367f887aa6c3784adb949c81f5f00c8638f812f3c9ce47951
installer/pi-friendly/uploads.mjs 618b6823070e88c842fe6269f662e46e2bf16a61200ccfd32c9cb9bfd92a36c2
installer/pi-friendly/voice-setup.mjs c545311ab52c4e1a09cf02662d6c2ae52e8561c0ad05fb6e96f87d83f32b988f
installer/pi-friendly/voice.mjs eaf585368e2148fc2f36ff066f0b2d809a5224c0f323080712e45554b1f17bea
installer/pi-friendly/voice_audio.py 659fdd63d58e4d6721ef64aba76ce91994e2704f8c7a0d73bfcc2bfecd762da6
installer/pi-friendly/web/app.css 8006d53348d4c0a46b9bda22d9ee9c7644142951e1aaa8aedecccb14fc36b4ed
installer/pi-friendly/web/app.js 30c087b459e0adec05ead8c9d317a67cb6a3e69fb20b56278995ee61585648f0
installer/pi-friendly/web/index.html 4fdf949e51979357da980422bbaff37e418f29c317fbce603f013e498a358996
installer/pi-friendly/web-host.mjs 3ea88db6f0ee9d65271d3060b1ac51b2d182b0502f4ae21092a1a6533376f5d5
installer/pi-friendly/web-messages.mjs 10100e73c844cdcc750a7d0383424aeafb9f2a0dabc635b7e1839c50001b251d
installer/pi-friendly/web-rpc.mjs 30c726753bec0cd74607cbd3251d8e7bfa981ba30ca237097477251b5760c792
installer/pi-friendly/web-server.mjs 66c492ecb7a67e24b562507b9fb707d426638dd3cfdadcfd1c54b57c588239c7
installer/pi-friendly/workspace.mjs 59d10621f26b7e9ac9f90073f686c5e4a9d084bd103afd8978eb6d19c7d4c568
installer/pi-friendly/voice-worker.py 5e0119a3b732a70ca4019f9dea5c20802892d9b4f3af83750f096c457d94d55d
MANIFEST
printf '%s\0%s\0%s\0%s\0%s\0' "$TASK_API_KEY" "$TASK_BASE_URL" "$TASK_PROVIDER" "$TASK_DEFAULT_MODEL" "$TASK_CONFIG_DIR" | node "$TASK_TMP/installer/configure.mjs"
unset TASK_API_KEY
cleanup
TASK_TMP=''
if [[ "${PI_NO_START:-0}" != 1 ]]; then
  if [[ -r /dev/tty && -w /dev/tty ]]; then exec pi </dev/tty >/dev/tty 2>&1
  else echo 'Installation complete. Open a terminal and run: pi'; fi
fi
