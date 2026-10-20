import { SafeId } from './safe-id';

export class StartRunDto {
  // The work item (backlog item) the run carries.
  @SafeId('itemId')
  itemId!: string;

  // The definition's id: its file name without extension.
  @SafeId('workflowId')
  workflowId!: string;
}
