import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class LinesQueryDto {
  // How many log lines to return: strictly digits, 1 to 2000, default 200.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value === undefined ? undefined : NaN))
  @IsInt()
  @Min(1)
  @Max(2000)
  lines?: number;
}
