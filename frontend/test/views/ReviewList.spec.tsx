import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReviewList } from '../../src/views/ReviewList';
import { giftCards, moveCatalog, summaryOf } from '../fixtures/architecture';

const MOVE_BRANCH = 'agentic/T-20261024-ab12-move-catalog';

function setup(over: Partial<React.ComponentProps<typeof ReviewList>> = {}) {
  const props = {
    reviews: [
      summaryOf(giftCards(), 'main', '2026-10-20-gift-cards'),
      summaryOf(moveCatalog(), MOVE_BRANCH, '2026-10-22-move-catalog'),
    ],
    refused: [],
    selected: null,
    knownTaskIds: [] as string[],
    onSelect: jest.fn(),
    onOpenTask: jest.fn(),
    ...over,
  };
  render(<ReviewList {...props} />);
  return props;
}

describe('ReviewList', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T08:40:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('lists each review with title, branch, age, touched count and open findings', () => {
    setup();
    const gift = screen.getByTestId('review-main/2026-10-20-gift-cards');
    expect(gift).toHaveTextContent('Gift cards at checkout');
    expect(gift).toHaveTextContent('main');
    expect(gift).toHaveTextContent('1 d ago');
    expect(gift).toHaveTextContent('4 components');
    expect(gift).toHaveTextContent('1 open finding');
    const move = screen.getByTestId(`review-${MOVE_BRANCH}/2026-10-22-move-catalog`);
    expect(move).toHaveTextContent('Serve the catalog from a headless CMS');
    expect(move).toHaveTextContent(MOVE_BRANCH);
    expect(move).toHaveTextContent('3 components');
    expect(move).toHaveTextContent('no open findings');
  });

  it('selecting a review calls onSelect with branch and slug; the selected one is marked', () => {
    const props = setup({ selected: { branch: 'main', slug: '2026-10-20-gift-cards' } });
    expect(screen.getByRole('button', { name: /Gift cards at checkout/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Serve the catalog/ })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: /Serve the catalog/ }));
    expect(props.onSelect).toHaveBeenCalledWith(MOVE_BRANCH, '2026-10-22-move-catalog');
  });

  it('no task link when the task is not known', () => {
    setup({ knownTaskIds: ['T-20261024-zz99'] });
    expect(screen.queryByRole('button', { name: 'T-20261024-ab12' })).not.toBeInTheDocument();
  });

  it('a task link for an agentic branch whose task is known, opening the task', () => {
    const props = setup({ knownTaskIds: ['T-20261024-ab12'] });
    const link = screen.getByRole('button', { name: 'T-20261024-ab12' });
    fireEvent.click(link);
    expect(props.onOpenTask).toHaveBeenCalledWith('T-20261024-ab12');
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /^T-/ })).toHaveLength(1);
  });

  it('lists refused files with their error', () => {
    setup({
      refused: [{ branch: 'feature/x', slug: 'broken', file: 'docs/architecture/reviews/plans/broken.json', error: 'size: must be S, M or L' }],
    });
    const refused = screen.getByRole('list', { name: 'Refused review files' });
    expect(refused).toHaveTextContent('feature/x');
    expect(refused).toHaveTextContent('docs/architecture/reviews/plans/broken.json');
    expect(refused).toHaveTextContent('size: must be S, M or L');
  });

  it('says so when there are no reviews', () => {
    setup({ reviews: [] });
    expect(screen.getByText(/no plan reviews/i)).toBeInTheDocument();
    expect(within(document.body).queryByRole('list', { name: 'Refused review files' })).not.toBeInTheDocument();
  });
});
