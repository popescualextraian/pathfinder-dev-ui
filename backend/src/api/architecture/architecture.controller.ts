import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ArchitectureBadRequestError } from '../../service/architecture/architecture-errors';
import { ArchitectureService } from '../../service/architecture/architecture.service';
import type { CurrentArchitecture, ReviewDetail, ReviewList } from '../../service/architecture/architecture-types';
import { ArchitectureErrorFilter } from './architecture-error.filter';

const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Read-only. `status` is declared first so it is not taken for anything else; `:branch` is one URL-encoded segment.
@Controller('architecture')
@UseFilters(ArchitectureErrorFilter)
export class ArchitectureController {
  constructor(private readonly architecture: ArchitectureService) {}

  @Get('status')
  status(): { repositories: string[] } {
    return this.architecture.status();
  }

  @Get()
  current(@Query('repository') repository?: string): Promise<CurrentArchitecture> {
    return this.architecture.current(this.checked(repository));
  }

  @Get('reviews')
  reviews(@Query('repository') repository?: string): Promise<ReviewList> {
    return this.architecture.reviews(this.checked(repository));
  }

  @Get('reviews/:branch/:slug')
  review(
    @Param('branch') branch: string,
    @Param('slug') slug: string,
    @Query('repository') repository?: string,
  ): Promise<ReviewDetail> {
    return this.architecture.review(this.checked(repository), branch, slug);
  }

  private checked(repository: unknown): string | undefined {
    if (repository === undefined || repository === '') return undefined;
    if (typeof repository !== 'string' || !REPOSITORY_NAME.test(repository)) throw new ArchitectureBadRequestError('invalid repository name');
    return repository;
  }
}
