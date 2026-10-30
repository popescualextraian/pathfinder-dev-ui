#!/usr/bin/env bash
# Writes the env file of a new Pathfinder UI for one project: projects/<name>.env (git-ignored, mode 600).
#
#   tools/new-project.sh [name] [repo-url] [git-name] [git-email]
#
# Anything not given is asked for. Then fill in the three tokens and run: tools/deploy.sh projects/<name>.env
# The task image is agentic-<name>:local (build it with `agentic build` in the project); change ENGINE_IMAGE if it differs.
set -euo pipefail

die() {
  echo "new-project: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ask() { # ask <variable> <question> [default]
  local value="${!1:-}"
  if [ -z "$value" ]; then
    [ -t 0 ] || die "$2 missing and no terminal to ask (usage: tools/new-project.sh <name> <repo-url> <git-name> <git-email>)"
    read -r -p "$2${3:+ [$3]}: " value
    value="${value:-${3:-}}"
  fi
  [ -n "$value" ] || die "$2 is required"
  printf -v "$1" '%s' "$value"
}

name="${1:-}" repo="${2:-}" git_name="${3:-}" git_email="${4:-}"
ask name "Project name (letters, digits, dashes, for example drp)"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "the name must be lowercase letters, digits and dashes (at most 31)"
ask repo "Repository https URL"
[[ "$repo" =~ ^https://[^/@[:space:]]+/[^@[:space:]]+$ ]] || die "the repository must be an https URL without credentials"
ask git_name "Git author name for the tasks' commits" "$(git config --global user.name 2> /dev/null || true)"
ask git_email "Git author email" "$(git config --global user.email 2> /dev/null || true)"

file="$root/projects/$name.env"
[ ! -e "$file" ] || die "$file exists already"

# First port from 3001 that no other project file uses and nothing listens on.
used="$(grep -hE '^UI_PORT=' "$root"/projects/*.env 2> /dev/null | cut -d= -f2 || true)"
port=3001
while grep -qx "$port" <<< "$used" || (echo > "/dev/tcp/127.0.0.1/$port") 2> /dev/null; do port=$((port + 1)); done

mkdir -p "$root/projects"
umask 077
cat > "$file" << EOF2
COMPOSE_PROJECT_NAME=pathfinder-$name
ENGINE_IMAGE=agentic-$name:local
ENGINE_REPO_URL=$repo
ENGINE_PROJECT=$name
ENGINE_GIT_NAME=$git_name
ENGINE_GIT_EMAIL=$git_email
UI_PORT=$port
# Tokens: fill in with an editor, not in a chat.
# Claude Code login of the agent (claude setup-token)
CLAUDE_CODE_OAUTH_TOKEN=
# Token of the repository (clone, push)
GH_TOKEN=
# Optional: project access token (Developer, scope api) turns the backlog and workflows on
GITLAB_TOKEN=
EOF2
chmod 600 "$file"
# The lanes file and the workflows folder, made now so the lanes can be edited before the first deploy; the paths go into the env file.
{
  echo "# Backlog lanes and workflow definitions (used when GITLAB_TOKEN is set); change the paths if you like"
  "$root/tools/project-files.sh" "$file"
} >> "$file"
echo "new-project: wrote $file (UI port $port)"
echo "next: fill in the tokens, then run  tools/deploy.sh projects/$name.env"
