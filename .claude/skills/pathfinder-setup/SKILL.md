---
name: pathfinder-setup
description: Set up Pathfinder on this machine from scratch, or check and repair an existing setup - WSL and its prerequisites, pathfinder-dev-base and the agentic CLI, the base image, a project's task image, the UI settings file with its tokens, the UI in Docker, optionally the GitLab board and workflows. Works from a Claude session on Windows (it drives Ubuntu through wsl.exe) or inside Ubuntu. Use when someone asks to install, set up, configure, repair or update Pathfinder, add a project to it, or when the UI does not start.
---

# Pathfinder setup

You set up Pathfinder for a teammate. The commands and values come from the team guide, `docs/team-setup.md` of
pathfinder-dev-ui (raw: https://raw.githubusercontent.com/popescualextraian/pathfinder-dev-ui/main/docs/team-setup.md;
inside a checkout: `docs/team-setup.md`). Read it first; this skill says how to run it with the user. Where the
two disagree, the guide's commands win and you tell the user.

Everything Pathfinder runs lives **inside Ubuntu (WSL)**, in the Linux home (`~/pathfinder`), never on the Windows
drive (`/mnt/c`): containers read the Linux file system many times faster, and scripts keep their line endings.

## Rules

- **Tokens never pass through the chat.** Never ask for one in the chat, never print one, never `cat`, `source` or
  `echo` a file that holds tokens. The user puts tokens into `~/pathfinder/pathfinder.env` with an editor. Check a
  token only by counting (`grep -c '^GH_TOKEN=.\+' FILE`: 1 = set) or by an HTTP status code. Show such a file only
  masked: `sed -E 's/^([A-Z_]*TOKEN)=.+/\1=***/' FILE`.
- One step at a time: **check, act only when the check fails, check again.** Never redo a step whose check passes
  (no rebuilds, no re-clones). Before each step say in one line what you check and what you will do.
- **Ask first** for: anything run as root (say what, once per step), deleting anything, `wsl --terminate`,
  `docker compose down -v` (deletes task records), pushing, committing to the project, changing its `.agentic/`.
- Every `docker compose` command, in `~/pathfinder/pathfinder-dev-ui`, takes `--env-file ~/pathfinder/pathfinder.env`
  (compose needs `DOCKER_GID` from it even to stop or read logs).
- Never touch other containers, images, folders or distros of the user. Pathfinder's are `agentic-*`,
  `agentic-ui-task-*`, the compose project `agentic-pathfinder-dev-ui` and `~/pathfinder`.
- Builds take long (base image about 15 minutes). Run them as a background command of your own and check its output;
  tell the user how long it takes. **A build log with no new line for 10 minutes is a hung download** (the image's install
  scripts may wait forever): ask, stop that build, and run it again (the cache keeps the finished steps). After
  `~/.agentic/ca/` changed, a base that already exists is rebuilt only with `agentic build-base --force`. Never start them with `&` or `nohup` inside a `wsl.exe` call: the process ends
  when `wsl.exe` returns.

## Where you run

Find out first: `uname -s` (Git Bash on Windows: `MINGW...`/`MSYS...`), or `$env:OS` in PowerShell (`Windows_NT`).

**Inside Ubuntu** (`uname -r` contains `microsoft`): run the commands directly. Root commands: give the user the
exact `sudo ...` line to run themselves with `! <command>` (you cannot type a password), then check.

**On Windows** you drive Ubuntu from outside. Set this up once and use it for every command of the guide:

1. The distro: `wsl.exe -l -q | tr -d '\0'` (PowerShell: `wsl -l -q`). Use the one named `Ubuntu` (or `Ubuntu-*`);
   with several, ask. None: see step 0 below. Its user: `wsl.exe -d <D> -e id -un` (`root` means the first-run
   user was never created: step 0).
2. The command prefix (call it `UB`): `wsl.exe -d <D> -e`; as root (`UBROOT`): `wsl.exe -d <D> -u root -e`.
   **The user may give you a different `UB`** (for example a test machine: `wsl -d Ubuntu -- docker exec -i -u
   colleague pf-dryrun`, root: `... -u root ...`): then use theirs everywhere and do not run `wsl --install`,
   `wsl --terminate` or Notepad on it; ask the user to open it in a terminal for editing instead.
