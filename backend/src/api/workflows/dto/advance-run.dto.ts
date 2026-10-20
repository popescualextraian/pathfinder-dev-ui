import { IsBoolean, IsOptional } from 'class-validator';

export class AdvanceRunDto {
  // "Start anyway": go on although the next step's required files are missing.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
