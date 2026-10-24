---
id: frontend-views
name: Frontend views
summary: "React components, one CSS module each, and the page shells that wire them."
part: frontend
layer: views

sources:
  - frontend/src/views/
  - frontend/src/App.tsx
  - frontend/src/main.tsx
  - frontend/src/ArchitectPage.tsx
  - frontend/src/ArchitectPage.module.css
  - frontend/src/SchedulesPage.tsx
  - frontend/src/SchedulesPage.module.css
  - frontend/src/WorkflowEditorPage.tsx
  - frontend/src/WorkflowGenerationsSection.tsx
  - frontend/src/theme.css
  - frontend/src/css.d.ts
talks_to:
  - { to: frontend-state, via: call }
patterns: []
status: draft
---

# Frontend views

## Purpose and boundary

React components, one CSS module each, and the page shells that wire them. Rendering only; no API calls.

## Where changes go

Components in `views/`; a new area is one entry in `navGroups` in `Sidebar.tsx`.

## Contracts

Design tokens are CSS variables in `theme.css`.

## Invariants

Components use only theme tokens; no external fonts or CDNs.

## Pitfalls

Views never import `api/`.