3. **Run every step as a script on stdin**, never as a long one-liner: write the step to a file in your scratch or
   temp folder (LF line endings, starting with `set -euo pipefail`, using `~` and `$HOME` freely), then
   `tr -d '\r' < FILE | UB bash -ls` (Git Bash: prefix `MSYS_NO_PATHCONV=1`). That avoids every quoting trap:
   `wsl.exe` would expand `$VARS` itself, and Git Bash rewrites `/paths` in arguments.
4. Root steps (apt, Docker, the docker group, `/etc/wsl.conf`) go the same way through `UBROOT`, after the user's
   yes. They need no password.
5. Files the user edits: open them in Notepad from Windows,
   `notepad.exe '\\wsl.localhost\<D>\home\<user>\pathfinder\pathfinder.env'`, tell them what to paste where, wait
   for their "done", then strip Windows line endings (`sed -i 's/\r$//' FILE`), `chmod 600` it, and check by counting.
6. The browser: `http://localhost:<UI_PORT>` works from Windows (WSL forwards localhost).
7. Windows-side helpers you may use: the Windows git identity (`git config --global user.name`/`user.email`) as the
   default for the tasks' commits (ask), `claude setup-token` in the user's Windows terminal for the Claude token, and
   the Windows certificate store for a proxy's root certificate (step 3).

## Steps

Ask first which project (its https URL on GitLab or GitHub) unless they said it. The folder is `~/pathfinder`
(inside Ubuntu).

