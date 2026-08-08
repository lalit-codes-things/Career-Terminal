import path from 'path';
import { ValidationError } from '../errors/app-errors';

/**
 * Validates that a file path resolves within a trusted base directory.
 *
 * Prevents path traversal by resolving the candidate path against `baseDir`
 * and asserting the result starts with the resolved base plus a path
 * separator. Only the basename of `filePath` is used, so any directory
 * components supplied by a client are discarded.
 *
 * @param filePath - The raw file path to validate (typically `req.file.path`).
 * @param baseDir - The trusted directory the file must reside within.
 * @returns The resolved, safe absolute path.
 * @throws {ValidationError} If the resolved path escapes `baseDir`.
 */
export function validateUploadedFilePath(filePath: string, baseDir: string): string {
  const resolvedBase = path.resolve(baseDir);
  const safeBasename = path.basename(filePath);
  const resolvedPath = path.resolve(resolvedBase, safeBasename);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    throw new ValidationError('Invalid file path');
  }

  return resolvedPath;
}
