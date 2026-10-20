import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

// At least one field: with none, `title` is validated as required, so an empty patch is a 400.
// The lane is not part of a patch: moves are the only way to change it.
export class UpdateItemDto {
  @ValidateIf((o: UpdateItemDto) => o.title !== undefined || (o.description === undefined && o.assignees === undefined))
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @ValidateIf((o: UpdateItemDto) => o.description !== undefined)
  @IsString()
  @MaxLength(100_000)
  description?: string;

  // Usernames; an empty list unassigns everyone.
  @ValidateIf((o: UpdateItemDto) => o.assignees !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  assignees?: string[];
}
