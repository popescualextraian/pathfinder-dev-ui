# Thin wrapper over tools/: one Pathfinder UI per project env file (projects/<name>.env).
#   make new [NAME=drp REPO=https://... GIT_NAME="A B" GIT_EMAIL=a@b.c]   asks for what is missing
#   make up | ps | logs | down [ENV=projects/drp.env]                    ENV defaults to the only file in projects/
ENV ?= $(if $(filter 1,$(words $(wildcard projects/*.env))),$(wildcard projects/*.env))
need_env = $(if $(ENV),,$(error $(if $(wildcard projects/*.env),several project files: choose one with  make $(MAKECMDGOALS) ENV=<file>  (found: $(wildcard projects/*.env)),no project file in projects/: run  make new  first)))

.PHONY: new up ps logs down
# Only values given on the command line count: NAME and friends are often set in the shell (WSL exports NAME=<hostname>).
cli = $(if $(filter command line,$(origin $(1))),$($(1)))
new:
	tools/new-project.sh "$(call cli,NAME)" "$(call cli,REPO)" "$(call cli,GIT_NAME)" "$(call cli,GIT_EMAIL)"
up:
	$(need_env)
	tools/deploy.sh $(ENV)
ps logs:
	$(need_env)
	tools/compose.sh $(ENV) $@ $(ARGS)
down:
	$(need_env)
	tools/compose.sh $(ENV) down
