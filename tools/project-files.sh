#!/usr/bin/env bash
# Makes the backlog lanes file and the workflows folder of a project (once; existing ones are kept) and prints their paths:
#
#   tools/project-files.sh <env-file>      prints BACKLOG_CONFIG_FILE=<path> and WORKFLOWS_DIR_HOST=<path>
#
# The paths are BACKLOG_CONFIG_FILE and WORKFLOWS_DIR_HOST from the env file, else
# ${PATHFINDER_PROJECTS_DIR:-~/.agentic/projects/pathfinder-dev-ui/projects}/<env file name without .env>/{backlog.yaml,workflows}.
# backlog.yaml is backlog.example.yaml with the GitLab host and project taken from GITLAB_PROJECT_URL (else ENGINE_REPO_URL) (check its lane labels);
# workflows/ is a copy of workflows.example/. Messages go to stderr.
set -euo pipefail

die() {
  echo "project-files: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] && [ -r "$1" ] || die "usage: tools/project-files.sh <env-file>"
env_file=$1
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

env_value() {
  grep -E "^[[:space:]]*$1=" "$env_file" | tail -n 1 | sed -E "s/^[[:space:]]*$1=//; s/\r$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/" || true
}

name="$(basename "$env_file" .env)"
base="${PATHFINDER_PROJECTS_DIR:-${HOME:?HOME is not set}/.agentic/projects/pathfinder-dev-ui/projects}/$name"
backlog="$(env_value BACKLOG_CONFIG_FILE)"
backlog="${backlog:-$base/backlog.yaml}"
workflows="$(env_value WORKFLOWS_DIR_HOST)"
workflows="${workflows:-$base/workflows}"

if [ ! -f "$backlog" ]; then
  repo="$(env_value GITLAB_PROJECT_URL)"
  repo="${repo:-$(env_value ENGINE_REPO_URL)}"
  [[ "$repo" =~ ^(https?://[^/]+)/(.+)$ ]] || die "GITLAB_PROJECT_URL (or ENGINE_REPO_URL) is not an http(s) URL with a path: cannot derive the GitLab project"
  path="${BASH_REMATCH[2]%/}"
  path="${path%.git}"
  mkdir -p "$(dirname "$backlog")"
  sed -e "s#^\(  baseUrl:\).*#\1 ${BASH_REMATCH[1]}#" -e "s#^\(  project:\).*#\1 $path#" "$root/backlog.example.yaml" > "$backlog"
  echo "project-files: wrote $backlog (project $path; the lane labels are the example's, check them)" >&2
fi
if [ ! -d "$workflows" ]; then
  mkdir -p "$(dirname "$workflows")"
  cp -r "$root/workflows.example" "$workflows"
  echo "project-files: wrote $workflows" >&2
  # shortcut: the ui runs as uid 1000; another owner gets a read-only editor, so we only warn
  [ "$(id -u)" = 1000 ] || echo "project-files: $workflows must be writable by uid 1000 for the workflow editor (else it is read-only)" >&2
fi
echo "BACKLOG_CONFIG_FILE=$backlog"
echo "WORKFLOWS_DIR_HOST=$workflows"
