import { IsOptional } from 'class-validator';
import { SafeId } from './safe-id';

export class RunsQueryDto {
  // Only the runs of this item.
  @IsOptional()
  @SafeId('itemId')
  itemId?: string;
}
