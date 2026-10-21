---
name: pathfinder-setup
description: Set up Pathfinder on this machine from scratch, or check and repair an existing setup - prerequisites in WSL, pathfinder-dev-base and the agentic CLI, the base image, a project's task image, the UI settings file with its tokens, and the UI in Docker. Use when someone asks to install, set up, configure, repair or update Pathfinder, add a project to it, or when the UI does not start.
---

# Pathfinder setup

You set up Pathfinder for a teammate, following `docs/team-setup.md` in this repository (pathfinder-dev-ui): read
it first, it is the source of truth for every command and value; this skill says how to run it with the user.

## Rules

- **Never ask for a token in the chat and never print one.** Tokens go into files the user edits
  (`~/pathfinder/pathfinder.env`). Check a token only by counting: `grep -c '^GH_TOKEN=.\+' FILE` (1 = set). Never
  `cat`, `source` or `echo` a file that holds tokens; show such a file with values masked
  (`sed -E 's/^([A-Z_]*TOKEN)=.+/\1=***/'`).
- **sudo is the user's.** You cannot type a password. Give the user the exact commands and ask them to run them with
  `! <command>` in this prompt (or in their own terminal), then check the result yourself.
- Run in WSL (Ubuntu). If `uname -r` does not contain `microsoft`/`WSL`, or the current directory is under `/mnt/`,
  stop and explain: everything lives in the Linux home (`~/pathfinder`), not on the Windows drive.
- One step at a time: check, act only when the check fails, check again. Never redo a step whose check passes
  (no rebuilds, no re-clones). Say in one line what you checked and what you do next.
- Destructive or outward actions only with the user's yes: deleting folders, `docker compose down -v` (deletes task
  records), pushing, changing a repository's `.agentic/` and committing it.
- Never touch other containers, images or folders the user has; Pathfinder's are `agentic-*`, `agentic-ui-task-*`
  and the compose project `agentic-pathfinder-dev-ui`.
- Long commands (image builds, about 15 minutes) run in the background with their output in a log file; tell the
  user how long it takes and check the log, do not wait silently.

## Steps

Ask first which project they want (the GitLab https URL) unless they said it, and where they work from:
`~/pathfinder` is the default folder.

| # | Check (pass = skip) | Act |
|---|---|---|
| 1 | `docker run --rm hello-world` works without sudo; `git`, `jq`, `curl` exist; `docker compose version` | guide's step 1 commands for the user to run with sudo; after `usermod -aG docker`, a new terminal is needed: tell them to restart Claude Code in a new terminal and run the skill again |
| 2 | `~/pathfinder/pathfinder-dev-base` and `~/pathfinder/pathfinder-dev-ui` are git checkouts; `command -v agentic` | clone, link `~/.local/bin/agentic` (guide step 2) |
| 3 | `docker image inspect agentic-dev-base:local` | `agentic build-base` in the background (guide step 3) |
| 4 | the project is cloned under `~/pathfinder/projects/<name>` and has `.agentic/agentic.yaml` | clone (the user may need to enter GitLab credentials: ask them to run the clone with `!` if git asks); without `.agentic/`, offer `agentic init` and, if they want, `agentic setup`; never commit for them without a yes |
| 5 | `docker image inspect agentic-<project>:local` and its `agentic.config.hash` label matches (`agentic doctor` says when the config changed) | `agentic build` in the project, in the background |
| 6 | `~/pathfinder/pathfinder.env` exists, mode 600, with `ENGINE_IMAGE`, `ENGINE_REPO_URL`, `ENGINE_PROJECT`, `ENGINE_GIT_NAME`, `ENGINE_GIT_EMAIL`, `DOCKER_GID`, and both tokens set (count check) | write the file without the tokens (guide step 5; fill name and email from `git config`), then ask the user to add `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) and `GH_TOKEN` (GitLab token, see the guide's Tokens table) with `nano`, and wait |
| 7 | `docker compose ps` in `pathfinder-dev-ui` shows `ui` and `docker-filter` healthy; `curl -fsS localhost:<UI_PORT>/api/health` | `tools/deploy.sh ~/pathfinder/pathfinder.env` (it needs the checkout on a clean `main`) |
| 8 | the user started a task in the UI and it reached idle or answered | read `docker compose logs ui --tail 100` and the task's state; fix from the guide's Troubleshooting table |
| 9 (optional, ask) | `GET /api/backlog/lanes` answers 200 and `GET /api/workflows` lists definitions | guide step 7: lanes file, workflows folder, `BACKLOG_CONFIG_FILE`, `WORKFLOWS_DIR_HOST`, an empty `GITLAB_TOKEN=` for the user to fill (a project access token, Developer, `api`); check it with the guide's curl lines (scopes and status code only, never the value); 403 means the wrong kind of token; then deploy again |

Finish with: the URL, where the settings file is, how to update (guide step 6 table), and anything left undone.

## Adding another project

Steps 4 and 5 for the new project, then either a second UI (another folder with its own settings file, compose
project name and `UI_PORT`) or more repositories in one UI with `ENGINE_REPOS` (they share one task image, so only
for projects built from the same `.agentic/`). Ask which they want.
