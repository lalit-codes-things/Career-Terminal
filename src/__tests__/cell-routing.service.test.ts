jest.mock('../services/placement/placement.service', () => ({
  placementService: {
    resolvePlacementContext: jest.fn(async (userId: string) => ({
      region: 'us-east-1',
      cellId: `us-east-1-shard-${userId.endsWith('0') ? '000' : '001'}`,
      dataResidencyRegion: 'us-east-1',
      shardKey: 0,
      tenantId: null,
      stale: false,
    })),
  },
}));

jest.mock('../services/cell/cell.service', () => ({
  cellService: {
    resolveUserHomeCell: jest.fn(async (_userId: string, region: string) => ({
      cellId: `${region}-shard-000`,
      region,
      residencyPolicyId: null,
      status: 'ACTIVE',
      lifecycleState: 'ACTIVE',
      routingState: 'ROUTABLE',
    })),
    ensureRoutable: jest.fn(async () => undefined),
  },
}));

import { CellRoutingService } from '../services/routing/cell-routing.service';

describe('CellRoutingService', () => {
  it('resolves the same home cell for the same user', async () => {
    const service = new CellRoutingService();

    const first = await service.resolveUserRouting('123e4567-e89b-12d3-a456-426614174000');
    const second = await service.resolveUserRouting('123e4567-e89b-12d3-a456-426614174000');

    expect(first.cellId).toBe(second.cellId);
    expect(first.region).toBe(second.region);
  });

  it('rejects cross-cell access', async () => {
    const service = new CellRoutingService();

    await expect(
      service.ensureCellMatchesUser(
        '123e4567-e89b-12d3-a456-426614174000',
        'eu-west-1-shard-999',
      ),
    ).rejects.toThrow('Cross-cell access denied');
  });
});
