/**
 * Identifier normalization re-exports.
 *
 * The canonical identifier catalogue and per-type validation live in
 * `identifiers/identifier-types.ts`; this module re-exports them under the
 * normalization namespace so providers and importers have one import surface.
 */

export {
  IDENTIFIER_TYPES,
  isKnownIdentifierType,
  isValidIdentifierValue,
  normalizeIdentifierValue,
} from '../identifiers';
