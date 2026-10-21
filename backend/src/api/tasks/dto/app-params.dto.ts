import { IsString, Matches } from 'class-validator';

export class AppParamsDto {
  @IsString()
  id!: string;

  // Checked before any bridge call: the name goes into a bridge URL.
  @Matches(/^[a-z][a-z0-9-]{0,30}$/, { message: 'name must be lowercase letters, digits and dashes, starting with a letter (31 characters at most)' })
  name!: string;
}
