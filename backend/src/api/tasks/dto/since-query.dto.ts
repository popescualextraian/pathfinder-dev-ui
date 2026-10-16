import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class SinceQueryDto {
  // Events after this sequence number. Strictly digits: '', '1.5' and 'abc' are rejected.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value === undefined ? undefined : NaN))
  @IsInt()
  @Min(0)
  since?: number;
}
