import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ImpactPanel } from '../../src/views/ImpactPanel';
import { fixtureModel, giftCards, moveCatalog } from '../fixtures/architecture';

describe('ImpactPanel', () => {
  it('lists the changes with sign and name, the proposed place, size and summary', () => {
    const onSelect = jest.fn();
    render(<ImpactPanel review={giftCards()} model={fixtureModel()} selectedId="order-service" onSelect={onSelect} />);
    const panel = screen.getByRole('region', { name: 'Gift cards at checkout' });
    expect(panel).toHaveTextContent('Size M');
    expect(panel).toHaveTextContent('Adds a gift card service and a gift card field at checkout');
    const changes = within(panel).getByRole('list', { name: 'Changes' });
    const rows = within(changes).getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('data-component'))).toEqual(['gift-card-service', 'order-service', 'orders-api', 'order-views']);
    expect(within(rows[0]).getByLabelText('new component')).toHaveTextContent('+');
    expect(rows[0]).toHaveTextContent('Gift card service');
    expect(rows[0]).toHaveTextContent('Service · Orders');
    expect(within(rows[1]).getByLabelText('changed component')).toHaveTextContent('~');
    expect(rows[1]).toHaveTextContent('Order service');
    expect(rows[1]).toHaveTextContent('Checkout subtracts a redeemed gift card before the payment step.');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    fireEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith('gift-card-service');
  });

  it('shows the rule check: findings with text and alternative, passed rules ticked', () => {
    render(<ImpactPanel review={giftCards()} model={fixtureModel()} selectedId={null} onSelect={jest.fn()} />);
    const check = screen.getByRole('list', { name: 'Rule check' });
    const items = within(check).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('⚠');
    expect(items[0]).toHaveTextContent('layers');
    expect(items[0]).toHaveTextContent('The plan has the checkout view call the orders client directly');
    expect(items[0]).toHaveTextContent('Add a redeem action to order state and call it from the view.');
    expect(items[1]).toHaveTextContent('✓');
    expect(items[1]).toHaveTextContent('dry');
    expect(items[2]).toHaveTextContent('boundaries');
  });

  it('a removed component with its sign', () => {
    render(<ImpactPanel review={moveCatalog()} model={fixtureModel()} selectedId={null} onSelect={jest.fn()} />);
    const row = screen.getAllByRole('button').find((b) => b.getAttribute('data-component') === 'catalog-store')!;
    expect(within(row).getByLabelText('removed component')).toHaveTextContent('−');
    expect(row).toHaveTextContent('Catalog store');
    expect(screen.getByRole('list', { name: 'Rule check' })).not.toHaveTextContent('⚠');
    expect(screen.getByText('Size S', { exact: false })).toBeInTheDocument();
  });
});
