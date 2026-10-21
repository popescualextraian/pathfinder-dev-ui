import type { WorkflowDefinition } from './workflow-definition';

/**
 * The session of the task a step runs in: the first step's is `main`; a step that continues another step's
 * conversation uses that step's session (chains are followed); every other step gets a new session named after its
 * step id. `step.session` (set only on runs saved before one-session steps) takes precedence.
 */
export function sessionOfStep(def: WorkflowDefinition, index: number): string {
  const step = def.steps[index];
  if (step.session !== undefined) return step.session;
  if (index === 0) return 'main';
  if (step.continue !== undefined) {
    const earlier = def.steps.findIndex((s) => s.id === step.continue);
    if (earlier >= 0 && earlier < index) return sessionOfStep(def, earlier);
  }
  return step.id;
}

/** The session a step's `fork` copies: that step's session. */
export function forkSourceOf(def: WorkflowDefinition, index: number): string | undefined {
  const fork = def.steps[index].fork;
  if (fork === undefined) return undefined;
  const source = def.steps.findIndex((s) => s.id === fork);
  return source >= 0 ? sessionOfStep(def, source) : fork;
}

/** Every distinct session name of the definition, in order of first use. */
export function sessionNames(def: WorkflowDefinition): string[] {
  return [...new Set(def.steps.map((_, i) => sessionOfStep(def, i)))];
}
