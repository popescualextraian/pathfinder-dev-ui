# Thin wrapper over tools/: one Pathfinder UI per project env file (projects/<name>.env).
#   make new [NAME=drp REPO=https://... GIT_NAME="A B" GIT_EMAIL=a@b.c GITLAB=https://...]   asks for what is missing
#   make up | restart | ps | logs | down | destroy [ENV=projects/drp.env]                    ENV defaults to the only file in projects/
ENV ?= $(if $(filter 1,$(words $(wildcard projects/*.env))),$(wildcard projects/*.env))
need_env = $(if $(ENV),,$(error $(if $(wildcard projects/*.env),several project files: choose one with  make $(MAKECMDGOALS) ENV=<file>  (found: $(wildcard projects/*.env)),no project file in projects/: run  make new  first)))

.PHONY: new up restart ps logs down destroy
# Only values given on the command line count: NAME and friends are often set in the shell (WSL exports NAME=<hostname>).
cli = $(if $(filter command line,$(origin $(1))),$($(1)))
new:
	tools/new-project.sh "$(call cli,NAME)" "$(call cli,REPO)" "$(call cli,GIT_NAME)" "$(call cli,GIT_EMAIL)" "$(call cli,GITLAB)"
up:
	$(need_env)
	tools/deploy.sh $(ENV)
# new containers from the same files, e.g. after editing backlog.yaml, which the ui reads only at start
restart:
	$(need_env)
	tools/compose.sh $(ENV) up -d --force-recreate --wait
ps logs:
	$(need_env)
	tools/compose.sh $(ENV) $@ $(ARGS)
down:
	$(need_env)
	tools/compose.sh $(ENV) down
# removes the project completely (asks first); `down` only stops it and keeps the data
destroy:
	$(need_env)
	tools/destroy.sh $(ENV)
