#!/usr/bin/env bash
# Runs docker compose for one Pathfinder UI, described by one env file:
#
#   tools/compose.sh <env-file> <docker compose arguments...>     e.g.  up -d --build --wait | ps | logs ui | down
#
# It passes the env file both ways (the ${...} variables and the ui's env_file) and fills in what the file leaves out.
# Without COMPOSE_PROJECT_NAME in the file nothing else changes (the first UI, name agentic-pathfinder-dev-ui).
# With it ("project mode", see tools/new-project.sh) the UI gets its own network and data folder:
#   TASK_NETWORK        the project name; external when a network of that name exists that compose did not create
#   backlog + workflows on when GITLAB_TOKEN is set (their files: BACKLOG_CONFIG_FILE and WORKFLOWS_DIR_HOST from the
#   file, else made by tools/project-files.sh under ~/.agentic/projects/pathfinder-dev-ui/projects/<name>/)
#   the Architect page on unless ARCHITECTURE_ENABLED is set
#   ENGINE_REPOS from the `add workspace` lines of the repository's .agentic/agentic.yaml when the file lacks it (tools/workspace-repos.sh, on up)
# DOCKER_GID is read from the Docker socket when the file lacks it. The env file is never printed or sourced.
set -euo pipefail

die() {
  echo "compose: $*" >&2
  exit 1
}

[ "$#" -ge 2 ] || die "usage: tools/compose.sh <env-file> <docker compose arguments...>"
env_file=$1
shift
[ -f "$env_file" ] && [ -r "$env_file" ] || die "the env file is not a readable file: $env_file"
env_file="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Value of NAME in the env file (last assignment wins; surrounding quotes and a trailing CR removed).
env_value() {
  grep -E "^[[:space:]]*$1=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/\r$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}

if [ "$1" = up ]; then
  missing=""
  for name in ENGINE_IMAGE ENGINE_REPO_URL ENGINE_PROJECT ENGINE_GIT_NAME ENGINE_GIT_EMAIL GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN; do
    [ -n "$(env_value "$name")" ] || missing="$missing $name"
  done
  [ -z "$missing" ] || die "not set in $env_file:$missing"
fi

export PATHFINDER_ENV_FILE="$env_file"

if [ -z "$(env_value DOCKER_GID)" ]; then
  gid="$(stat -c %g /var/run/docker.sock 2> /dev/null || true)"
  [ -z "$gid" ] || export DOCKER_GID="$gid"
fi

project="$(env_value COMPOSE_PROJECT_NAME)"
if [ -n "$project" ]; then
  if [ -z "$(env_value TASK_NETWORK)" ]; then
    export TASK_NETWORK="$project"
    # A network made by hand or by another stack has no compose project label: compose refuses to adopt it unless external.
    if [ -z "$(env_value TASK_NETWORK_EXTERNAL)" ] && label="$(docker network inspect "$project" --format '{{index .Labels "com.docker.compose.project"}}' 2> /dev/null)" && [ -z "$label" ]; then
      export TASK_NETWORK_EXTERNAL=true
    fi
  fi

  [ -n "$(env_value ARCHITECTURE_ENABLED)" ] || export ARCHITECTURE_ENABLED=1

  if [ "$1" = up ] && [ -z "$(env_value ENGINE_REPOS)" ]; then
    repos="$("$root/tools/workspace-repos.sh" "$env_file")" # warns on stderr, never fails
    [ -z "$repos" ] || export ENGINE_REPOS="${repos#ENGINE_REPOS=}"
  fi

  if [ -z "$(env_value GITLAB_TOKEN)" ]; then
    # Without the token the backlog could not start: off, whatever the file says.
    export BACKLOG_CONFIG_FILE="" WORKFLOWS_DIR_HOST=""
  elif [ "$1" = up ]; then
    paths="$("$root/tools/project-files.sh" "$env_file")" # a failure stops here
    while IFS== read -r key value; do export "$key=$value"; done <<< "$paths"
  fi
fi

exec docker compose --env-file "$env_file" "$@"
