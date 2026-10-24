---
id: architecture-integration
name: Architecture git access
summary: "Partial bare clones read with ls-tree and cat-file."
part: backend
layer: integration
module: architecture
sources:
  - backend/src/integration/architecture/
talks_to:
  []
patterns: [adapter]
status: draft
---

# Architecture git access

## Purpose and boundary

Partial bare clones read with ls-tree and cat-file. 

## Where changes go

Git behaviour and timeouts.

## Contracts

Implements `RepositoryFiles`.

## Invariants

`execFile` with an args array, explicit env, credentials via `gitCredentialEnv`, never in a URL.

## Pitfalls

Nothing is checked out; a failed fetch serves the stale clone.
