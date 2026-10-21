// The input rules of a task (public task API and schedules share them, so they cannot drift).

// Longest prompt or answer text.
export const MAX_TEXT_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_MODEL_LENGTH = 100;
export const MAX_REF_LENGTH = 200;

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/[\]-]*$/;
export const MODEL_NAME_MESSAGE = 'model contains characters that are not allowed';

// Branch, tag or commit; cannot start with '-' (would look like an option to git).
export const REPO_REF = /^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/;
