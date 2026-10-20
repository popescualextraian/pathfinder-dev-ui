import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import type { WorkflowDefinition, WorkflowValidationError } from '../api/models';
import {
  createWorkflow,
  readWorkflow,
  updateWorkflow,
  validateWorkflow,
} from '../api/workflows-api';
import {
  duplicateDraft,
  isSameDefinition,
  newDraft,
  normalize,
  proposeId,
  setTitle as draftSetTitle,
  toWire,
} from './workflow-draft';

export type EditorSource = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string };

export const VALIDATE_DELAY_MS = 400;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface WorkflowEditor {
  /** The source is being read. */
  loading: boolean;
  loadError: string | null;
  draft: WorkflowDefinition;
  /** Draft differs from what was loaded or last saved. */
  dirty: boolean;
  id: string;
  /** True until the first save of a new workflow; the id is editable only then. */
  isNew: boolean;
  /** The first broken rule (validation or a 400 of a save); null when fine or not yet checked. */
  validationError: WorkflowValidationError | null;
  /** Version of the file this draft was read from or last saved as; null for a new workflow. */
  version: string | null;
  /** The file changed since it was read (409 on save), or the id exists (create). Cleared by reload or a later save. */
  conflict: string | null;
  /** The folder is read-only (given, or 403 on save). */
  readOnly: boolean;
  saving: boolean;
  saveError: string | null;
  /** The draft can be saved: no error, not read-only, nothing pending, id set. */
  canSave: boolean;
  setDraft: (change: (draft: WorkflowDefinition) => WorkflowDefinition) => void;
  setTitle: (title: string) => void;
  setId: (id: string) => void;
  /** Validates, then creates or updates. True when saved. */
  save: () => Promise<boolean>;
  /** Drops the draft and reads the file again (resolves a conflict). */
  reload: () => Promise<void>;
  /** Reads the file's current version and saves the draft over it (after a conflict). */
  overwrite: () => Promise<boolean>;
  /** Back to the loaded state. */
  discard: () => void;
}

/**
 * Holds one workflow being edited: the draft, its dirty flag, the (debounced) validation, the file version, conflict
 * and read-only state. Edits to the draft go through `setDraft` with the pure helpers of `workflow-draft`.
 */
export function useWorkflowEditor(source: EditorSource, options: { writable?: boolean } = {}): WorkflowEditor {
  const sourceKey = source.kind === 'new' ? 'new' : `${source.kind}:${source.id}`;
  const [loading, setLoading] = useState(source.kind !== 'new');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<WorkflowDefinition>(() => (source.kind === 'new' ? newDraft() : emptyDef()));
  const [draft, setDraftState] = useState<WorkflowDefinition>(initial);
  const [id, setIdState] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [isNew, setIsNew] = useState(source.kind !== 'edit');
  const [version, setVersion] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<WorkflowValidationError | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(options.writable === false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const validationRun = useRef(0);

  useEffect(() => setReadOnly(options.writable === false), [options.writable]);

  const apply = useCallback((def: WorkflowDefinition, nextId: string, nextVersion: string | null, nextNew: boolean) => {
    validationRun.current++;
    setInitial(def);
    setDraftState(def);
    setIdState(nextId);
    setIdTouched(nextId !== '');
    setVersion(nextVersion);
    setIsNew(nextNew);
    setValidationError(null);
    setConflict(null);
    setSaveError(null);
  }, []);

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      if (source.kind === 'new') {
        apply(newDraft(), '', null, true);
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const stored = await readWorkflow(source.id);
        if (isCancelled()) return;
        const { id: _id, ...def } = stored.definition;
        if (source.kind === 'edit') apply(normalize(def), source.id, stored.version, false);
        else apply(duplicateDraft(def), '', null, true);
      } catch (e) {
        if (!isCancelled()) setLoadError(message(e));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceKey, apply],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const dirty = useMemo(() => !isSameDefinition(draft, initial), [draft, initial]);

  // A duplicate has no id yet: proposed from its title until the user types one.
  useEffect(() => {
    if (isNew && !idTouched) setIdState(proposeId(draft.title));
  }, [isNew, idTouched, draft.title]);

  // Debounced check of the draft while it is being edited (the last answer wins).
  useEffect(() => {
    if (!dirty || loading) return;
    const run = ++validationRun.current;
    const timer = setTimeout(() => {
      validateWorkflow(toWire(draft))
        .then((errors) => {
          if (run === validationRun.current) setValidationError(errors[0] ?? null);
        })
        .catch(() => {
          // the save checks again and reports
        });
    }, VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, loading]);

  const setDraft = useCallback((change: (d: WorkflowDefinition) => WorkflowDefinition) => {
    setDraftState((d) => change(d));
    setValidationError(null);
    setSaveError(null);
  }, []);

  const setTitle = useCallback((title: string) => setDraft((d) => draftSetTitle(d, title)), [setDraft]);
  const setId = useCallback((value: string) => {
    setIdState(value);
    setIdTouched(true);
  }, []);

  const write = useCallback(
    async (expectedVersion: string | null): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      const run = ++validationRun.current;
      try {
        const wire = toWire(draft);
        const errors = await validateWorkflow(wire);
        if (errors.length > 0) {
          if (run === validationRun.current) setValidationError(errors[0]);
          return false;
        }
        const stored =
          isNew || expectedVersion === null ? await createWorkflow(id, wire) : await updateWorkflow(id, wire, expectedVersion);
        const { id: _id, ...saved } = stored.definition;
        setInitial(isSameDefinition(saved, wire) ? draft : saved);
        setVersion(stored.version);
        setIsNew(false);
        setConflict(null);
        setValidationError(null);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(e.message);
        else if (e instanceof ApiError && e.status === 403) setReadOnly(true);
        else if (e instanceof ApiError && e.status === 400 && e.location)
          setValidationError({ message: e.message, ...e.location });
        else setSaveError(message(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [draft, id, isNew],
  );

  const save = useCallback(() => write(version), [write, version]);

  const overwrite = useCallback(async (): Promise<boolean> => {
    try {
      const current = await readWorkflow(id);
      setVersion(current.version);
      return await write(current.version);
    } catch (e) {
      setSaveError(message(e));
      return false;
    }
  }, [id, write]);

  const reload = useCallback(() => load(() => false), [load]);
  const discard = useCallback(() => {
    setDraftState(initial);
    setValidationError(null);
    setSaveError(null);
  }, [initial]);

  const canSave = !readOnly && !saving && !loading && id !== '' && validationError === null && (dirty || isNew);

  return {
    loading, loadError, draft, dirty, id, isNew, validationError, version, conflict, readOnly, saving, saveError,
    canSave, setDraft, setTitle, setId, save, reload, overwrite, discard,
  };
}

function emptyDef(): WorkflowDefinition {
  return { title: '', steps: [] };
}
