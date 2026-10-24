import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GridComponent } from '../../src/views/architecture-layout';
import { buildGrid } from '../../src/views/architecture-layout';
import { ComponentPanel } from '../../src/views/ComponentPanel';
import { fixtureModel, fullReview, giftCards, onePartModel } from '../fixtures/architecture';
import type { Model, PlanReview } from '../../src/api/models';

function component(model: Model, id: string, changes?: PlanReview['changes']): GridComponent | undefined {
  return buildGrid(model, changes)
    .flatMap((b) => b.rows.flatMap((r) => [...r.cells.flat(), ...r.spanning]))
    .find((c) => c.id === id);
}

describe('ComponentPanel', () => {
  it('shows summary, place, talks to and used by, findings and the page link', () => {
    const model = fixtureModel();
    const onSelect = jest.fn();
    render(
      <ComponentPanel
        component={component(model, 'order-service')}
        model={model}
        findings={fullReview().findings}
        pageBase="https://git.example/acme/blob/main/docs/architecture/"
        onSelect={onSelect}
      />,
    );
    const panel = screen.getByRole('complementary', { name: 'Order service' });
    expect(within(panel).getByRole('heading', { name: 'Order service' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('Owns orders: pricing, checkout, the payment step.');
    expect(panel).toHaveTextContent('Orders · Service · Backend');
    const talksTo = within(panel).getByRole('list', { name: 'Talks to' });
    expect(within(talksTo).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Payment gateway',
      'Order store',
      'Catalog service',
    ]);
    const usedBy = within(panel).getByRole('list', { name: 'Used by' });
    expect(within(usedBy).getAllByRole('button').map((b) => b.textContent)).toEqual(['Orders API']);
    fireEvent.click(within(usedBy).getByRole('button', { name: 'Orders API' }));
    expect(onSelect).toHaveBeenCalledWith('orders-api');
    expect(panel).toHaveTextContent('Price rounding is implemented in the order service and again in the catalog service.');
    expect(panel).not.toHaveTextContent('The orders API reads the order store directly');
    expect(within(panel).getByRole('link', { name: /page/i })).toHaveAttribute(
      'href',
      'https://git.example/acme/blob/main/docs/architecture/components/order-service.md',
    );
    expect(panel).not.toHaveTextContent('In this plan');
  });

  it('without a page base there is no link; no module means no module in the place line', () => {
    const model = onePartModel();
    render(<ComponentPanel component={component(model, 'rules')} model={model} findings={[]} pageBase={null} onSelect={jest.fn()} />);
    const panel = screen.getByRole('complementary', { name: 'Rules' });
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Logic · App');
    expect(panel).toHaveTextContent('No findings');
  });

  it('a proposed component: its talks_to, the plan line with its sign', () => {
    const model = fixtureModel();
    const changes = giftCards().changes;
    render(
      <ComponentPanel
        component={component(model, 'gift-card-service', changes)}
        model={model}
        change={changes[0]}
        findings={[]}
        pageBase="https://git.example/"
        onSelect={jest.fn()}
      />,
    );
    const panel = screen.getByRole('complementary', { name: 'Gift card service' });
    expect(panel).toHaveTextContent('Orders · Service · Backend');
    const talksTo = within(panel).getByRole('list', { name: 'Talks to' });
    expect(within(talksTo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Order store']);
    expect(panel).toHaveTextContent('In this plan');
    expect(within(panel).getByLabelText('new component')).toHaveTextContent('+');
    expect(panel).toHaveTextContent('Issues and redeems gift cards; called by the order service at checkout.');
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument();
  });

  it('plan findings show their alternative', () => {
    const model = fixtureModel();
    const review = giftCards();
    render(
      <ComponentPanel
        component={component(model, 'order-views', review.changes)}
        model={model}
        change={review.changes[3]}
        findings={review.findings}
        pageBase={null}
        onSelect={jest.fn()}
      />,
    );
    const panel = screen.getByRole('complementary', { name: 'Order views' });
    expect(panel).toHaveTextContent('The plan has the checkout view call the orders client directly');
    expect(panel).toHaveTextContent('Add a redeem action to order state and call it from the view.');
    expect(within(panel).getByLabelText('changed component')).toHaveTextContent('~');
  });

  it('renders nothing useful without a component: a hint', () => {
    render(<ComponentPanel component={undefined} model={fixtureModel()} findings={[]} pageBase={null} onSelect={jest.fn()} />);
    expect(screen.getByText(/select a component/i)).toBeInTheDocument();
  });
});
