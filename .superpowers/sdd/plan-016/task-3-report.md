# Task 3 report: the skill text
Status: done. Files: backend/src/workflow/service/generator/workflow-author.md, workflow-author.ts, test backend/test/unit/workflow/service/generator/workflow-author.spec.ts, nest-cli.json (assets: workflow/service/generator/*.md).
Export: `fillSkill({ description, stages }: { description: string; stages: readonly string[] }): string` (not yet in workflow/index.ts).
Tests: lint clean, npm test 107 suites / 1599 tests pass, build copies the .md to dist/backend/workflow/service/generator/.
