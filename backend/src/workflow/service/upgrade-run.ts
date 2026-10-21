import type { StepDef } from './workflow-definition';
import type { WorkflowRun } from './workflow-run';

interface OldSession { name?: unknown; prompt?: unknown; fork?: unknown; model?: unknown }
type OldStep = Omit<StepDef, 'prompt'> & { sessions: OldSession[] };

const isOld = (step: unknown): step is OldStep =>
  typeof step === 'object' && step !== null && Array.isArray((step as { sessions?: unknown }).sessions);

/**
 * Runs saved before task 015 hold a definition snapshot whose steps have `sessions`. Converts it: the first
 * session of a step becomes its prompt, model and fork (the session name of a fork becomes the step that owns that
 * session); the name is kept in the step's internal `session`, which takes precedence over the derived name, so the
 * run keeps using the sessions it already has. Further sessions are dropped. A run in the new format is returned as is.
 */
export function upgradeRunDefinition(run: WorkflowRun): WorkflowRun {
  const steps = run.definition.steps as unknown[];
  if (!steps.some(isOld)) return run;
  const owner = new Map<string, string>();
  for (const step of steps) {
    if (!isOld(step)) continue;
    for (const s of step.sessions) if (typeof s.name === 'string') owner.set(s.name, step.id);
  }
  const converted = steps.map((step): StepDef => {
    if (!isOld(step)) return step as StepDef;
    const { sessions, ...rest } = step;
    const first = sessions[0] ?? {};
    const fork = typeof first.fork === 'string' ? owner.get(first.fork) : undefined;
    return {
      ...rest,
      prompt: String(first.prompt ?? ''),
      ...(typeof first.model === 'string' && { model: first.model }),
      ...(fork !== undefined && { fork }),
      ...(typeof first.name === 'string' && { session: first.name }),
    };
  });
  return { ...run, definition: { ...run.definition, steps: converted } };
}
