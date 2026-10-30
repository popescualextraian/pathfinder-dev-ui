# Thin wrapper over tools/: one Pathfinder UI per project env file (projects/<name>.env).
#   make new [NAME=drp REPO=https://... GIT_NAME="A B" GIT_EMAIL=a@b.c]   asks for what is missing
#   make up | ps | logs | down [ENV=projects/drp.env]                    ENV defaults to the only file in projects/
ENV ?= $(if $(filter 1,$(words $(wildcard projects/*.env))),$(wildcard projects/*.env))
need_env = $(if $(ENV),,$(error set ENV=projects/<name>.env (found: $(wildcard projects/*.env))))

.PHONY: new up ps logs down
new:
	tools/new-project.sh "$(NAME)" "$(REPO)" "$(GIT_NAME)" "$(GIT_EMAIL)"
up:
	$(need_env)
	tools/deploy.sh $(ENV)
ps logs:
	$(need_env)
	tools/compose.sh $(ENV) $@ $(ARGS)
down:
	$(need_env)
	tools/compose.sh $(ENV) down
