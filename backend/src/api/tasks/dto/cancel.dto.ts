import { OptionalSessionName } from './session-name';

export class CancelDto {
  // The session whose turn is cancelled; main when absent.
  @OptionalSessionName()
  session?: string;
}
