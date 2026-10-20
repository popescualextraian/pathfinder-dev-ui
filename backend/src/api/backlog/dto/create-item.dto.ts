import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateItemDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  description?: string;

  // A lane id; without it the item goes to the default lane.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lane?: string;
}
