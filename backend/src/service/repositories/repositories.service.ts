import { Inject, Injectable } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig, RepositoryEntry } from '../../commons/engine-config';

export type Repository = RepositoryEntry;

@Injectable()
export class RepositoriesService {
  constructor(@Inject(ENGINE_CONFIG) private readonly config: Pick<EngineConfig, 'repositories'>) {}

  // The default repository first, then the others in the order of ENGINE_REPOS.
  list(): Repository[] {
    return [...this.config.repositories]
      .sort((a, b) => Number(b.default) - Number(a.default))
      .map((r) => ({ ...r }));
  }
}
