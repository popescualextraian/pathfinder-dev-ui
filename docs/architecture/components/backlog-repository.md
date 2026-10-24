---
id: backlog-repository
name: Backlog cache repository
summary: "The single backlog.json cache file."
part: backend
layer: repository
module: backlog
sources:
  - backend/src/backlog/repository/
talks_to:
  []
patterns: [repository]
status: draft
---

# Backlog cache repository

## Purpose and boundary

The single backlog.json cache file. 

## Where changes go

Storage only.

## Contracts

One file in `BACKLOG_DATA_DIR`.

## Invariants

The cache never holds the token.

## Pitfalls

None.
