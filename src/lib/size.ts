/**
 * Parses a human-readable byte size string into a number of bytes.
 *
 * Supports common suffixes: b, kb, mb, gb, tb (case-insensitive).
 * Plain numbers are treated as bytes.
 *
 * @example
 * parseSizeToBytes('10mb')  // 10485760
 * parseSizeToBytes('1mb')   // 1048576
 * parseSizeToBytes('500kb') // 512000
 * parseSizeToBytes('100')   // 100
 * parseSizeToBytes('2gb')   // 2147483648
 */
const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
};

export function parseSizeToBytes(size: string | number): number {
  if (typeof size === 'number') {
    return Math.floor(size);
  }

  const trimmed = size.trim().toLowerCase();

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/);
  if (!match) {
    throw new Error(`Invalid size format: '${size}'. Expected formats: '10mb', '500kb', '100'`);
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;
  const multiplier = SIZE_UNITS[unit]!;

  return Math.floor(value * multiplier);
}
