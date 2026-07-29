import { ResumeUploadService } from '../services/resume/resume-upload.service';
import { storageService } from '../services/storage/storage.service';
import type { IStorageService, UploadResult } from '../services/storage/storage.service';
import { prisma } from '../config/database';
import { queueService } from '../services/queue/queue.service';
import { userService } from '../services/user';
import { ValidationError } from '../errors/app-errors';

jest.mock('../config/database', () => ({
  prisma: {
    resumeHash: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userResume: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    applicationResume: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    event: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/storage/storage.service', () => {
  const mockStorage: jest.Mocked<IStorageService> = {
    upload: jest.fn(),
    uploadToBucket: jest.fn(),
    getPresignedUrl: jest.fn(),
    exists: jest.fn(),
    download: jest.fn(),
    delete: jest.fn(),
    copyToBucket: jest.fn(),
  };
  return {
    storageService: mockStorage,
    IStorageService: jest.requireActual('../services/storage/storage.service').IStorageService,
  };
});

jest.mock('../services/queue/queue.service', () => ({
  queueService: {
    addMalwareScanJob: jest.fn(),
    addResumeParsingJob: jest.fn(),
  },
}));

jest.mock('../services/user', () => ({
  userService: {
    userScopeFor: jest.fn(),
  },
}));

jest.mock('../services/action.service', () => ({
  actionService: {
    recordAction: jest.fn(),
  },
  ACTION_TYPES: {
    RESUME_UPDATE: 'RESUME_UPDATE',
  },
  SOURCE_TYPES: {
    SYSTEM_TRACKED: 'SYSTEM_TRACKED',
  },
  buildResumeVersionTag: jest.fn((version: number) => `resume_version:${version}`),
}));

type MockPrisma = {
  resumeHash: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  userResume: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
applicationResume: {
     findFirst: jest.Mock;
     findUnique: jest.Mock;
     upsert: jest.Mock;
   };
};

type MockStorage = jest.Mocked<IStorageService>;

const USER_ID = 'user-00000000-0000-0000-0000-000000000001';
const LEGACY_USER_ID = 'legacy-user-1';
const RESUME_HASH_ID = 'rhash-00000000-0000-0000-0000-000000000001';
const RESUME_HASH_V2_ID = 'rhash-00000000-0000-0000-0000-000000000002';
const USER_RESUME_V1_ID = 'ur-00000000-0000-0000-0000-000000000001';
const USER_RESUME_V2_ID = 'ur-00000000-0000-0000-0000-000000000002';
const APPLICATION_ID = 'app-00000000-0000-0000-0000-000000000001';
const SHA256_V1 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256_V2 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856';
const STORAGE_KEY_V1 = `uploads/resumes/${SHA256_V1}.pdf`;
const STORAGE_KEY_V2 = `uploads/resumes/${SHA256_V2}.pdf`;
const PRESIGNED_URL_V1 = `https://s3.example.com/${STORAGE_KEY_V1}?sig=1`;

const SAMPLE_PDF_BUFFER = Buffer.from('%PDF-1.4 mock pdf content');
const SAMPLE_FILENAME = 'John-Doe-Resume.pdf';
const SAMPLE_MIME = 'application/pdf';
const SAMPLE_FILE_SIZE = SAMPLE_PDF_BUFFER.length;

const mockPrisma = prisma as unknown as MockPrisma;

let mockStorage: MockStorage;
let mockQueue: jest.Mocked<typeof queueService>;
let mockUserSvc: jest.Mocked<typeof userService>;
let service: ResumeUploadService;

function uploadResult(key: string, url: string): UploadResult {
  return { storageKey: key, presignedUrl: url };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockStorage = storageService as MockStorage;
  mockQueue = queueService as jest.Mocked<typeof queueService>;
  mockUserSvc = userService as jest.Mocked<typeof userService>;

  mockUserSvc.userScopeFor.mockResolvedValue({
    userId: USER_ID,
    legacyUserId: LEGACY_USER_ID,
    resolvedUserId: USER_ID,
  });

  service = new ResumeUploadService(mockStorage);
});

describe('ResumeUploadService — file validation', () => {
  it('rejects unsupported MIME types', async () => {
    await expect(
      service.upload({
        userId: USER_ID,
        fileBuffer: SAMPLE_PDF_BUFFER,
        originalFilename: SAMPLE_FILENAME,
        mimeType: 'application/zip',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects empty buffers', async () => {
    await expect(
      service.upload({
        userId: USER_ID,
        fileBuffer: Buffer.alloc(0),
        originalFilename: SAMPLE_FILENAME,
        mimeType: SAMPLE_MIME,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects oversized files', async () => {
    const hugeBuffer = Buffer.alloc(11 * 1024 * 1024, '%');
    await expect(
      service.upload({
        userId: USER_ID,
        fileBuffer: hugeBuffer,
        originalFilename: SAMPLE_FILENAME,
        mimeType: SAMPLE_MIME,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects unsupported extensions', async () => {
    await expect(
      service.upload({
        userId: USER_ID,
        fileBuffer: SAMPLE_PDF_BUFFER,
        originalFilename: 'resume.exe',
        mimeType: SAMPLE_MIME,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('ResumeUploadService — versioning on upload', () => {
  beforeEach(() => {
    mockStorage.upload.mockResolvedValue(uploadResult(STORAGE_KEY_V1, PRESIGNED_URL_V1));
    mockStorage.getPresignedUrl.mockResolvedValue(PRESIGNED_URL_V1);
    mockQueue.addResumeParsingJob.mockResolvedValue(undefined as never);
    mockPrisma.userResume.updateMany.mockResolvedValue({ count: 0 });
  });

  it('assigns version=1 to the first upload for a user with no prior resumes', async () => {
    mockPrisma.resumeHash.findUnique.mockResolvedValue(null);
    mockPrisma.userResume.findFirst.mockResolvedValue(null);
    mockPrisma.resumeHash.create.mockResolvedValue({
      id: RESUME_HASH_ID,
      hash: SHA256_V1,
      storageKey: STORAGE_KEY_V1,
      storageUrl: STORAGE_KEY_V1,
      mimeType: SAMPLE_MIME,
      sizeBytes: SAMPLE_FILE_SIZE,
      createdAt: new Date(),
    });
    mockPrisma.userResume.create.mockResolvedValue({
      id: USER_RESUME_V1_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_ID,
      isActive: true,
      version: 1,
      supersededAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.upload({
      userId: USER_ID,
      fileBuffer: SAMPLE_PDF_BUFFER,
      originalFilename: SAMPLE_FILENAME,
      mimeType: SAMPLE_MIME,
    });

    expect(result.version).toBe(1);
    expect(result.deduplicated).toBe(false);
    expect(mockPrisma.userResume.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(mockPrisma.userResume.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, isActive: true }),
      }),
    );
    expect(mockQueue.addMalwareScanJob).toHaveBeenCalledTimes(1);
  });

  it('assigns version=2 on second upload and marks previous active as superseded', async () => {
    mockPrisma.resumeHash.findUnique.mockResolvedValue(null);
    mockPrisma.userResume.findFirst.mockResolvedValue({ version: 1 });
    mockPrisma.userResume.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.resumeHash.create.mockResolvedValue({
      id: RESUME_HASH_V2_ID,
      hash: SHA256_V2,
      storageKey: STORAGE_KEY_V2,
      storageUrl: STORAGE_KEY_V2,
      mimeType: SAMPLE_MIME,
      sizeBytes: SAMPLE_FILE_SIZE,
      createdAt: new Date(),
    });
    mockPrisma.userResume.create.mockResolvedValue({
      id: USER_RESUME_V2_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_V2_ID,
      isActive: true,
      version: 2,
      supersededAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const v2Buffer = Buffer.from('%PDF-1.4 different content v2');
    const result = await service.upload({
      userId: USER_ID,
      fileBuffer: v2Buffer,
      originalFilename: SAMPLE_FILENAME,
      mimeType: SAMPLE_MIME,
    });

    expect(result.version).toBe(2);
    expect(mockPrisma.userResume.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { version: 'desc' } }),
    );
    expect(mockPrisma.userResume.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        data: expect.objectContaining({ isActive: false, supersededAt: expect.any(Date) }),
      }),
    );
    expect(mockPrisma.userResume.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2, isActive: true }),
      }),
    );
  });

  it('deduplicates when the same blob is uploaded again (still creates a new version row)', async () => {
    mockPrisma.resumeHash.findUnique.mockResolvedValue({
      id: RESUME_HASH_ID,
      hash: SHA256_V1,
      storageKey: STORAGE_KEY_V1,
      storageUrl: STORAGE_KEY_V1,
      mimeType: SAMPLE_MIME,
      sizeBytes: SAMPLE_FILE_SIZE,
      createdAt: new Date(),
    });
    mockPrisma.userResume.findFirst.mockResolvedValue({ version: 1 });
    mockPrisma.userResume.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.userResume.create.mockResolvedValue({
      id: USER_RESUME_V2_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_ID,
      isActive: true,
      version: 2,
      supersededAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.upload({
      userId: USER_ID,
      fileBuffer: SAMPLE_PDF_BUFFER,
      originalFilename: SAMPLE_FILENAME,
      mimeType: SAMPLE_MIME,
    });

    expect(result.deduplicated).toBe(true);
    expect(result.resumeHashId).toBe(RESUME_HASH_ID);
    expect(mockStorage.upload).not.toHaveBeenCalled();
    expect(mockPrisma.resumeHash.create).not.toHaveBeenCalled();
    expect(result.version).toBe(2);
  });
});

describe('ResumeUploadService — getActiveResumeRow / getActiveResume', () => {
  it('returns null when user has no resume', async () => {
    mockPrisma.userResume.findFirst.mockResolvedValue(null);
    expect(await service.getActiveResumeRow(USER_ID)).toBeNull();
    expect(await service.getActiveResume(USER_ID)).toBeNull();
  });

  it('returns the active resume row with hash metadata', async () => {
    const createdAt = new Date('2026-01-01');
    mockPrisma.userResume.findFirst.mockResolvedValue({
      id: USER_RESUME_V1_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_ID,
      isActive: true,
      version: 1,
      supersededAt: null,
      createdAt,
      updatedAt: createdAt,
      resumeHash: {
        id: RESUME_HASH_ID,
        hash: SHA256_V1,
        storageKey: STORAGE_KEY_V1,
        storageUrl: STORAGE_KEY_V1,
        mimeType: SAMPLE_MIME,
        sizeBytes: SAMPLE_FILE_SIZE,
        createdAt: new Date(),
      },
    });
    mockStorage.getPresignedUrl.mockResolvedValue(PRESIGNED_URL_V1);

    const row = await service.getActiveResumeRow(USER_ID);
    expect(row).toEqual({
      userResumeId: USER_RESUME_V1_ID,
      storageKey: STORAGE_KEY_V1,
      originalName: SAMPLE_FILENAME,
      mimeType: SAMPLE_MIME,
      fileSizeBytes: SAMPLE_FILE_SIZE,
      hash: SHA256_V1,
      version: 1,
    });

    const active = await service.getActiveResume(USER_ID);
    expect(active).toEqual({
      userResumeId: USER_RESUME_V1_ID,
      originalName: SAMPLE_FILENAME,
      presignedUrl: PRESIGNED_URL_V1,
      hash: SHA256_V1,
      fileSizeBytes: SAMPLE_FILE_SIZE,
      createdAt,
      version: 1,
    });
  });
});

describe('ResumeUploadService — listVersions', () => {
  it('returns versions with application counts from the aggregate', async () => {
    mockPrisma.userResume.findMany.mockResolvedValue([
      {
        id: USER_RESUME_V1_ID,
        userId: USER_ID,
        legacyUserId: LEGACY_USER_ID,
        originalName: 'v1.pdf',
        resumeHashId: RESUME_HASH_ID,
        isActive: false,
        version: 1,
        supersededAt: new Date('2026-02-01'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-02-01'),
        resumeHash: {
          id: RESUME_HASH_ID,
          hash: SHA256_V1,
          storageKey: STORAGE_KEY_V1,
          storageUrl: STORAGE_KEY_V1,
          mimeType: SAMPLE_MIME,
          sizeBytes: SAMPLE_FILE_SIZE,
          createdAt: new Date(),
        },
        _count: { applicationLinks: 2 },
      },
      {
        id: USER_RESUME_V2_ID,
        userId: USER_ID,
        legacyUserId: LEGACY_USER_ID,
        originalName: 'v2.pdf',
        resumeHashId: RESUME_HASH_V2_ID,
        isActive: true,
        version: 2,
        supersededAt: null,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
        resumeHash: {
          id: RESUME_HASH_V2_ID,
          hash: SHA256_V2,
          storageKey: STORAGE_KEY_V2,
          storageUrl: STORAGE_KEY_V2,
          mimeType: SAMPLE_MIME,
          sizeBytes: SAMPLE_FILE_SIZE,
          createdAt: new Date(),
        },
        _count: { applicationLinks: 0 },
      },
    ]);

    const list = await service.listVersions(USER_ID);
    expect(list).toHaveLength(2);
    const v1 = list[0]!;
    const v2 = list[1]!;
    expect(v1.version).toBe(1);
    expect(v1.applicationCount).toBe(2);
    expect(v1.isActive).toBe(false);
    expect(v2.version).toBe(2);
    expect(v2.applicationCount).toBe(0);
    expect(v2.isActive).toBe(true);
  });
});

describe('ResumeUploadService — application linkage', () => {
  const ACTIVE_ROW = {
    userResumeId: USER_RESUME_V1_ID,
    storageKey: STORAGE_KEY_V1,
    originalName: SAMPLE_FILENAME,
    mimeType: SAMPLE_MIME,
    fileSizeBytes: SAMPLE_FILE_SIZE,
    hash: SHA256_V1,
    version: 1,
  };

  it('linkApplicationResume upserts with snapshot metadata', async () => {
    const appliedAt = new Date('2026-03-01');
    mockPrisma.applicationResume.upsert.mockResolvedValue(undefined);

    await service.linkApplicationResume(APPLICATION_ID, ACTIVE_ROW, {
      appliedAt,
      usageContext: { strategy: 'generic' },
    });

    expect(mockPrisma.applicationResume.upsert).toHaveBeenCalledWith({
      where: { applicationId_resumeVersionId: { applicationId: APPLICATION_ID, resumeVersionId: USER_RESUME_V1_ID } },
      create: expect.objectContaining({
        applicationId: APPLICATION_ID,
        resumeVersionId: USER_RESUME_V1_ID,
        snapshotKey: STORAGE_KEY_V1,
        appliedAt,
        snapshotMetadata: expect.objectContaining({
          originalName: SAMPLE_FILENAME,
          mimeType: SAMPLE_MIME,
          sizeBytes: SAMPLE_FILE_SIZE,
          sha256: SHA256_V1,
          version: 1,
        }),
        usageContext: { strategy: 'generic' },
      }),
      update: {},
    });
  });

  it('linkApplicationResume is idempotent — second call updates nothing', async () => {
    const appliedAt = new Date('2026-03-01');
    mockPrisma.applicationResume.upsert.mockResolvedValue(undefined);

    await service.linkApplicationResume(APPLICATION_ID, ACTIVE_ROW, { appliedAt });
    await service.linkApplicationResume(APPLICATION_ID, ACTIVE_ROW, { appliedAt });

    expect(mockPrisma.applicationResume.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.applicationResume.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ update: {} }),
    );
  });

  it('getApplicationResume returns null when no link exists', async () => {
    mockPrisma.applicationResume.findFirst.mockResolvedValue(null);
    expect(await service.getApplicationResume(APPLICATION_ID)).toBeNull();
  });

  it('getApplicationResume returns the snapshot metadata when linked', async () => {
    const appliedAt = new Date('2026-03-01');
    mockPrisma.applicationResume.findFirst.mockResolvedValue({
      id: 'ar-1',
      applicationId: APPLICATION_ID,
      resumeVersionId: USER_RESUME_V1_ID,
      snapshotKey: STORAGE_KEY_V1,
      snapshotMetadata: {
        originalName: SAMPLE_FILENAME,
        version: 1,
      },
      appliedAt,
      usageContext: { strategy: 'generic' },
      createdAt: new Date(),
      resumeVersion: {
        id: USER_RESUME_V1_ID,
        version: 1,
        originalName: SAMPLE_FILENAME,
        resumeHash: {
          sizeBytes: SAMPLE_FILE_SIZE,
          storageKey: STORAGE_KEY_V1,
        },
      },
    });

    const result = await service.getApplicationResume(APPLICATION_ID);
    expect(result).toEqual({
      userResumeId: USER_RESUME_V1_ID,
      version: 1,
      originalName: SAMPLE_FILENAME,
      snapshotKey: STORAGE_KEY_V1,
      appliedAt,
      usageContext: { strategy: 'generic' },
      fileSizeBytes: SAMPLE_FILE_SIZE,
    });
  });
});

describe('ResumeUploadService — deleteVersion (guarded against linkage)', () => {
  it('deletes the version when no applications reference it', async () => {
    mockPrisma.userResume.findFirst.mockResolvedValue({
      id: USER_RESUME_V1_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_ID,
      isActive: false,
      version: 1,
      supersededAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { applicationLinks: 0 },
    });
    mockPrisma.userResume.delete.mockResolvedValue(undefined);

    await service.deleteVersion(USER_ID, USER_RESUME_V1_ID);
    expect(mockPrisma.userResume.delete).toHaveBeenCalledWith({
      where: { id: USER_RESUME_V1_ID },
    });
  });

  it('is idempotent — returns without error when the version does not exist', async () => {
    mockPrisma.userResume.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteVersion(USER_ID, 'non-existent-id'),
    ).resolves.not.toThrow();
    expect(mockPrisma.userResume.delete).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the version is linked to ≥ 1 applications', async () => {
    mockPrisma.userResume.findFirst.mockResolvedValue({
      id: USER_RESUME_V1_ID,
      userId: USER_ID,
      legacyUserId: LEGACY_USER_ID,
      originalName: SAMPLE_FILENAME,
      resumeHashId: RESUME_HASH_ID,
      isActive: false,
      version: 1,
      supersededAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { applicationLinks: 3 },
    });

    await expect(
      service.deleteVersion(USER_ID, USER_RESUME_V1_ID),
    ).rejects.toThrow(ValidationError);

    await expect(
      service.deleteVersion(USER_ID, USER_RESUME_V1_ID),
    ).rejects.toThrow(/it is linked to 3 application\(s\)/);

    expect(mockPrisma.userResume.delete).not.toHaveBeenCalled();
  });

  it('scopes delete to the owning user — findFirst includes the ownership filter', async () => {
    const OTHER_USER = 'other-user-0000-0000-0000-000000000002';
    mockPrisma.userResume.findFirst.mockResolvedValue(null);

    await service.deleteVersion(OTHER_USER, USER_RESUME_V1_ID);

    const firstCall = mockPrisma.userResume.findFirst.mock.calls[0];
    expect(firstCall).toBeDefined();
    const args = firstCall?.[0];
    expect(args).toBeDefined();
    expect(args?.where?.id).toBe(USER_RESUME_V1_ID);
    expect(args?.where?.OR).toBeDefined();
    expect(mockPrisma.userResume.delete).not.toHaveBeenCalled();
  });
});
