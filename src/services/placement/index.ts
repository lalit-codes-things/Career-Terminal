export * from './placement.types';
export {
  PlacementService,
  placementService,
  computeShardKey,
  resolveRegionFromHints,
  type RegionResolutionHints,
} from './placement.service';
export { computeShardKey as computeShardKeyAlias } from './placement.service';
