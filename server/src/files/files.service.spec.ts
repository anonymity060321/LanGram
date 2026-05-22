import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileKind, FileStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from './files.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  fileAsset: {
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    findUniqueOrThrow: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    fileAsset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

function createService(prisma: MockPrisma): FilesService {
  return new FilesService(prisma as unknown as PrismaService);
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
});
