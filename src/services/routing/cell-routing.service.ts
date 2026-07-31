import { placementService, type RegionResolutionHints } from '../placement/placement.service';
import { cellService } from '../cell/cell.service';

export type RoutingDecision = {
  userId: string;
  cellId: string;
  region: string;
  residencyRegion: string;
  routingState: string;
};

export class CellRoutingService {
  async resolveUserRouting(
    userId: string,
    _hints: RegionResolutionHints = {},
  ): Promise<RoutingDecision> {
    const placement = await placementService.resolvePlacementContext(userId);
    const cell = await cellService.resolveUserHomeCell(userId, placement.region);
    return {
      userId,
      cellId: cell.cellId,
      region: placement.region,
      residencyRegion: placement.dataResidencyRegion,
      routingState: cell.routingState,
    };
  }

  async ensureCellMatchesUser(userId: string, cellId: string): Promise<void> {
    const placement = await placementService.resolvePlacementContext(userId);
    if (placement.cellId !== cellId) {
      throw new Error(`Cross-cell access denied for user ${userId}`);
    }
  }
}

export const cellRoutingService = new CellRoutingService();
