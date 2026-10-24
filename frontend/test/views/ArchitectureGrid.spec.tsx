import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArchitectureGrid } from '../../src/views/ArchitectureGrid';
import { fixtureModel, fullReview, giftCards, moveCatalog, onePartModel } from '../fixtures/architecture';

const chip = (id: string) => screen.getByTestId(`chip-${id}`);

describe('ArchitectureGrid', () => {
  it('draws block, column and layer headings from the model', () => {
    render(<ArchitectureGrid model={fixtureModel()} selectedId={null} onSelect={jest.fn()} />);
    const frontend = screen.getByRole('region', { name: 'Frontend' });
    const backend = screen.getByRole('region', { name: 'Backend' });
    expect(within(frontend).getByRole('heading', { name: 'Frontend' })).toBeInTheDocument();
    expect(within(backend).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Orders', 'Catalog']);
    expect(within(backend).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'API',
      'Service',
      'Integration',
      'Repository',
      'Commons',
    ]);
    expect(within(frontend).getByRole('button', { name: 'Order views' })).toBeInTheDocument();
    expect(chip('config')).toHaveAttribute('data-spanning', 'true');
    expect(chip('order-service')).toHaveAttribute('data-spanning', 'false');
    expect(chip('order-service')).toHaveAttribute('data-state', 'plain');
    expect(screen.queryByLabelText('new component')).not.toBeInTheDocument();
  });

  it('draws a one-part model without modules: one block, no column headings', () => {
    render(<ArchitectureGrid model={onePartModel()} selectedId={null} onSelect={jest.fn()} />);
    const app = screen.getByRole('region', { name: 'App' });
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(within(app).queryAllByRole('columnheader')).toHaveLength(0);
    expect(within(app).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['UI', 'Logic', 'Data']);
    expect(within(app).getByRole('button', { name: 'Screens' })).toBeInTheDocument();
    expect(within(app).getByRole('button', { name: 'Storage' })).toBeInTheDocument();
  });

  it('marks the gift-cards overlay with signs, dims the rest', () => {
    render(<ArchitectureGrid model={fixtureModel()} changes={giftCards().changes} selectedId={null} onSelect={jest.fn()} />);
    const neu = chip('gift-card-service');
    expect(neu).toHaveAttribute('data-state', 'new');
    expect(within(neu).getByLabelText('new component')).toHaveTextContent('+');
    expect(neu).toHaveTextContent('Gift card service');
    expect(within(chip('order-service')).getByLabelText('changed component')).toHaveTextContent('~');
    expect(chip('catalog-service')).toHaveAttribute('data-state', 'dim');
  });

  it('strikes the removed component through', () => {
    render(<ArchitectureGrid model={fixtureModel()} changes={moveCatalog().changes} selectedId={null} onSelect={jest.fn()} />);
    const removed = chip('catalog-store');
    expect(removed).toHaveAttribute('data-state', 'removed');
    expect(within(removed).getByLabelText('removed component')).toHaveTextContent('−');
    expect(removed.querySelector('s')).toHaveTextContent('Catalog store');
    expect(chip('cms-client')).toHaveAttribute('data-state', 'new');
  });

  it('shows finding badges: open count, accepted tick, nothing for fixed', () => {
    render(<ArchitectureGrid model={fixtureModel()} findings={fullReview().findings} selectedId={null} onSelect={jest.fn()} />);
    expect(within(chip('order-service')).getByLabelText('1 open finding')).toHaveTextContent('1');
    expect(within(chip('orders-api')).getByLabelText('accepted exception')).toHaveTextContent('✓');
    expect(within(chip('catalog-service')).queryByRole('img')).not.toBeInTheDocument();
  });

  it('pluralises the open count', () => {
    const findings = [
      { component: 'order-service', status: 'open' as const },
      { component: 'order-service', status: 'open' as const },
      { component: 'nowhere', status: 'open' as const },
    ];
    render(<ArchitectureGrid model={fixtureModel()} findings={findings} selectedId={null} onSelect={jest.fn()} />);
    expect(within(chip('order-service')).getByLabelText('2 open findings')).toHaveTextContent('2');
  });

  it('clicking a chip selects it; clicking the selected one clears', () => {
    const onSelect = jest.fn();
    const { rerender } = render(<ArchitectureGrid model={fixtureModel()} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(chip('order-service'));
    expect(onSelect).toHaveBeenLastCalledWith('order-service');
    rerender(<ArchitectureGrid model={fixtureModel()} selectedId="order-service" onSelect={onSelect} />);
    expect(chip('order-service')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip('order-service'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('the selected component lights up its connections in both directions', () => {
    render(<ArchitectureGrid model={fixtureModel()} selectedId="order-service" onSelect={jest.fn()} />);
    for (const id of ['orders-api', 'payment-gateway', 'order-store', 'catalog-service']) {
      expect(chip(id)).toHaveAttribute('data-linked', 'true');
    }
    for (const id of ['order-service', 'order-views', 'catalog-store', 'config']) {
      expect(chip(id)).toHaveAttribute('data-linked', 'false');
    }
  });

  it('a proposed component lights up what it talks to', () => {
    render(
      <ArchitectureGrid model={fixtureModel()} changes={giftCards().changes} selectedId="gift-card-service" onSelect={jest.fn()} />,
    );
    expect(chip('order-store')).toHaveAttribute('data-linked', 'true');
    expect(chip('order-service')).toHaveAttribute('data-linked', 'false');
  });
});
