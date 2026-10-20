import { HealthController } from '../../../../src/api/system/health.controller';

describe('HealthController', () => {
  it('answers ok without any dependency', () => {
    expect(new HealthController().getHealth()).toEqual({ ok: true });
  });
});
