import { useMemo } from 'react';
import type { Lane } from './api/models';
import { useWorkflowEditor, type EditorSource } from './state/use-workflow-editor';
import { WorkflowEditor } from './views/WorkflowEditor';

interface Props {
  /** `new` for a new workflow, else an id; `from` makes a new one a copy. */
  workflow: string;
  from: string | null;
  lanes: Lane[];
  writable: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}

/** Wires the editor state to the editor view for one route. */
export function WorkflowEditorPage({ workflow, from, lanes, writable, onClose, onSaved }: Props) {
  const source = useMemo<EditorSource>(
    () => (workflow === 'new' ? (from ? { kind: 'duplicate', id: from } : { kind: 'new' }) : { kind: 'edit', id: workflow }),
    [workflow, from],
  );
  const editor = useWorkflowEditor(source, { writable });
  return <WorkflowEditor editor={editor} lanes={lanes} onClose={onClose} onSaved={onSaved} />;
}
