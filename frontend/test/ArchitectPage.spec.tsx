import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArchitectPage } from '../src/ArchitectPage';
import * as api from '../src/api/architecture-api';
import { ApiError } from '../src/api/http';
import type { CurrentArchitecture, Repository, ReviewDetail, ReviewList } from '../src/api/models';
import { fixtureModel, fullReview, giftCards, moveCatalog, onePartModel, summaryOf } from './fixtures/architecture';

jest.mock('../src/api/architecture-api');
const m = (f: unknown) => f as jest.Mock;

const SHA = '0123456789abcdef0123456789abcdef01234567';
const repositories: Repository[] = [
  { name: 'acme-shop', url: '/srv/acme-shop.git', default: true },
  { name: 'plain', url: '/srv/plain.git', default: false },
];

function current(repository: string): CurrentArchitecture {
  return repository === 'plain'
    ? { repository, branch: 'main', sha: SHA, model: onePartModel(), fullReview: null, fullReviewError: null, pageBase: null }
    : { repository, branch: 'main', sha: SHA, model: fixtureModel(), fullReview: fullReview(), fullReviewError: null, pageBase: null };
}

function reviews(repository: string): ReviewList {
  return {
    repository,
    branch: 'main',
    sha: SHA,
    reviews:
      repository === 'plain'
        ? []
        : [
            summaryOf(moveCatalog(), 'agentic/T-20261024-ab12-move-catalog', '2026-10-22-move-catalog'),
            summaryOf(giftCards(), 'feature/gift-cards', '2026-10-20-gift-cards'),
          ],
    refused: [],
  };
}

function detail(branch: string, slug: string): ReviewDetail {
  return {
    repository: 'acme-shop', branch, sha: SHA, slug, model: fixtureModel(),
    review: slug === '2026-10-20-gift-cards' ? giftCards() : moveCatalog(), pageBase: null,
  };
}

const handlers = () => ({
  onSelectRepository: jest.fn(),
  onSelectReview: jest.fn(),
  onOpenTask: jest.fn(),
});

beforeEach(() => {
  jest.resetAllMocks();
  m(api.getArchitecture).mockImplementation((r?: string | null) => Promise.resolve(current(r ?? 'acme-shop')));
  m(api.listReviews).mockImplementation((r?: string | null) => Promise.resolve(reviews(r ?? 'acme-shop')));
  m(api.getReview).mockImplementation((_r: string | null, b: string, s: string) => Promise.resolve(detail(b, s)));
});

describe('ArchitectPage', () => {
  it('draws acme-shop: both parts, style pill, doc pill, both tabs and the full review', async () => {
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByRole('region', { name: 'Frontend' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Backend' })).toBeInTheDocument();
    expect(screen.getByText('Modular monolith, layered')).toBeInTheDocument();
    expect(screen.getByText('doc on main @ 0123456')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Current architecture' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('tab', { name: 'Plan reviews (2)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Full review' })).toBeInTheDocument();
    expect(screen.getByText(/Source: docs\/architecture\/.* on main/)).toBeInTheDocument();
    expect(api.getArchitecture).toHaveBeenCalledWith(null);
  });

  it('opens the component panel on a click of a component', async () => {
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...handlers()} />);
    fireEvent.click(await screen.findByTestId('chip-order-service'));
    const panel = screen.getByRole('complementary', { name: 'Order service' });
    expect(within(panel).getByText(/Owns orders/)).toBeInTheDocument();
  });

  it('draws plain (one part, no modules) as one block without module headings', async () => {
    render(<ArchitectPage repositories={repositories} repository="plain" review={null} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByRole('region', { name: 'App' })).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(api.getArchitecture).toHaveBeenCalledWith('plain');
  });

  it('shows the empty state when the repository has no architecture doc', async () => {
    m(api.getArchitecture).mockRejectedValue(new ApiError(404, 'no docs/architecture/model.json on main'));
    render(<ArchitectPage repositories={repositories} repository="plain" review={null} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByText(/No architecture doc on the default branch of plain/)).toBeInTheDocument();
    expect(screen.getByText('/architect seed')).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    m(api.getArchitecture).mockRejectedValue(new ApiError(502, 'could not read repository acme-shop'));
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not read repository acme-shop');
  });

  it('shows the full review error as a notice while the picture stays', async () => {
    m(api.getArchitecture).mockResolvedValue({ ...current('acme-shop'), fullReview: null, fullReviewError: 'docs/architecture/reviews/full.json: bad' });
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('full.json: bad');
    expect(screen.getByRole('region', { name: 'Backend' })).toBeInTheDocument();
  });

  it('lists the plan reviews on its tab and selecting one calls onSelectReview', async () => {
    const h = handlers();
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...h} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Plan reviews (2)' }));
    expect(screen.getByText(/Select a plan review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gift cards at checkout/ }));
    expect(h.onSelectReview).toHaveBeenCalledWith({ branch: 'feature/gift-cards', slug: '2026-10-20-gift-cards' });
  });

  it('with a review in the route shows the reviews tab, the overlay and the impact panel', async () => {
    const review = { branch: 'feature/gift-cards', slug: '2026-10-20-gift-cards' };
    render(<ArchitectPage repositories={repositories} repository="acme-shop" review={review} knownTaskIds={[]} {...handlers()} />);
    expect(await screen.findByRole('region', { name: 'Gift cards at checkout' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan reviews (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('chip-gift-card-service')).toHaveAttribute('data-state', 'new');
    expect(screen.getByTestId('chip-order-service')).toHaveAttribute('data-state', 'changed');
    expect(api.getReview).toHaveBeenCalledWith('acme-shop', 'feature/gift-cards', '2026-10-20-gift-cards');
    expect(screen.getByText(/Source: docs\/architecture\/reviews\/plans\/2026-10-20-gift-cards.json on feature\/gift-cards/)).toBeInTheDocument();
  });

  it('back to the current tab clears the review', async () => {
    const h = handlers();
    const review = { branch: 'feature/gift-cards', slug: '2026-10-20-gift-cards' };
    render(<ArchitectPage repositories={repositories} repository="acme-shop" review={review} knownTaskIds={[]} {...h} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Current architecture' }));
    expect(h.onSelectReview).toHaveBeenCalledWith(null);
  });

  it('another repository opens on its current architecture', async () => {
    const h = handlers();
    const view = render(<ArchitectPage repositories={repositories} repository="acme-shop" review={null} knownTaskIds={[]} {...h} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Plan reviews (2)' }));
    view.rerender(<ArchitectPage repositories={repositories} repository="plain" review={null} knownTaskIds={[]} {...h} />);
    expect(screen.getByRole('tab', { name: 'Current architecture' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: 'App' })).toBeInTheDocument();
  });

  it('switching the repository calls onSelectRepository', async () => {
    const h = handlers();
    render(<ArchitectPage repositories={repositories} repository={null} review={null} knownTaskIds={[]} {...h} />);
    const select = screen.getByRole('combobox', { name: 'Repository' });
    expect(select).toHaveValue('acme-shop');
    fireEvent.change(select, { target: { value: 'plain' } });
    expect(h.onSelectRepository).toHaveBeenCalledWith('plain');
  });
});
