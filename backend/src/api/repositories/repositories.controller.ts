import { Controller, Get } from '@nestjs/common';
import { Repository, RepositoriesService } from '../../service/repositories/repositories.service';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Get()
  list(): Repository[] {
    return this.repositories.list();
  }
}
