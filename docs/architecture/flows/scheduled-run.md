---
title: Scheduled run
---

# Scheduled run

1. schedule-service: the tick finds due schedules; late by more than two ticks is `missed`; a still running previous result is `skipped`.
2. schedule-integration: starts an ordinary engine task with the `scheduled` input.
3. engine-service: the bridge writes `result.md` and `state.json` and exits; the task stays `stopped`.
4. schedule-service: records the result (last 50) through schedule-repository; a one-off disables itself.
