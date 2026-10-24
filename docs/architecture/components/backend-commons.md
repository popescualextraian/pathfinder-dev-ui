---
id: backend-commons
name: Backend commons
summary: "Generic config, global pipes, filters and interceptors, shared input rules."
part: backend
layer: commons

sources:
  - backend/src/commons/
talks_to:
  []
patterns: []
status: draft
---

# Backend commons

## Purpose and boundary

Generic config, global pipes, filters and interceptors, shared input rules. 

## Where changes go

Config loaders, `app.setup.ts` registrations use these.

## Contracts

Config validation names the bad variable without printing values.

## Invariants

Knows no module.

## Pitfalls

Do not add module logic here.
