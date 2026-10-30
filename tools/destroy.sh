#!/usr/bin/env bash
# Removes one project's Pathfinder UI completely: its task containers and their volumes, the UI and filter containers, and the
# data volume (task records, workflow runs, backlog cache, clones). Asks first.
#
#   tools/destroy.sh <env-file> [--yes]
#
# Only for a project made by tools/new-project.sh (COMPOSE_PROJECT_NAME in the file): its task containers are the ones
# on its network. Kept: the env file, the lanes file and workflows folder, the images (task image, UI image), and the network
# when it is external (made by someone else, for example shared with a database). `make down` only stops and keeps the data.
set -euo pipefail

die() {
  echo "destroy: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ -r "$1" ] || die "usage: tools/destroy.sh <env-file> [--yes]"
env_file=$1
yes="${2:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

env_value() {
  grep -E "^[[:space:]]*$1=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/\r$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}

project="$(env_value COMPOSE_PROJECT_NAME)"
[ -n "$project" ] || die "no COMPOSE_PROJECT_NAME in $env_file: refusing to touch the default UI (its network is shared)"
network="$(env_value TASK_NETWORK)"
network="${network:-$project}"

tasks="$(docker ps -a --filter "network=$network" --filter label=agentic-ui.kind=task --format '{{.Names}}')"
echo "destroy: this removes project $project:"
echo "  - the UI and filter containers and the data volume (task records, workflow runs, backlog cache)"
echo "  - ${tasks:+$(wc -l <<< "$tasks") }task container(s) on network $network, with their volumes${tasks:+: $(tr '\n' ' ' <<< "$tasks")}"
if [ "$yes" != "--yes" ]; then
  [ -t 0 ] || die "no terminal to ask: pass --yes"
  read -r -p "Type the project name ($project) to continue: " answer
  [ "$answer" = "$project" ] || die "not confirmed, nothing removed"
fi

for task in $tasks; do
  docker rm -f "$task" > /dev/null
  docker volume rm "$task" > /dev/null 2>&1 || true
done
"$root/tools/compose.sh" "$env_file" down -v --remove-orphans
echo "destroy: done. Kept: $env_file, its lanes file and workflows, the images. Start again with: make up"
