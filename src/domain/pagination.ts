export interface PaginationInput {
  readonly page?: number;
  readonly pageSize?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface PaginationWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly skip: number;
  readonly take: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function resolvePagination(input?: PaginationInput): PaginationWindow {
  if (!input) {
    return {
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    };
  }

  const hasPaginationInput =
    input.page !== undefined ||
    input.pageSize !== undefined ||
    input.limit !== undefined ||
    input.offset !== undefined;

  if (!hasPaginationInput) {
    return {
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    };
  }

  const pageSizeCandidate = input.pageSize ?? input.limit;
  const pageSize = clampPositiveInteger(pageSizeCandidate, MAX_PAGE_SIZE);
  const page = clampPositiveInteger(input.page, Number.MAX_SAFE_INTEGER);
  const offset = clampNonNegativeInteger(input.offset);

  const effectivePageSize = pageSize ?? DEFAULT_PAGE_SIZE;
  const effectiveOffset = offset ?? ((page ?? 1) - 1) * effectivePageSize;

  return {
    page: page ?? Math.floor(effectiveOffset / effectivePageSize) + 1,
    pageSize: effectivePageSize,
    skip: effectiveOffset,
    take: effectivePageSize,
  };
}

function clampPositiveInteger(value: number | undefined, max: number): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const integer = Math.floor(value);
  if (integer <= 0) {
    return null;
  }

  return Math.min(integer, max);
}

function clampNonNegativeInteger(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const integer = Math.floor(value);
  if (integer < 0) {
    return null;
  }

  return integer;
}
