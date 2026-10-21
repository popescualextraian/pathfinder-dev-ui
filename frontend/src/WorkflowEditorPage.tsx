import { useMemo } from 'react';
import type { Lane } from './api/models';
import { useLeaveGuard } from './state/use-route';
import { useWorkflowEditor, type EditorSource } from './state/use-workflow-editor';
import { markGenerationSavedQuietly } from './state/use-workflow-generations';
import { WorkflowEditor } from './views/WorkflowEditor';

interface Props {
  /** `new` for a new workflow, else an id; `from` makes a new one a copy, `generation` opens a generated draft. */
  workflow: string;
  from: string | null;
  generation?: string | null;
  lanes: Lane[];
  writable: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** A notice about the saved workflow `id` that arrives after `onSaved` (the generation could not be closed). */
  onNotice?: (id: string, notice: string) => void;
  notice?: string | null;
}

/** Wires the editor state to the editor view for one route. */
export function WorkflowEditorPage({ workflow, from, generation = null, lanes, writable, onClose, onSaved, onNotice, notice }: Props) {
  const source = useMemo<EditorSource>(
    () =>
      workflow !== 'new'
        ? { kind: 'edit', id: workflow }
        : from
          ? { kind: 'duplicate', id: from }
          : generation
            ? { kind: 'generated', id: generation }
            : { kind: 'new' },
    [workflow, from, generation],
  );
  const editor = useWorkflowEditor(source, { writable });
  // Leaving by any route (sidebar, back, a link) with unsaved changes asks first, as Cancel does.
  const guard = useLeaveGuard(editor.dirty && !editor.readOnly);
  return (
    <WorkflowEditor
      editor={editor}
      lanes={lanes}
      notice={notice}
      onClose={() => {
        guard.release();
        onClose();
      }}
      onSaved={(id) => {
        const before = window.location.hash;
        guard.release();
        onSaved(id);
        // Saving an existing workflow stays on this address; the draft may have changed meanwhile, so hold again.
        if (window.location.hash === before) guard.rearm();
        // The generation's task is closed only now; a failure there leaves the save as it is.
        if (source.kind === 'generated') {
          void markGenerationSavedQuietly(source.id).then((text) => {
            if (text) onNotice?.(id, text);
          });
        }
      }}
      leaving={guard.pending !== null}
      onLeave={guard.proceed}
      onStay={guard.stay}
    />
  );
}
