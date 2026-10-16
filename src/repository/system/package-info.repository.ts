import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageInfo {
  name: string;
  version: string;
}

// From src/repository/system (ts-jest) and dist/repository/system (built), the root is three levels up.
const PACKAGE_JSON = join(__dirname, '..', '..', '..', 'package.json');

@Injectable()
export class PackageInfoRepository {
  read(): PackageInfo {
    const { name, version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageInfo;
    return { name, version };
  }
}
