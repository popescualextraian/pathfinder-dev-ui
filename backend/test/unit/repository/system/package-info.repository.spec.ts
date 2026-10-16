import { PackageInfoRepository } from '../../../../src/repository/system/package-info.repository';
import pkg from '../../../../../package.json';

describe('PackageInfoRepository', () => {
  it('reads name and version from package.json', () => {
    expect(new PackageInfoRepository().read()).toEqual({ name: pkg.name, version: pkg.version });
  });
});
