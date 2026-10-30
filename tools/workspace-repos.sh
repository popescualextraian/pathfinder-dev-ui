#!/usr/bin/env bash
# Prints ENGINE_REPOS=<json> for the repositories named by the `add workspace` lines of .agentic/agentic.yaml in ENGINE_REPO_URL,
# so a task can be started in each of them (the base image clones them outside /work, where the agent does not look):
#
#   tools/workspace-repos.sh <env-file>
#
# Nothing is printed when the env file sets ENGINE_REPOS itself, the repository has no such lines, or it cannot be read (a warning
# goes to stderr; this never fails). GH_TOKEN is passed to git through its environment only, never in a URL, argument or file.
set -uo pipefail

[ "$#" -eq 1 ] && [ -r "$1" ] || { echo "workspace-repos: usage: tools/workspace-repos.sh <env-file>" >&2; exit 0; }
env_file=$1
env_value() {
  grep -E "^[[:space:]]*$1=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/\r$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}
warn() { echo "workspace-repos: $*" >&2; }

[ -z "$(env_value ENGINE_REPOS)" ] || exit 0
repo="$(env_value ENGINE_REPO_URL)"
[ -n "$repo" ] || exit 0

tmp="$(mktemp -d)" || exit 0
trap 'rm -rf "$tmp"' EXIT
cfg=()
export GH_TOKEN
GH_TOKEN="$(env_value GH_TOKEN)"
if [[ "$repo" =~ ^https://([^/]+)/ ]]; then
  # shellcheck disable=SC2016 # expanded by git's shell when the helper runs
  cfg=(-c "credential.https://${BASH_REMATCH[1]}.helper=" -c 'credential.helper=!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$GH_TOKEN"; }; f')
fi
if ! GIT_TERMINAL_PROMPT=0 timeout 120 git "${cfg[@]}" clone -q --depth 1 --no-checkout --filter=blob:none "$repo" "$tmp/r" 2> /dev/null; then
  warn "could not read the repository (token?): ENGINE_REPOS stays unset; set it by hand to start tasks in its workspaces"
  exit 0
fi
yaml="$(git -C "$tmp/r" show HEAD:.agentic/agentic.yaml 2> /dev/null)" || exit 0

# Names as the base image makes them: --name, else the last part of the URL without .git. Only https workspaces; the default repository is not repeated.
own="${repo%/}"; own="${own%.git}"
json="" seen=" "
while IFS= read -r line; do
  read -r -a w <<< "$(tr -d "\"'" <<< "$line")"
  url="${w[3]:-}" name=""
  [[ "$url" =~ ^https://[^/@[:space:]]+/[^@[:space:]]+$ ]] || continue
  for i in "${!w[@]}"; do [ "${w[$i]}" = --name ] && name="${w[$((i + 1))]:-}"; done
  u="${url%/}"; u="${u%.git}"
  [ "$u" != "$own" ] || continue
  [ -n "$name" ] || name="${u##*/}"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] && [[ "$seen" != *" $name "* ]] || continue
  seen="$seen$name "
  json="${json:+$json,}{\"name\":\"$name\",\"url\":\"$url\"}"
done < <(grep -E '^[[:space:]]*-[[:space:]]+["'"'"']?add workspace[[:space:]]' <<< "$yaml")
[ -z "$json" ] || echo "ENGINE_REPOS=[$json]"
exit 0
