import { ClassificationNode } from './system';

export type ImportFormat = 'csv' | 'json' | 'parquet';
export type ImportSourceType = 'http' | 'api' | 's3' | 'minio';

export interface ImporterConfig {
  format: ImportFormat;
  sourceType: ImportSourceType;
  uri: string;
}

export abstract class ClassificationImporter {
  abstract parse(buffer: Buffer): Promise<ClassificationNode[]>;
}

export class JsonClassificationImporter extends ClassificationImporter {
  async parse(buffer: Buffer): Promise<ClassificationNode[]> {
    const raw = JSON.parse(buffer.toString('utf-8'));
    if (!Array.isArray(raw)) {
      throw new Error('Expected JSON array of classification nodes');
    }
    return raw as ClassificationNode[];
  }
}

export class ImporterFactory {
  public static create(format: ImportFormat): ClassificationImporter {
    switch (format) {
      case 'json':
        return new JsonClassificationImporter();
      case 'csv':
      case 'parquet':
        // Pluggable stubs for CSV and Parquet
        throw new Error(`${format.toUpperCase()} importer not fully implemented yet`);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}