| # | Check (pass = skip) | Act |
|---|---|---|
| 0 | (Windows only) a WSL 2 distro exists with a normal user (`wsl -l -v`, step "Where you run" 1) | `wsl --install -d Ubuntu` in the user's terminal as administrator (they run it; it may need a reboot), then they open Ubuntu once from the Start menu and create their user and password. Wait, then continue |
| 1 | `git`, `jq`, `curl` exist; `docker run --rm hello-world` works **without** root; `docker compose version`; `systemctl is-system-running` answers | root: `apt-get update && apt-get install -y git jq curl ca-certificates`, Docker Engine from the guide's step 1 (the apt repository lines), `usermod -aG docker <user>`. No systemd: add `[boot]\nsystemd=true` to `/etc/wsl.conf`. The group and systemd apply to new sessions: check `UB id -nG`; if `docker` is missing, ask to run `wsl.exe --terminate <D>` (it stops everything running in that distro), then check again. Docker Desktop installed too: its WSL integration for this distro must be off, so `docker` talks to the engine in Ubuntu |
| 2 | `~/pathfinder/pathfinder-dev-base` and `~/pathfinder/pathfinder-dev-ui` are git checkouts; `~/.local/bin/agentic` exists | clone both from GitHub (guide step 2), `ln -sf` the CLI. In scripts call it as `~/.local/bin/agentic` (a non-interactive shell may not have `~/.local/bin` on its PATH yet) |
| 3 | no TLS-intercepting proxy: the issuer of the server certificate of `download.docker.com`, `github.com` and `registry-1.docker.io` (`echo | openssl s_client -connect H:443 -servername H 2>/dev/null | openssl x509 -noout -issuer`) is a different public CA for each. A quick `curl` passing is not enough: a proxy may intercept only some hosts | the same issuer for unrelated hosts, or one naming an inspection product (Zscaler, Netskope, Fortinet, Palo Alto, Forcepoint, ...), means the root certificate must be trusted before any build. On Windows, find it in the store (PowerShell: `Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root` where the subject matches that issuer), export it as Base-64 (`[Convert]::ToBase64String($c.RawData)` between `-----BEGIN CERTIFICATE-----` lines) to `.crt` files. **Several copies with the same subject and serial** (a renewed root): keep only the newest (`NotBefore`) for `~/.agentic/ca/` (the images' Chromium store refuses duplicates); the system store may hold all. Then root: copy to `/usr/local/share/ca-certificates/` and `update-ca-certificates`; copy the one to `~/.agentic/ca/`. Ask before each. Inside Ubuntu without Windows access: ask the user for the `.crt` file. Later, a build or pull failing with `x509` or `certificate` errors: come back to this step |
| 4 | `docker image inspect agentic-dev-base:local` | `~/.local/bin/agentic build-base` (background, about 15 minutes) |
| 5 | `~/pathfinder/pathfinder.env` exists, mode 600, with `ENGINE_IMAGE`, `ENGINE_REPO_URL`, `ENGINE_PROJECT`, `ENGINE_GIT_NAME`, `ENGINE_GIT_EMAIL`, `DOCKER_GID`, `UI_PORT` set, and both tokens set (count check) | write it without the tokens (guide step 5); then the user adds `CLAUDE_CODE_OAUTH_TOKEN` (they run `claude setup-token`, in Windows or Ubuntu, and paste the printed token) and `GH_TOKEN` (a GitLab or GitHub token for the repository: guide, Tokens). Check the repository token: `git ls-remote <url>` with it (next row's helper) answers |
| 6 | the project is cloned at `~/pathfinder/projects/<name>` with `.agentic/agentic.yaml` | clone it with the token from the settings file, never typed and never stored: `git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$(sed -n "s/^GH_TOKEN=//p" ~/pathfinder/pathfinder.env)"; }; f' clone <url>`, and set the same helper in the clone (`git config credential.helper ...`) so later pulls work. No `.agentic/`: offer `agentic init` (and `agentic setup` if they want); committing it is the user's call |
| 7 | `docker image inspect agentic-<project>:local`; `agentic doctor` in the project does not say the config changed | `~/.local/bin/agentic build` in the project (background) |
| 8 | `docker compose --env-file ~/pathfinder/pathfinder.env ps` in `~/pathfinder/pathfinder-dev-ui` shows `ui` and `docker-filter` healthy; `curl -fsS localhost:<UI_PORT>/api/health` | `tools/deploy.sh ~/pathfinder/pathfinder.env` (builds the checkout as it is: `git pull` first). A restarting `ui` logs `Invalid engine configuration: X is required`: fix X in the settings file, deploy again |
| 9 | the user started a task in the UI (`http://localhost:<UI_PORT>`) and it answered | read `docker compose --env-file ~/pathfinder/pathfinder.env logs ui --tail 100` and the task; fix from the guide's Troubleshooting |
| 10 (optional, ask) | `GET /api/backlog/lanes` answers 200 and `GET /api/workflows` lists definitions | guide step 7: lanes file, workflows folder, `BACKLOG_CONFIG_FILE`, `WORKFLOWS_DIR_HOST`, an empty `GITLAB_TOKEN=` for the user (a project access token, Developer, scope `api`); check it with the guide's curl lines (scopes and status code only); 403 means the wrong kind of token; deploy again |

Finish with: the URL, where the settings file is (`\\wsl.localhost\<D>\home\<user>\pathfinder\pathfinder.env` from
Windows), how to update (guide step 6 table), and anything left undone.

## Adding another project

One UI per project, with its own containers, network, data and port; the first UI stays untouched. Steps 6 and 7
(clone the project, `agentic build` for its task image) come first, then in `~/pathfinder/pathfinder-dev-ui` (a
current checkout: `git pull`):

1. `make new` asks for name, repository https URL, git name and email (each pre-filled, Enter accepts; or
   `make new NAME=drp REPO=<url> GIT_NAME=... GIT_EMAIL=...`). It writes `projects/<name>.env` (mode 600), the lanes file
   `backlog.yaml` and the `workflows/` folder under `~/.agentic/projects/pathfinder-dev-ui/projects/<name>/`, and puts
   their paths into the env file. The task image is expected as `agentic-<name>:local`: change `ENGINE_IMAGE` if it differs.
2. The user fills in `CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN` and optionally `GITLAB_TOKEN` (turns backlog and workflows on)
   with an editor, never in the chat. Check by counting (`grep -c '^GH_TOKEN=.\+' FILE`). Check the `status::` labels in
   `backlog.yaml` against the project's GitLab board.
3. `make up` (several files in `projects/`: `make up ENV=projects/<name>.env`; also `make ps|logs|down`). It names missing
   settings, derives the network (`pathfinder-<name>`, external when it already exists), `DOCKER_GID` and the Architect page, and
   needs no `-p`, no `PATHFINDER_ENV_FILE`. Never run `tools/deploy.sh` with the first UI's env file for a second project.
4. Check as step 8 with the new `UI_PORT`: health 200; backlog and workflows 200 only with `GITLAB_TOKEN`; the Architect page
   404 means no `docs/architecture/model.json` in the repository yet.
5. Tear down: `make down` stops it and keeps the data; `make destroy` (ask first, it deletes the task records and the task containers on the project's network) removes it all but keeps the env file, lanes file, workflows and images.

More repositories in one UI instead: `ENGINE_REPOS` (they share one task image, so only for projects built from the
same `.agentic/`). Ask which they want.
