import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

function toLatin1Mojibake(value: string): string {
  return Buffer.from(value, 'utf8').toString('latin1');
}

describe('FilesService', () => {
  it('sanitizes original names and removes path traversal segments', () => {
    const service = createService(createMockPrisma());

    expect(service.sanitizeOriginalName('..\\..\\report?.pdf')).toBe('report_.pdf');
    expect(service.sanitizeOriginalName('../')).toBe('file');
    expect(service.sanitizeOriginalName('  photo   one.jpg  ')).toBe('photo one.jpg');
  });

  it('recovers UTF-8 Chinese names decoded by multipart as latin1', () => {
    const service = createService(createMockPrisma());

    expect(service.normalizeUploadedOriginalName(toLatin1Mojibake('测试文档.docx'))).toBe(
      '测试文档.docx',
    );
    expect(service.normalizeUploadedOriginalName(toLatin1Mojibake('图片文件.png'))).toBe(
      '图片文件.png',
    );
    expect(service.sanitizeOriginalName(`..\\${toLatin1Mojibake('图片文件.png')}`)).toBe(
      '图片文件.png',
    );
  });

  it('keeps normal English and already-correct Chinese names unchanged', () => {
    const service = createService(createMockPrisma());

    expect(service.normalizeUploadedOriginalName('report.docx')).toBe('report.docx');
    expect(service.sanitizeOriginalName('测试文档.docx')).toBe('测试文档.docx');
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

  it('creates metadata with recovered Chinese original names', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.create.mockResolvedValue({
      ...(fileAssetFixture() as Record<string, unknown>),
      originalName: '测试文档.docx',
      safeName: 'file-id.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const service = createService(prisma);

    const result = await service.createUploadedFileAsset({
      uploaderId: 'user-a',
      conversationId: 'conversation-id',
      kind: FileKind.FILE,
      originalName: toLatin1Mojibake('测试文档.docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    });
    const createArgs = prisma.fileAsset.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };

    expect(createArgs.data.originalName).toBe('测试文档.docx');
    expect(createArgs.data.safeName).toEqual(expect.stringMatching(/\.docx$/));
    expect(createArgs.select).not.toHaveProperty('storagePath');
    expect(result.originalName).toBe('测试文档.docx');
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

  it('opens downloadable files only after conversation access is confirmed', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'langram-download-test-'));
    const storageDir = join(tempDir, 'storage');
    const storedFile = join(storageDir, '2026', '05', '22', 'file-id.pdf');
    await mkdir(join(storageDir, '2026', '05', '22'), { recursive: true });
    await writeFile(storedFile, 'download-content');
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      conversationId: 'conversation-id',
      originalName: '测试文件.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(16),
      storagePath: '2026/05/22/file-id.pdf',
    });
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    const service = createService(prisma, storageDir);

    const result = await service.getDownloadFile('user-a', 'file-id');

    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'file-id',
          deletedAt: null,
          status: { not: FileStatus.DELETED },
        }),
        select: expect.objectContaining({
          conversationId: true,
          storagePath: true,
        }),
      }),
    );
    expect(prisma.conversationMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'conversation-id',
            userId: 'user-a',
          },
        },
      }),
    );
    expect(result.originalName).toBe('测试文件.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.sizeBytes).toBe(16);
    expect(result.stream.path).toBe(storedFile);
    result.stream.destroy();

    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects downloads for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      conversationId: 'conversation-id',
      originalName: 'secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(12),
      storagePath: '2026/05/22/secret.pdf',
    });
    prisma.conversationMember.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.getDownloadFile('user-b', 'file-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns a clear error when download metadata is missing or deleted', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.getDownloadFile('user-a', 'file-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects downloads with storage paths outside the storage root', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      conversationId: 'conversation-id',
      originalName: 'secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(12),
      storagePath: '../../secret.pdf',
    });
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    const service = createService(prisma);

    await expect(service.getDownloadFile('user-a', 'file-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns a clear error when downloadable content is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'langram-download-test-'));
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      conversationId: 'conversation-id',
      originalName: 'missing.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(12),
      storagePath: '2026/05/22/missing.pdf',
    });
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    const service = createService(prisma, join(tempDir, 'storage'));

    await expect(service.getDownloadFile('user-a', 'file-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it('clones file metadata for forwarding without exposing storage paths', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      kind: FileKind.FILE,
      originalName: 'report.txt',
      safeName: 'source-file.txt',
      mimeType: 'text/plain',
      sizeBytes: BigInt(12),
      sha256: 'a'.repeat(64),
      width: null,
      height: null,
      storagePath: '2026/05/22/source-file.txt',
    });
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'target-member-id' });
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
    const service = createService(prisma);

    const result = await service.forwardFileAsset({
      userId: 'user-b',
      sourceFileId: 'source-file-id',
      targetConversationId: 'target-conversation-id',
    });
    const findArgs = prisma.fileAsset.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    const createArgs = prisma.fileAsset.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };

    expect(findArgs.where).toMatchObject({
      id: 'source-file-id',
      deletedAt: null,
      status: { in: [FileStatus.UPLOADED, FileStatus.ATTACHED] },
      conversation: {
        members: {
          some: { userId: 'user-b' },
        },
      },
    });
    expect(findArgs.select.storagePath).toBe(true);
    expect(prisma.conversationMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'target-conversation-id',
            userId: 'user-b',
          },
        },
      }),
    );
    expect(createArgs.data).toMatchObject({
      uploaderId: 'user-b',
      conversationId: 'target-conversation-id',
      kind: FileKind.FILE,
      originalName: 'report.txt',
      safeName: 'source-file.txt',
      mimeType: 'text/plain',
      sizeBytes: BigInt(12),
      sha256: 'a'.repeat(64),
      storagePath: '2026/05/22/source-file.txt',
      status: FileStatus.UPLOADED,
    });
    expect(createArgs.select).not.toHaveProperty('storagePath');
    expect(result).not.toHaveProperty('storagePath');
    expect(result).toMatchObject({
      uploaderId: 'user-b',
      conversationId: 'target-conversation-id',
      kind: FileKind.FILE,
      originalName: 'report.txt',
      status: FileStatus.UPLOADED,
    });
  });

  it('rejects forwarding when the source file is not accessible', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.forwardFileAsset({
        userId: 'user-c',
        sourceFileId: 'source-file-id',
        targetConversationId: 'target-conversation-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('rejects forwarding when the target conversation is not accessible', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue({
      kind: FileKind.IMAGE,
      originalName: 'photo.jpg',
      safeName: 'source-file.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(12),
      sha256: 'a'.repeat(64),
      width: 640,
      height: 480,
      storagePath: '2026/05/22/source-file.jpg',
    });
    prisma.conversationMember.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.forwardFileAsset({
        userId: 'user-b',
        sourceFileId: 'source-file-id',
        targetConversationId: 'target-conversation-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('rejects forwarding deleted files', async () => {
    const prisma = createMockPrisma();
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.forwardFileAsset({
        userId: 'user-b',
        sourceFileId: 'deleted-file-id',
        targetConversationId: 'target-conversation-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: { in: [FileStatus.UPLOADED, FileStatus.ATTACHED] },
        }),
      }),
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

  it('saves uploaded file metadata with recovered Chinese original names', async () => {
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
      kind: FileKind.IMAGE,
      file: {
        path: tempFile,
        originalname: toLatin1Mojibake('图片文件.png'),
        mimetype: 'image/png',
        size: 12,
      },
    });
    const createArgs = prisma.fileAsset.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
      select: Record<string, boolean>;
    };

    expect(createArgs.data.originalName).toBe('图片文件.png');
    expect(createArgs.data.safeName).toEqual(expect.stringMatching(/\.png$/));
    expect(createArgs.select).not.toHaveProperty('storagePath');
    expect(result.originalName).toBe('图片文件.png');

    await rm(tempDir, { recursive: true, force: true });
  });
});
