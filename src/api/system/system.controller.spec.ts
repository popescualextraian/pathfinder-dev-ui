import { SystemService } from '../../service/system/system.service';
import { SystemController } from './system.controller';

describe('SystemController', () => {
  it('returns what the service provides', () => {
    const info = { name: 'app', version: '1.2.3', uptimeSeconds: 7 };
    const service = { getInfo: jest.fn().mockReturnValue(info) };

    expect(new SystemController(service as unknown as SystemService).getInfo()).toBe(info);
  });
});
