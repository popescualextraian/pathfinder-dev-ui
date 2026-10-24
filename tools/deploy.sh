#!/usr/bin/env bash
# Deploys (or redeploys) the UI with its Docker socket filter from the main branch of this checkout.
#
#   tools/deploy.sh <env-file>
#
# 1. refuses when the checkout has local changes or is not on main
# 2. git pull --ff-only
# 3. checks that the task image (ENGINE_IMAGE in the env file) exists locally
# 4. docker compose --env-file <env-file> up -d --build --wait
# 5. prints the URL
# Behind a TLS-intercepting proxy the images trust its root certificates: the folder PATHFINDER_CA_DIR (default
# ~/.agentic/ca when it holds *.crt) is passed to the builds as the context `ca`; without it nothing changes.
# The env file holds secrets: it is never printed and never sourced; only ENGINE_IMAGE and UI_PORT are
# read from it (grep/sed). Redeploying is the same command.
set -euo pipefail

die() {
  echo "deploy: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || die "usage: tools/deploy.sh <env-file>"
env_file=$1
[ -f "$env_file" ] && [ -r "$env_file" ] || die "the env file is not a readable file: $env_file"
env_file="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Value of NAME in the env file (last assignment wins; surrounding quotes and a trailing CR removed).
env_value() {
  grep -E "^[[:space:]]*$1=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/\r$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}

[ -z "$(git status --porcelain)" ] || die "the checkout has local changes; commit or discard them first"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || die "the checkout is on '$branch', not main"

git pull --ff-only

image="$(env_value ENGINE_IMAGE)"
[ -n "$image" ] || die "ENGINE_IMAGE is not set in the env file"
[[ "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]] || die "ENGINE_IMAGE in the env file is not an image reference"
port="$(env_value UI_PORT)"
port="${port:-3000}"
[[ "$port" =~ ^[0-9]+$ ]] || die "UI_PORT in the env file is not a number"

docker image inspect "$image" > /dev/null 2>&1 || die "the task image '$image' does not exist locally; build it with 'agentic build'"

# Proxy root certificates for the image builds (build context `ca` of compose.yaml). An explicit PATHFINDER_CA_DIR must hold
# a .crt; the default ~/.agentic/ca is used only when it does. The certificates are never copied into the repository.
has_crt() { compgen -G "$1/*.crt" > /dev/null; }
ca_dir="${PATHFINDER_CA_DIR:-}"
if [ -n "$ca_dir" ]; then
  [ -d "$ca_dir" ] && has_crt "$ca_dir" || die "PATHFINDER_CA_DIR must be a folder with at least one .crt file: $ca_dir"
  ca_dir="$(cd "$ca_dir" && pwd)"
elif [ -n "${HOME:-}" ] && [ -d "$HOME/.agentic/ca" ] && has_crt "$HOME/.agentic/ca"; then
  ca_dir="$(cd "$HOME/.agentic/ca" && pwd)"
fi
if [ -n "$ca_dir" ]; then
  export PATHFINDER_CA_CONTEXT="$ca_dir"
  echo "deploy: trusting the proxy certificates in $ca_dir at image build"
fi

# compose reads the ui's env_file from this variable; the same file feeds the ${...} interpolation.
export PATHFINDER_ENV_FILE="$env_file"
docker compose --env-file "$env_file" up -d --build --wait

echo "deploy: up at http://127.0.0.1:${port}"
