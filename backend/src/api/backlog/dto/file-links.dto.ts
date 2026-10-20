import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class FileLinkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  repo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ref?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// The full list of links of an item.
export class FileLinksDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FileLinkDto)
  links!: FileLinkDto[];
}
