jest.mock('../services/routing/cell-routing.service', () => ({
  cellRoutingService: {
    ensureCellMatchesUser: jest.fn().mockResolvedValue(undefined),
  },
}));

import { ownershipGuard } from '../services/ownership/ownership.guard';
import { cellRoutingService } from '../services/routing/cell-routing.service';

describe('OwnershipGuard cell checks', () => {
  it('delegates cell ownership validation to the routing layer', async () => {
    await expect(
      ownershipGuard.ensureCellAccess(
        '123e4567-e89b-12d3-a456-426614174000',
        'us-east-1-shard-000',
      ),
    ).resolves.toBeUndefined();

    expect(cellRoutingService.ensureCellMatchesUser).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      'us-east-1-shard-000',
    );
  });
});
