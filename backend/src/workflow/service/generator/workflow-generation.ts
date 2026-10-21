import { randomBytes } from 'node:crypto';
import type { WorkflowDefinition } from '../workflow-definition';
import type { WorkflowValidationError } from '../workflow-definitions.service';
import type { WorkflowTaskCost, WorkflowTaskQuestion } from '../workflow-tasks';

/**
 * writing: the agent works on the draft (first turn or a change request); asking: the agent has an open question;
 * fixing: the draft failed the check and the errors went back to the agent (`attempts` of MAX_FIX_ATTEMPTS);
 * ready: a valid draft; failed: still errors after the last fix, or the task failed, was stopped or is gone.
 * saved and discarded end it (its task is closed).
 */
export type GenerationState = 'writing' | 'asking' | 'fixing' | 'ready' | 'failed' | 'saved' | 'discarded';

/** How many times the errors go back to the agent before the generation fails (so at most 3 checks per round). */
export const MAX_FIX_ATTEMPTS = 2;

export const OPEN_GENERATION_STATES: readonly GenerationState[] = ['writing', 'asking', 'fixing', 'ready', 'failed'];
export const isOpenGeneration = (g: Pick<WorkflowGeneration, 'state'>): boolean => OPEN_GENERATION_STATES.includes(g.state);
/** The agent is (or should be) working: its turns are followed and checked. */
export const isWorking = (g: Pick<WorkflowGeneration, 'state'>): boolean => ['writing', 'asking', 'fixing'].includes(g.state);

export interface WorkflowGenerationView {
  id: string;
  taskId: string;
  description: string;
  model?: string;
  state: GenerationState;
  /** Fixes sent in the current round (0 after start and after a change request). */
  attempts: number;
  /**
   * ready: the valid definition (id `draft`; the editor proposes the real id from the title). failed: the last file
   * as parsed when it was a YAML mapping (it does not pass the check). Absent otherwise.
   */
  draft?: WorkflowDefinition | Record<string, unknown>;
  /** The check's errors: sent back to the agent (fixing) or the final ones (failed). */
  errors?: WorkflowValidationError[];
  /** Why it failed when that was the task (failed, stopped, gone) rather than the draft. */
  failureReason?: string;
  /** The last action on the task failed (e.g. reading the file or sending a prompt); it is retried. */
  warning?: string;
  /** The agent's open question (oldest of the task's main session), while there is one. */
  question?: WorkflowTaskQuestion;
  /** The agent's last final message (main session). */
  lastMessage?: string;
  /** What the task cost so far, as last seen. */
  cost?: WorkflowTaskCost;
  createdAt: string;
  updatedAt: string;
  /** When it was saved or discarded. */
  finishedAt?: string;
}

/** What the list shows: everything but the draft, and whether there is one. */
export type WorkflowGenerationSummary = Omit<WorkflowGenerationView, 'draft'> & { hasDraft: boolean };

/** The stored generation: the view plus how the current turn of the agent is followed. */
export interface WorkflowGeneration extends WorkflowGenerationView {
  turn: {
    /** running: the agent has a prompt to work on; done: its turn ended and the draft is still to be checked. */
    status: 'running' | 'done';
    /** The session's lastMessageAt when the prompt was sent; a different value means the turn ended. */
    baseline?: string;
    /** Seen busy (running/waiting) since the prompt was sent. */
    sawBusy?: boolean;
  };
}

export const GENERATION_ID = /^G-\d{8}-[a-z0-9]{8}$/;

export function newGenerationId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const suffix = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
  return `G-${day}-${suffix}`;
}

export function toGenerationView(g: WorkflowGeneration): WorkflowGenerationView {
  const { turn: _internal, ...view } = structuredClone(g); // eslint-disable-line @typescript-eslint/no-unused-vars
  return view;
}

export function toGenerationSummary(g: WorkflowGeneration): WorkflowGenerationSummary {
  const { draft, ...rest } = toGenerationView(g);
  return { ...rest, hasDraft: draft !== undefined };
}
