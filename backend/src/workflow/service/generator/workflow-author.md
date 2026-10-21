# Write a workflow definition

You write one workflow definition for a task engine, from the description at the end of this text. Your result is ONE file, `workflow-draft.yaml`, at the root of your worktree (the folder you are working in). A person reviews it in an editor afterwards; nothing is saved without them.

## What a workflow is

A workflow drives a work item (a backlog card) through a series of steps. Each step sends a prompt to an agent in a task, optionally moves the card to a lane (a "stage"), and then either waits for a human to press "Continue" (`gate: human`) or goes on by itself as soon as the agent is done (`gate: auto`). After the last step the card can move to a final lane (`doneStage`).

## The file

A YAML mapping with these keys.

- `title` (required): a short name of the workflow.
- `steps` (required): a non-empty list, run in order.
- `doneStage` (optional): the lane the card moves to when the last step is done.

The file name gives the workflow its id; you do not write an id at the top level. Do not write any other top-level key.

Each step is a mapping:

- `id` (required): lower case letters, digits, `-` and `_`; starts with a letter or digit; at most 32 characters; unique. Only the first step may be called `main`; no other step may use that id. The id is also the name of the step's conversation.
- `title` (required): a short name shown to people.
- `gate` (required): exactly `human` or `auto`.
- `prompt` (required): the text sent to the agent, may use placeholders (below).
- `stage` (optional): the lane the card moves to when the step starts. Leave it out when the card should stay where it is. It must be one of the allowed lanes.
- `requires` (optional): a list of file paths that must exist in the worktree before the step may start (see below).
- `exitPrompt` (optional): sent to the agent when the step's work is to end, so it finishes cleanly (for example "commit everything").
- `model` (optional): the model for the step's new conversation. Leave it out unless the description asks for one.
- `continue` (optional): the id of an EARLIER step. This step's prompt is sent into that step's conversation, so the agent remembers it.
- `fork` (optional): the id of an EARLIER step. This step starts a new conversation that is a copy of that step's conversation.

Conversations: by default every step gets a new, empty conversation (the first step's is the task's main one). `continue` and `fork` are the only ways to share history, and only with a step that comes before. A step cannot use both `continue` and `fork`, and the first step can use neither. `model` is refused on a step with `continue` (it keeps the conversation's model).

Old format: a step with a `sessions:` key (several prompts per step) is refused. One step has exactly one `prompt`.

### Allowed lanes

`stage` and `doneStage` may only be one of these lane ids (anything else is refused):

%%STAGES%%

Choose the lanes by their names: a planning step belongs in a planning lane, implementation in an in-progress lane, review in a review lane, and so on. If no lane fits a step, leave `stage` out.

### Placeholders

In `prompt`, `exitPrompt` and `requires` entries, these are filled in when the step runs. Nothing else in double braces is allowed (an unknown name is refused).

- `{{item.id}}`, `{{item.title}}`, `{{item.description}}`, `{{item.url}}`: the work item.
- `{{task.id}}`, `{{task.branch}}`: the task the workflow runs in.
- `{{step.id}}`: the id of the step.

The FIRST step's prompt starts the task, so `{{task.id}}` and `{{task.branch}}` are not known yet and are refused there (they are fine in later steps). Use no double braces for anything else.

### `requires`

Paths are relative to the worktree, with no leading `/` and no `..`. Placeholders are allowed. A step may only start when every listed file exists. Use it when a step depends on a file an earlier step must produce: name that file in the earlier step's prompt (and its exit prompt), and list it in `requires` of the step that needs it.

### Mistakes the validator refuses

These are NOT valid, so do not write them (shown without YAML fences on purpose):

    - id: main          # on any step but the first
    - continue: later   # a step that comes after this one, or does not exist
    - continue: a, with model: x   # model together with continue
    - prompt: "Open {{task.branch}}"   # in the first step
    - stage: somewhere-else            # not an allowed lane
    - gate: manual                     # only human or auto

## Writing good steps

- Keep the workflow as short as the description allows; two to five steps is typical. One step per phase a human would want to see or approve.
- Write each prompt so an agent that knows nothing else can act on it. Refer to the work item with the placeholders instead of repeating it. Say what to produce and where.
- The first prompt cannot use `{{task.*}}`.
- Name the files one step hands on, and list them in `requires` of the step that uses them.
- Use `gate: human` where a person should look before it goes on (a plan, a review); use `gate: auto` for work that needs no approval.
- Write an `exitPrompt` where the agent could stop halfway (a plan that must be complete and committed, work that must be committed). It should make the agent finish.
- Use `continue` when a step is the same job going on (it needs everything said before), `fork` when a step should start from what the earlier step knows but do something else (a review of the implementation), and neither when it should start fresh from files.

## Two complete examples

They are valid for the lanes of an example board (plan, in-progress, review, done). Yours must use the allowed lanes above, not necessarily these.

```yaml
# Example workflow for the lanes of backlog.example.yaml: implement on its own, then a human-gated review.
# gate: auto goes on as soon as the step's session is done; human waits for "Continue".
title: Implement, review
steps:
  - id: implement
    title: Implement
    stage: in-progress
    prompt: |
      Implement backlog item #{{item.id}}: {{item.title}}
      {{item.description}}
      Work test-first and commit per step.
    gate: auto
  - id: review
    title: Review
    stage: review
    fork: implement
    prompt: Review the branch of {{task.branch}} for item
    gate: human
doneStage: done
```

```yaml
# Example workflow for the lanes of backlog.example.yaml (stage = lane id). Copy into WORKFLOWS_DIR.
# The file name without extension is the workflow id. A step has one prompt and one conversation: by default a new
# one (the first step's is the task's main session); `continue: <earlier step>` sends the prompt into that step's
# conversation; `fork: <earlier step>` starts as a copy of it. `model` is not allowed together with `continue`.
title: Plan, implement, review
steps:
  - id: plan
    title: Plan
    stage: plan
    prompt: |
      You plan backlog item #{{item.id}}: {{item.title}}
      {{item.description}}
      Use superpowers:brainstorming with the human, then write the plan to plans/{{item.id}}.md.
    gate: human
    exitPrompt: Make sure the plan is complete in plans/{{item.id}}.md and committed.
  - id: implement
    title: Implement
    stage: in-progress
    requires:
      - plans/{{item.id}}.md
    prompt: Implement plans/{{item.id}}.md, subagent-driven and test-first. Commit per step.
    gate: auto
  - id: review
    title: Review
    stage: review
    fork: implement
    model: sonnet
    prompt: Review the branch against plans/{{item.id}}.md and fix what is real.
    gate: human
doneStage: done
```

## What to do

1. Read the description at the end.
2. If useful, look at the repository (its README, CLAUDE.md, how it is built and tested) so the prompts fit it.
3. If the description leaves out something that changes the steps (for example whether a human must approve a step), ask the person with `agentic-ask`. Do not ask about things you can decide sensibly.
4. Write the workflow to `workflow-draft.yaml` at the root of your worktree: the whole file, only YAML, no Markdown fences in it. Do not call any API and do not save it anywhere else; the system reads and checks the file after your turn. If it reports errors, fix the file and finish again.
5. Finish with a short summary of the workflow (a few lines).

## HD's description (the input)

%%DESCRIPTION%%
