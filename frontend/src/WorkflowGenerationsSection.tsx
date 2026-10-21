import { useWorkflowGenerations } from './state/use-workflow-generations';
import { WorkflowGenerations } from './views/WorkflowGenerations';

/** Wires the open generations (polled while one is active) to their view; mounted only when the folder is writable. */
export function WorkflowGenerationsSection() {
  const g = useWorkflowGenerations();
  return (
    <WorkflowGenerations
      generations={g.generations}
      error={g.error}
      startState={g.startState}
      actionState={g.actionState}
      start={g.start}
      requestChanges={g.requestChanges}
      discard={g.discard}
      answer={g.answer}
    />
  );
}
