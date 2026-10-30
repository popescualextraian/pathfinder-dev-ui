#!/usr/bin/env bash
# Writes the env file of a new Pathfinder UI for one project: projects/<name>.env (git-ignored, mode 600).
#
#   tools/new-project.sh [name] [repo-url] [git-name] [git-email] [gitlab-project-url]
#
# repo-url is the project repository the tasks start in (the one with .agentic/); gitlab-project-url is the GitLab project of the
# backlog (default: repo-url without -agentic and .git). Anything not given is asked for. Then fill in the three tokens and run: tools/deploy.sh projects/<name>.env
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
    # -e -i: the default is pre-filled and editable; Enter accepts it
    read -e -r -i "${3:-}" -p "$2${3:+ (Enter accepts the suggestion)}: " value
  fi
  [ -n "$value" ] || die "$2 is required"
  printf -v "$1" '%s' "$value"
}

# existing <path> <what>: a path left from an earlier run is backed up (copy next to it) or removed, as asked; NEW_PROJECT_EXISTING=backup|overwrite answers for scripts.
# One answer covers every existing file of this run.
choice="${NEW_PROJECT_EXISTING:-}"
existing() {
  [ -e "$1" ] || return 0
  echo "new-project: $2 exists already: $1" >&2
  [ ! -f "$1" ] || grep -E '^  (baseUrl|project):' "$1" >&2 || true # a lanes file shows its GitLab project
  if [ -z "$choice" ]; then
    [ -t 0 ] || die "no terminal to ask what to do with it (set NEW_PROJECT_EXISTING=backup or overwrite)"
    read -r -p "  [b] backup (keep a copy, write a new one)   [o] overwrite: " choice
  fi
  case "$choice" in
    b | backup) cp -a "$1" "$1.bak-$(date +%Y%m%d-%H%M%S)" && echo "new-project: copy saved as $1.bak-..." >&2 ;;
    o | overwrite) ;;
    *) die "\"$choice\" is not an option: answer b (backup) or o (overwrite)" ;;
  esac
  rm -rf "$1"
}

DEFAULT_NAME="" DEFAULT_REPO=""
# shellcheck source=/dev/null
[ ! -f "$root/tools/new-project.defaults" ] || . "$root/tools/new-project.defaults"
name="${1:-}" repo="${2:-}" git_name="${3:-}" git_email="${4:-}" gitlab="${5:-}"
ask name "Project name (letters, digits, dashes)" "$DEFAULT_NAME"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "\"$name\" is not a project name: use lowercase letters, digits and dashes, at most 31 (for example drp)"
ask repo "Repository https URL" "$DEFAULT_REPO"
[[ "$repo" =~ ^https://[^/@[:space:]]+/[^@[:space:]]+$ ]] || die "\"$repo\" is not usable: the repository must be an https URL without credentials, like https://gitlab.example.com/group/project"
ask git_name "Git author name for the tasks' commits" "$(git config --global user.name 2> /dev/null || true)"
ask git_email "Git author email" "$(git config --global user.email 2> /dev/null || true)"
gitlab_default="${repo%.git}"
gitlab_default="${gitlab_default%-agentic}"
# Without a terminal the suggestion is taken; asking is only for a person.
if [ -z "$gitlab" ] && [ ! -t 0 ]; then gitlab="$gitlab_default"; fi
ask gitlab "GitLab project URL of the backlog" "$gitlab_default"
[[ "$gitlab" =~ ^https://[^/@[:space:]]+/[^@[:space:]]+$ ]] || die "\"$gitlab\" is not usable: the GitLab project must be an https URL without credentials, like https://gitlab.example.com/group/project"

file="$root/projects/$name.env"
existing "$file" "the env file (it holds the tokens)"

# First port from 3001 that no other project file uses and nothing listens on.
used="$(grep -hE '^UI_PORT=' "$root"/projects/*.env 2> /dev/null | cut -d= -f2 || true)"
port=3001
echo "new-project: looking for a free port..."
while grep -qx "$port" <<< "$used" || timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2> /dev/null; do port=$((port + 1)); done

mkdir -p "$root/projects"
umask 077
cat > "$file" << EOF2
COMPOSE_PROJECT_NAME=pathfinder-$name
ENGINE_IMAGE=agentic-$name:local
ENGINE_REPO_URL=$repo
ENGINE_PROJECT=$name
GITLAB_PROJECT_URL=$gitlab
ENGINE_GIT_NAME=$git_name
ENGINE_GIT_EMAIL=$git_email
UI_PORT=$port
TASK_NETWORK=agentic-$name
TASK_NETWORK_EXTERNAL=true
ARCHITECTURE_ENABLED=0
# Tokens: fill in with an editor, not in a chat.
# Claude Code login of the agent (claude setup-token)
CLAUDE_CODE_OAUTH_TOKEN=
# Token of the repository (clone, push)
GH_TOKEN=
# Optional: project access token (Developer, scope api) turns the backlog and workflows on
GITLAB_TOKEN=
EOF2
chmod 600 "$file"
# The lanes file and the workflows folder of an earlier project of this name would be kept as they are and may point at another GitLab project.
data="${PATHFINDER_PROJECTS_DIR:-${HOME:?HOME is not set}/.agentic/projects/pathfinder-dev-ui/projects}/$name"
existing "$data/backlog.yaml" "the lanes file"
existing "$data/workflows" "the workflows folder"
echo "new-project: preparing the lanes file and the workflows folder..."
# The lanes file and the workflows folder, made now so the lanes can be edited before the first deploy; the paths go into the env file.
{
  echo "# Backlog lanes and workflow definitions (used when GITLAB_TOKEN is set); change the paths if you like"
  "$root/tools/project-files.sh" "$file"
} >> "$file"
cat << EOF2

Done: project "$name" is ready (UI port $port).

  Env file:   $file
  Lanes file: $(sed -n 's/^BACKLOG_CONFIG_FILE=//p' "$file")   (check the status:: labels)

Next steps
  1. Open the env file and fill in the tokens (an editor, never a chat):
       CLAUDE_CODE_OAUTH_TOKEN   run: claude setup-token
       GH_TOKEN                  token of the repository (clone and push)
       GITLAB_TOKEN              optional: project access token (Developer, scope api); turns backlog + workflows on
       ${EDITOR:-nano} $file
  2. Build the project's task image if it does not exist yet:  agentic build   (in the project, gives agentic-$name:local)
  3. Start it:  make up        (or: tools/deploy.sh projects/$name.env)
  4. Open http://localhost:$port

EOF2
