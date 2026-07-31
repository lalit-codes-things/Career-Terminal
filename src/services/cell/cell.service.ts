import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { DEFAULT_REGION } from '../placement/placement.types';
import { computeShardKey } from '../placement/placement.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

type CellRecord = {
  id: string;
  region: string;
  residencyPolicyId: string | null;
  status: 'ACTIVE' | 'DRAINING' | 'READ_ONLY' | 'MIGRATING' | 'DISABLED';
  lifecycleState: 'PROVISIONING' | 'ACTIVE' | 'DRAINING' | 'MIGRATING' | 'DISABLED';
  routingState: 'ROUTABLE' | 'WRITE_BLOCKED' | 'READ_ONLY' | 'UNROUTABLE';
};

export type CellResolution = {
  cellId: string;
  region: string;
  residencyPolicyId: string | null;
  status: CellRecord['status'];
  lifecycleState: CellRecord['lifecycleState'];
  routingState: CellRecord['routingState'];
};

export class CellService {
  constructor(private readonly db: DbClient = prisma) {}

  getDeterministicCellId(userId: string, region: string = DEFAULT_REGION): string {
    const shardKey = computeShardKey(userId);
    return `${region}-shard-${String(shardKey).padStart(3, '0')}`;
  }

  async getOrCreateCell(cellId: string, region: string): Promise<CellRecord> {
    const existing = await this.db.cell.findUnique({ where: { id: cellId } });
    if (existing) return existing;

    return this.db.cell.create({
      data: {
        id: cellId,
        region,
        status: 'ACTIVE',
        lifecycleState: 'ACTIVE',
        routingState: 'ROUTABLE',
      },
    });
  }

  async resolveUserHomeCell(
    userId: string,
    region: string = DEFAULT_REGION,
  ): Promise<CellResolution> {
    const cellId = this.getDeterministicCellId(userId, region);
    const cell = await this.getOrCreateCell(cellId, region);
    return {
      cellId: cell.id,
      region: cell.region,
      residencyPolicyId: cell.residencyPolicyId ?? null,
      status: cell.status,
      lifecycleState: cell.lifecycleState,
      routingState: cell.routingState,
    };
  }

  async ensureRoutable(cellId: string): Promise<void> {
    const cell = await this.db.cell.findUnique({ where: { id: cellId } });
    if (!cell) {
      throw new Error(`Cell not found: ${cellId}`);
    }
    if (cell.status !== 'ACTIVE' || cell.routingState !== 'ROUTABLE') {
      throw new Error(`Cell is not routable: ${cellId}`);
    }
  }
}

export const cellService = new CellService();
