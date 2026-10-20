import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MoveDto {
  // The lane the client believes the item is in; the source refuses the move (409) if it is elsewhere.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  from!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  to!: string;
}
