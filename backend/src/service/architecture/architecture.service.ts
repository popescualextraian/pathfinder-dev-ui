import { Inject, Injectable } from '@nestjs/common';
import { RepositoriesService } from '../repositories/repositories.service';
import { ArchitectureBadRequestError, ArchitectureNotFoundError } from './architecture-errors';
import { FULL_REVIEW_FILE, isValidBranchName, isValidSlug, MODEL_FILE, PLANS_DIR, planFile } from './architecture-names';
import type {
  CurrentArchitecture, FullReview, Model, RefusedReview, ReviewDetail, ReviewList, ReviewSummary,
} from './architecture-types';
import { ArchitectureFileError, parseFullReview, parseModel, parsePlanReview } from './architecture-validator';
import { pageBase } from './page-url';
import { REPOSITORY_FILES, RepositoryFileTooLargeError, RepositoryFiles } from './repository-files';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_BRANCHES = 100;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

@Injectable()
export class ArchitectureService {
  constructor(
    private readonly repositories: RepositoriesService,
    @Inject(REPOSITORY_FILES) private readonly files: RepositoryFiles,
  ) {}

  status(): { repositories: string[] } {
    return { repositories: this.repositories.list().map((r) => r.name) };
  }

  async current(repository?: string): Promise<CurrentArchitecture> {
    const repo = this.resolve(repository);
    const head = await this.files.head(repo.name);
    const model = await this.readModel(repo.name, head.branch);
    let fullReview: FullReview | null = null;
    let fullReviewError: string | null = null;
    try {
      const text = await this.files.read(repo.name, head.branch, FULL_REVIEW_FILE, MAX_FILE_BYTES);
      if (text !== null) fullReview = parseFullReview(FULL_REVIEW_FILE, text);
    } catch (e) {
      fullReviewError = message(e);
    }
    return {
      repository: repo.name, branch: head.branch, sha: head.sha, model, fullReview, fullReviewError,
      pageBase: pageBase(repo.url, head.branch),
    };
  }

  async reviews(repository?: string): Promise<ReviewList> {
    const repo = this.resolve(repository);
    const head = await this.files.head(repo.name);
    const all = await this.files.branches(repo.name);
    const ordered = [
      ...all.filter((b) => b.name === head.branch),
      ...all.filter((b) => b.name !== head.branch),
    ].slice(0, MAX_BRANCHES);
    const defaultIds = new Map(
      (await this.planFiles(repo.name, head.branch)).map((f) => [f.path, f.id]),
    );
    const reviews: ReviewSummary[] = [];
    const refused: RefusedReview[] = [];
    for (const branch of ordered) {
      const isDefault = branch.name === head.branch;
      const plans = (await this.planFiles(repo.name, branch.name))
        .filter((f) => isDefault || defaultIds.get(f.path) !== f.id);
      if (plans.length === 0) continue;
      let model: Model | null = null;
      let modelError = '';
      try {
        model = await this.readModel(repo.name, branch.name);
      } catch (e) {
        modelError = message(e);
      }
      for (const plan of plans) {
        const slug = plan.path.slice(PLANS_DIR.length + 1, -'.json'.length);
        const fail = (error: string): void => {
          refused.push({ branch: branch.name, slug: isValidSlug(slug) ? slug : null, file: plan.path, error });
        };
        if (!model) {
          fail(modelError);
          continue;
        }
        try {
          const text = await this.files.read(repo.name, branch.name, plan.path, MAX_FILE_BYTES);
          if (text === null) {
            fail(`${plan.path} not found`);
            continue;
          }
          const review = parsePlanReview(plan.path, text, model);
          reviews.push({
            branch: branch.name, slug, sha: branch.sha, title: review.title, plan: review.plan,
            reviewedAt: review.reviewedAt, size: review.size, summary: review.summary,
            touched: review.changes.map((c) => ({ component: c.component, change: c.change })),
            openFindings: review.findings.filter((f) => f.status === 'open').length,
            findings: review.findings.length,
          });
        } catch (e) {
          if (e instanceof ArchitectureFileError || e instanceof RepositoryFileTooLargeError) fail(message(e));
          else throw e;
        }
      }
    }
    reviews.sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : a.reviewedAt > b.reviewedAt ? -1 : 0));
    return { repository: repo.name, branch: head.branch, sha: head.sha, reviews, refused };
  }

  async review(repository: string | undefined, branch: string, slug: string): Promise<ReviewDetail> {
    if (!isValidBranchName(branch)) throw new ArchitectureBadRequestError('invalid branch name');
    if (!isValidSlug(slug)) throw new ArchitectureBadRequestError('invalid review name');
    const repo = this.resolve(repository);
    const file = planFile(slug);
    const text = await this.files.read(repo.name, branch, file, MAX_FILE_BYTES);
    if (text === null) throw new ArchitectureNotFoundError(`no review ${slug} on ${branch}`);
    const model = await this.readModel(repo.name, branch);
    const review = parsePlanReview(file, text, model);
    const sha = (await this.files.branches(repo.name)).find((b) => b.name === branch)?.sha ?? '';
    return {
      repository: repo.name, branch, sha, slug, model, review, pageBase: pageBase(repo.url, branch),
    };
  }

  private resolve(repository?: string) {
    const list = this.repositories.list();
    const repo = repository === undefined ? list.find((r) => r.default) ?? list[0] : list.find((r) => r.name === repository);
    if (!repo) throw new ArchitectureNotFoundError(repository === undefined ? 'no repository configured' : `unknown repository ${repository}`);
    return repo;
  }

  private async readModel(repository: string, branch: string): Promise<Model> {
    const text = await this.files.read(repository, branch, MODEL_FILE, MAX_FILE_BYTES);
    if (text === null) throw new ArchitectureNotFoundError(`no ${MODEL_FILE} on ${branch}`);
    return parseModel(MODEL_FILE, text);
  }

  private async planFiles(repository: string, branch: string): Promise<{ path: string; id: string }[]> {
    const found = await this.files.list(repository, branch, PLANS_DIR);
    return found.filter((f) => f.path.startsWith(`${PLANS_DIR}/`) && f.path.endsWith('.json') && !f.path.slice(PLANS_DIR.length + 1).includes('/'));
  }
}
