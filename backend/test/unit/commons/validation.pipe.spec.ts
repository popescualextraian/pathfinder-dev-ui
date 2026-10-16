import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createValidationPipe } from '../../../src/commons/validation.pipe';

class Dto {
  @IsString()
  name!: string;
}
const meta: ArgumentMetadata = { type: 'body', metatype: Dto };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('strips properties that are not in the DTO', async () => {
    const result = await pipe.transform({ name: 'a', extra: 1 }, meta);
    expect(result).toEqual({ name: 'a' });
  });

  it('transforms plain objects to DTO instances', async () => {
    expect(await pipe.transform({ name: 'a' }, meta)).toBeInstanceOf(Dto);
  });

  it('rejects invalid input with a 400', async () => {
    await expect(pipe.transform({ name: 1 }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
