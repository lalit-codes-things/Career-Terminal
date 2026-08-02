import { placementMiddleware } from '../middleware/placement';
import { placementService } from '../services/placement/placement.service';
import { Request, Response } from 'express';
import { DataPlaneClient } from '../services/data-plane-client.service';

jest.mock('../services/placement/placement.service', () => ({
  placementService: {
    resolvePlacementContext: jest.fn(),
    resolveRegionFromRequest: jest.fn(),
  },
  computeShardKey: jest.fn(() => 0),
}));

describe('placementMiddleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      headers: {},
      user: undefined,
    };
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should attach placement, region, and dataPlaneClient for authenticated user', async () => {
    const userId = 'user-123';
    req.user = { id: userId };
    const mockContext = {
      region: 'eu-west-1',
      dataResidencyRegion: 'eu-west-1',
      shardKey: 10,
      tenantId: null,
      stale: false,
    };
    (placementService.resolvePlacementContext as jest.Mock).mockResolvedValue(mockContext);

    await placementMiddleware(req as Request, res as Response, next);

    expect(req.placement).toEqual(mockContext);
    expect(req.region).toBe('eu-west-1');
    expect(req.dataPlaneClient).toBeInstanceOf(DataPlaneClient);
    expect(req.dataPlaneClient?.region).toBe('eu-west-1');
    expect(next).toHaveBeenCalled();
  });

  it('should attach anonymous placement for unauthenticated user', async () => {
    (placementService.resolveRegionFromRequest as jest.Mock).mockReturnValue('us-east-1');

    await placementMiddleware(req as Request, res as Response, next);

    expect(req.placement).toBeDefined();
    expect(req.region).toBe('us-east-1');
    expect(req.dataPlaneClient).toBeInstanceOf(DataPlaneClient);
    expect(next).toHaveBeenCalled();
  });

  it('should use fallback on service error', async () => {
    req.user = { id: 'user-123' };
    (placementService.resolvePlacementContext as jest.Mock).mockRejectedValue(new Error('DB Down'));

    await placementMiddleware(req as Request, res as Response, next);

    expect(req.region).toBe('us-east-1'); // DEFAULT_REGION
    expect(req.dataPlaneClient).toBeDefined();
    expect(next).toHaveBeenCalled();
  });
});
