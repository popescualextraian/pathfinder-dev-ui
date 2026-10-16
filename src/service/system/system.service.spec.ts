import { PackageInfoRepository } from '../../repository/system/package-info.repository';
import { SystemService } from './system.service';

describe('SystemService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds the whole seconds of process uptime to the package info', () => {
    const repository = { read: jest.fn().mockReturnValue({ name: 'app', version: '1.2.3' }) };
    jest.spyOn(process, 'uptime').mockReturnValue(42.9);

    const info = new SystemService(repository as unknown as PackageInfoRepository).getInfo();

    expect(info).toEqual({ name: 'app', version: '1.2.3', uptimeSeconds: 42 });
    expect(repository.read).toHaveBeenCalledTimes(1);
  });
});
