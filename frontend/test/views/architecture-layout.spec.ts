import { buildGrid, type GridBlock, type GridComponent } from '../../src/views/architecture-layout';
import { fixtureModel, giftCards, moveCatalog, onePartModel } from '../fixtures/architecture';

function all(blocks: GridBlock[]): GridComponent[] {
  return blocks.flatMap((b) => b.rows.flatMap((r) => [...r.cells.flat(), ...r.spanning]));
}

function find(blocks: GridBlock[], id: string): GridComponent | undefined {
  return all(blocks).find((c) => c.id === id);
}

describe('buildGrid', () => {
  it('draws the fixture model: one block per part, module columns, layer rows, module-less components spanning', () => {
    const blocks = buildGrid(fixtureModel());
    expect(blocks.map((b) => b.part)).toEqual([
      { id: 'frontend', name: 'Frontend' },
      { id: 'backend', name: 'Backend' },
    ]);
    for (const b of blocks) {
      expect(b.columns).toEqual([
        { id: 'orders', name: 'Orders' },
        { id: 'catalog', name: 'Catalog' },
      ]);
    }
    const backend = blocks[1];
    expect(backend.rows.map((r) => r.layer.id)).toEqual(['api', 'service', 'integration', 'repository', 'commons']);
    const commons = backend.rows[4];
    expect(commons.spanning.map((c) => c.id)).toEqual(['config', 'validation']);
    expect(commons.cells).toEqual([[], []]);
    const integration = backend.rows[2];
    expect(integration.cells.map((cell) => cell.map((c) => c.id))).toEqual([['payment-gateway'], []]);
    expect(backend.rows[1].cells[0].map((c) => c.id)).toEqual(['order-service']);
    expect(all(blocks).every((c) => c.state === 'plain')).toBe(true);
    expect(find(blocks, 'order-service')).toEqual({
      id: 'order-service',
      name: 'Order service',
      summary: 'Owns orders: pricing, checkout, the payment step.',
      part: 'backend',
      layer: 'service',
      module: 'orders',
      page: 'components/order-service.md',
      state: 'plain',
    });
  });

  it('a part without modules has one column with id null and no spanning row', () => {
    const blocks = buildGrid(onePartModel());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].columns).toEqual([{ id: null, name: '' }]);
    expect(blocks[0].rows[0].cells[0].map((c) => c.id)).toEqual(['screens', 'forms']);
    expect(blocks[0].rows.every((r) => r.spanning.length === 0)).toBe(true);
  });

  it('a component with a module in a part without modules still lands in the one column', () => {
    const model = onePartModel();
    model.components[2].module = 'stray';
    const blocks = buildGrid(model);
    expect(blocks[0].rows[1].cells[0].map((c) => c.id)).toEqual(['rules']);
  });

  it('gift-cards overlay: the proposed component is new in its cell, changed ones changed, the rest dim', () => {
    const blocks = buildGrid(fixtureModel(), giftCards().changes);
    const service = blocks[1].rows[1];
    expect(service.cells[0].map((c) => [c.id, c.state])).toEqual([
      ['order-service', 'changed'],
      ['gift-card-service', 'new'],
    ]);
    expect(find(blocks, 'gift-card-service')).toMatchObject({
      name: 'Gift card service',
      summary: 'Owns gift cards: balance, redeem, expiry.',
      part: 'backend',
      layer: 'service',
      module: 'orders',
      page: '',
    });
    expect(find(blocks, 'orders-api')?.state).toBe('changed');
    expect(find(blocks, 'order-views')?.state).toBe('changed');
    const touched = new Set(['gift-card-service', 'order-service', 'orders-api', 'order-views']);
    expect(all(blocks).filter((c) => !touched.has(c.id)).every((c) => c.state === 'dim')).toBe(true);
  });

  it('move-catalog overlay: a new component alone in its cell, the removed store marked removed', () => {
    const blocks = buildGrid(fixtureModel(), moveCatalog().changes);
    expect(find(blocks, 'catalog-store')?.state).toBe('removed');
    expect(blocks[1].rows[2].cells[1].map((c) => [c.id, c.state])).toEqual([['cms-client', 'new']]);
    expect(find(blocks, 'catalog-service')?.state).toBe('changed');
  });

  it('an empty changes overlay still dims everything', () => {
    expect(all(buildGrid(fixtureModel(), [])).every((c) => c.state === 'dim')).toBe(true);
  });
});
