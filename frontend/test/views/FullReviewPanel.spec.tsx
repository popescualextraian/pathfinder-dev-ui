import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FullReviewPanel } from '../../src/views/FullReviewPanel';
import { fixtureModel, fullReview } from '../fixtures/architecture';

describe('FullReviewPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T09:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('shows commit, age, open and accepted findings with clickable components', () => {
    const onSelect = jest.fn();
    render(<FullReviewPanel review={fullReview()} error={null} model={fixtureModel()} onSelect={onSelect} />);
    const panel = screen.getByRole('region', { name: 'Full review' });
    expect(panel).toHaveTextContent('a1b2c3d');
    expect(panel).toHaveTextContent('3 d ago');
    const open = within(panel).getByRole('list', { name: 'Open findings' });
    expect(open).toHaveTextContent('Price rounding is implemented');
    const accepted = within(panel).getByRole('list', { name: 'Accepted exceptions' });
    expect(accepted).toHaveTextContent('The orders API reads the order store directly');
    expect(panel).not.toHaveTextContent('The catalog service kept its own cache');
    expect(panel).toHaveTextContent('1 fixed');
    fireEvent.click(within(open).getByRole('button', { name: 'Order service' }));
    expect(onSelect).toHaveBeenCalledWith('order-service');
  });

  it('a finding for an unknown component shows its id, not a button', () => {
    const review = fullReview();
    review.findings[0].component = 'ghost';
    render(<FullReviewPanel review={review} error={null} model={fixtureModel()} onSelect={jest.fn()} />);
    const open = screen.getByRole('list', { name: 'Open findings' });
    expect(open).toHaveTextContent('ghost');
    expect(within(open).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the error when the review could not be read', () => {
    render(<FullReviewPanel review={null} error="reviews/full.json: findings: must be a list" model={fixtureModel()} onSelect={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('reviews/full.json: findings: must be a list');
  });

  it('says when there is no full review yet', () => {
    render(<FullReviewPanel review={null} error={null} model={fixtureModel()} onSelect={jest.fn()} />);
    expect(screen.getByText(/no full review yet/i)).toBeInTheDocument();
  });
});
