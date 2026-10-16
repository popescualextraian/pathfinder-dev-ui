import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

describe('AppModule', () => {
  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(AppModule)).toBeDefined();
  });
});
