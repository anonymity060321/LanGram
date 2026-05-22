import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileKind, FileStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from './files.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  conversationMember: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  fileAsset: {
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    findUniqueOrThrow: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    conversationMember: {
      findUnique: jest.fn(),
    },
    fileAsset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

function createService(prisma: MockPrisma, storageDir = join(tmpdir(), 'langram-test-files')): FilesService {
  const configService = {
    get: jest.fn((key: string) => (key === 'FILE_STORAGE_DIR' ? storageDir : undefined)),
  };

  return new FilesService(
    prisma as unknown as PrismaService,
    configService as unknown as ConfigService,
  );
}

function fileAssetFixture(): unknown {
  return {
    id: 'file-id',
    uploaderId: 'user-a',
    conversationId: 'conversation-id',
    messageId: null,
    kind: FileKind.IMAGE,
    originalName: 'photo.jpg',
    safeName: 'file-id.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: BigInt(1024),
    sha256: 'a'.repeat(64),
    width: 800,
    height: 600,
    status: FileStatus.UPLOADED,
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    deletedAt: null,
  };
}

describe('FilesService', () => {
  it('sanitizes original names and removes path traversal segments', () => {
    const service = createService(createMockPrisma());

    expect(service.sanitizeOriginalName('..\\..\\report?.pdf')).toBe('report_.pdf');
    expect(service.sanitizeOriginalName('../')).toBe('file');
    expect(service.sanitizeOriginalName('  photo   one.jpg  ')).toBe('photo one.jpg');
  });

  it('rejects files larger than 200MB or invalid sizes', () => {
    const service = createService(createMockPrisma());

    expect(() => service.validateFileSize(200 * 1024 * 1024)).not.toThrow();
    expect(() => service.validateFileSize(200 * 1024 * 1024 + 1)).toThrow(BadRequestException);
    expect(() => service.validateFileSize(0)).toThrow(BadRequestException);
  });

  it('validates image and file MIME types separately', () => {
    const service = createService(createMockPrisma());

    expect(() => service.validateMimeType(FileKind.IMAGE, 'image/jpeg')).not.toThrow();
    expect(() => service.validateMimeType(FileKind.FILE, 'application/pdf')).not.toThrow();
    expect(() => service.validateMimeType(FileKind.IMAGE, 'application/pdf')).toThrow(
      BadRequestException,
    );
    expect(() => service.validateMimeType(FileKind.FILE, 'application/x-msdownload')).toThrow(
      BadRequestException,
    );
  });

  it('builds storage paths from generated file ids instead of original names', () => {
    const service = createService(createMockPrisma());
    const storagePath = service.buildStoragePath('file-id', '../../secret.exe');

    expect(storagePath).toMatch(/^\d{4}\/\d{2}\/\d{2}\/file-id\.exe$/);
    expect(storagePath).not.toContain('secret');
    expect(storagePath).not.toContain('..');
    expect(storagePath).not.toContain('\\');
  });

  it('creates uploaded file metadata without returning storage paths', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.create.mockResolvedValue(fileAssetFixture());
    const service = createService(prisma);

    const result = await service.createUploadedFileAsset({
      uploaderId: 'user-a',
      conversationId: 'conversation-id',
      kind: FileKind.IMAGE,
      originalName: '../photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      width: 800,
      height: 600,
    });
    const createArgs = prisma.fileAsset.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };

    expect(createArgs.data).toMatchObject({
      uploaderId: 'user-a',
      conversationId: 'conversation-id',
      kind: FileKind.IMAGE,
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(1024),
      status: FileStatus.UPLOADED,
    });
    expect(createArgs.data.storagePath).toEqual(expect.stringMatching(/\/.+\.jpg$/));
    expect(createArgs.select).not.toHaveProperty('storagePath');
    expect(result).not.toHaveProperty('storagePath');
    expect(result.sizeBytes).toBe('1024');
  });

  it('checks conversation membership before allowing file metadata access', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'file-id' });
    const service = createService(prisma);

    await expect(service.assertFileConversationAccess('user-a', 'file-id')).resolves.toBeUndefined();
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'file-id',
          conversation: {
            members: {
              some: { userId: 'user-a' },
            },
          },
        }),
      }),
    );
  });

  it('rejects metadata access for non-members or missing files', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.assertFileConversationAccess('user-b', 'file-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects upload from non-conversation members', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'langram-upload-test-'));
    const tempFile = join(tempDir, 'upload.tmp');
    await writeFile(tempFile, 'file-content');
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue(null);
    const service = createService(prisma, join(tempDir, 'storage'));

    await expect(
      service.saveUploadedFile({
        userId: 'user-b',
        conversationId: 'conversation-id',
        kind: FileKind.FILE,
        file: {
          path: tempFile,
          originalname: 'report.pdf',
          mimetype: 'application/pdf',
          size: 12,
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();

    await rm(tempDir, { recursive: true, force: true });
  });

  it('saves uploaded files to local storage and creates metadata without exposing paths', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'langram-upload-test-'));
    const tempFile = join(tempDir, 'upload.tmp');
    await writeFile(tempFile, 'file-content');
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.fileAsset.create.mockImplementation(async (args: unknown) => {
      const createArgs = args as {
        data: {
          id: string;
          uploaderId: string;
          conversationId: string;
          kind: FileKind;
          originalName: string;
          safeName: string;
          mimeType: string;
          sizeBytes: bigint;
          sha256: string;
          width: number | null;
          height: number | null;
          status: FileStatus;
        };
      };

      return {
        ...createArgs.data,
        messageId: null,
        createdAt: new Date('2026-05-22T00:00:00.000Z'),
        updatedAt: new Date('2026-05-22T00:00:00.000Z'),
        deletedAt: null,
      };
    });
    const service = createService(prisma, join(tempDir, 'storage'));

    const result = await service.saveUploadedFile({
      userId: 'user-a',
      conversationId: 'conversation-id',
      kind: FileKind.FILE,
      file: {
        path: tempFile,
        originalname: '..\\secret?.pdf',
        mimetype: 'application/pdf',
        size: 12,
      },
    });
    const createArgs = prisma.fileAsset.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };

    expect(createArgs.data).toMatchObject({
      uploaderId: 'user-a',
      conversationId: 'conversation-id',
      kind: FileKind.FILE,
      originalName: 'secret_.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(12),
      status: FileStatus.UPLOADED,
    });
    expect(createArgs.data.sha256).toBe(
      '2239ce4df9ee8db012834642ec801b55ba2c92b28bdd11f4d73d9c55d39f3b0a',
    );
    expect(createArgs.select).not.toHaveProperty('storagePath');
    expect(result).not.toHaveProperty('storagePath');
    expect(result.originalName).toBe('secret_.pdf');

    await rm(tempDir, { recursive: true, force: true });
  });
});
