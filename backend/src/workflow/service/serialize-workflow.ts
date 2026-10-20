import { stringify } from 'yaml';
import type { WorkflowDefinition } from './workflow-definition';

/**
 * The YAML text of a definition: block lists (no flow `[...]` / `{...}`), keys in the order of the examples,
 * multi-line strings as block scalars, strings with placeholders quoted by the YAML library where plain would be wrong.
 * `id` is the file name, not part of the document. Comments of hand-written files are not kept.
 */
export function serializeWorkflowDefinition(def: WorkflowDefinition): string {
  const doc = {
    title: def.title,
    steps: def.steps.map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.stage !== undefined && { stage: s.stage }),
      ...(s.requires !== undefined && { requires: s.requires }),
      sessions: s.sessions.map((x) => ({
        name: x.name,
        ...(x.fork !== undefined && { fork: x.fork }),
        ...(x.model !== undefined && { model: x.model }),
        prompt: x.prompt,
      })),
      gate: s.gate,
      ...(s.exitPrompt !== undefined && { exitPrompt: s.exitPrompt }),
    })),
    ...(def.doneStage !== undefined && { doneStage: def.doneStage }),
  };
  return stringify(doc, { lineWidth: 0, collectionStyle: 'block', defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}
