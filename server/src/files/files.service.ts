import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileKind, FileStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileMetadataResponse } from './dto/file-metadata.dto';

export interface CreateUploadedFileAssetInput {
  uploaderId: string;
  conversationId: string;
  kind: FileKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
}

export interface UploadedDiskFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface SaveUploadedFileInput {
  userId: string;
  conversationId: string;
  kind: FileKind;
  file: UploadedDiskFile;
  width?: number | null;
  height?: number | null;
}

export interface DownloadFileResult {
  stream: ReadStream;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ForwardFileAssetInput {
  userId: string;
  sourceFileId: string;
  targetConversationId: string;
}

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_ORIGINAL_NAME_LENGTH = 180;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  sanitizeOriginalName(originalName: string): string {
    const normalizedName = this.normalizeUploadedOriginalName(originalName);
    const baseName = normalizedName.split(/[\\/]/).pop() ?? '';
    const cleaned = baseName
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const safeName = cleaned.slice(0, MAX_ORIGINAL_NAME_LENGTH).trim();

    if (!safeName || safeName === '.' || safeName === '..') {
      return 'file';
    }

    return safeName;
  }

  normalizeUploadedOriginalName(originalName: string): string {
    const recovered = Buffer.from(originalName, 'latin1').toString('utf8');
    if (!this.isRecoveredOriginalNameReasonable(originalName, recovered)) {
      return originalName;
    }

    return recovered;
  }

  validateFileSize(sizeBytes: number): void {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException('File size must be a positive integer');
    }

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 200MB limit');
    }
  }

  validateMimeType(kind: FileKind, mimeType: string): void {
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (!normalizedMimeType) {
      throw new BadRequestException('MIME type is required');
    }

    if (kind === FileKind.IMAGE && !IMAGE_MIME_TYPES.has(normalizedMimeType)) {
      throw new BadRequestException('Unsupported image MIME type');
    }

    if (kind === FileKind.FILE && !FILE_MIME_TYPES.has(normalizedMimeType)) {
      throw new BadRequestException('Unsupported file MIME type');
    }
  }

  buildStoragePath(fileId: string, originalName: string): string {
    const safeName = this.sanitizeOriginalName(originalName);
    const extension = this.extractSafeExtension(safeName);
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const safeFileName = `${fileId}${extension}`;

    return [year, month, day, safeFileName].join('/');
  }

  async createUploadedFileAsset(input: CreateUploadedFileAssetInput): Promise<FileMetadataResponse> {
    this.validateFileSize(input.sizeBytes);
    this.validateMimeType(input.kind, input.mimeType);
    this.validateSha256(input.sha256);

    const id = randomUUID();
    const originalName = this.sanitizeOriginalName(input.originalName);
    const storagePath = this.buildStoragePath(id, originalName);
    const safeName = storagePath.split('/').at(-1) ?? id;

    const file = await this.prisma.fileAsset.create({
      data: {
        id,
        uploaderId: input.uploaderId,
        conversationId: input.conversationId,
        kind: input.kind,
        originalName,
        safeName,
        mimeType: input.mimeType.trim().toLowerCase(),
        sizeBytes: BigInt(input.sizeBytes),
        sha256: input.sha256.toLowerCase(),
        storagePath,
        width: input.width ?? null,
        height: input.height ?? null,
        status: FileStatus.UPLOADED,
      },
      select: this.fileMetadataSelect(),
    });

    return this.toFileMetadataResponse(file);
  }

  async saveUploadedFile(input: SaveUploadedFileInput): Promise<FileMetadataResponse> {
    let finalPath: string | null = null;
    let tempPath: string | null = input.file.path;

    try {
      await this.assertConversationMember(input.userId, input.conversationId);
      this.validateFileSize(input.file.size);
      this.validateMimeType(input.kind, input.file.mimetype);

      const id = randomUUID();
      const originalName = this.sanitizeOriginalName(input.file.originalname);
      const storagePath = this.buildStoragePath(id, originalName);
      const safeName = storagePath.split('/').at(-1) ?? id;
      finalPath = this.toAbsoluteStoragePath(storagePath);
      await mkdir(dirname(finalPath), { recursive: true });
      const sha256 = await this.calculateSha256(input.file.path);
      await this.moveFile(input.file.path, finalPath);
      tempPath = null;

      const file = await this.createFileAssetRecord({
        id,
        uploaderId: input.userId,
        conversationId: input.conversationId,
        kind: input.kind,
        originalName,
        safeName,
        mimeType: input.file.mimetype.trim().toLowerCase(),
        sizeBytes: input.file.size,
        sha256,
        storagePath,
        width: input.width ?? null,
        height: input.height ?? null,
      });

      return file;
    } catch (error) {
      if (tempPath) {
        await this.removeFileIfExists(tempPath);
      }
      if (finalPath) {
        await this.removeFileIfExists(finalPath);
      }

      throw error;
    }
  }

  async assertFileConversationAccess(userId: string, fileId: string): Promise<void> {
    const file = await this.prisma.fileAsset.findFirst({
      where: {
        id: fileId,
        deletedAt: null,
        status: { not: FileStatus.DELETED },
        conversation: {
          members: {
            some: { userId },
          },
        },
      },
      select: { id: true },
    });

    if (!file) {
      throw new ForbiddenException('File is not accessible');
    }
  }

  async getFileMetadata(userId: string, fileId: string): Promise<FileMetadataResponse> {
    await this.assertFileConversationAccess(userId, fileId);
    const file = await this.prisma.fileAsset.findUniqueOrThrow({
      where: { id: fileId },
      select: this.fileMetadataSelect(),
    });

    return this.toFileMetadataResponse(file);
  }

  async getDownloadFile(userId: string, fileId: string): Promise<DownloadFileResult> {
    const file = await this.prisma.fileAsset.findFirst({
      where: {
        id: fileId,
        deletedAt: null,
        status: { not: FileStatus.DELETED },
      },
      select: {
        conversationId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        storagePath: true,
      },
    });

    if (!file) {
      throw new NotFoundException('File is not available');
    }

    await this.assertConversationMember(userId, file.conversationId);

    const absolutePath = this.toAbsoluteStoragePath(file.storagePath);
    let fileStat: { isFile: () => boolean; size: number };
    try {
      fileStat = await stat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('File content is missing');
      }

      throw error;
    }

    if (!fileStat.isFile()) {
      throw new NotFoundException('File content is missing');
    }

    return {
      stream: createReadStream(absolutePath),
      originalName: file.originalName,
      mimeType: this.toSafeDownloadMimeType(file.mimeType),
      sizeBytes: fileStat.size,
    };
  }

  async forwardFileAsset(input: ForwardFileAssetInput): Promise<FileMetadataResponse> {
    const sourceFile = await this.prisma.fileAsset.findFirst({
      where: {
        id: input.sourceFileId,
        deletedAt: null,
        status: { in: [FileStatus.UPLOADED, FileStatus.ATTACHED] },
        conversation: {
          members: {
            some: { userId: input.userId },
          },
        },
      },
      select: {
        kind: true,
        originalName: true,
        safeName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        width: true,
        height: true,
        storagePath: true,
      },
    });

    if (!sourceFile) {
      throw new ForbiddenException('File is not accessible');
    }

    await this.assertConversationMember(input.userId, input.targetConversationId);

    const clonedFile = await this.prisma.fileAsset.create({
      data: {
        id: randomUUID(),
        uploaderId: input.userId,
        conversationId: input.targetConversationId,
        kind: sourceFile.kind,
        originalName: sourceFile.originalName,
        safeName: sourceFile.safeName,
        mimeType: sourceFile.mimeType,
        sizeBytes: sourceFile.sizeBytes,
        sha256: sourceFile.sha256,
        storagePath: sourceFile.storagePath,
        width: sourceFile.width,
        height: sourceFile.height,
        status: FileStatus.UPLOADED,
      },
      select: this.fileMetadataSelect(),
    });

    return this.toFileMetadataResponse(clonedFile);
  }

  private async assertConversationMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      select: { id: true },
    });

    if (!member) {
      throw new ForbiddenException('Conversation is not accessible');
    }
  }

  private async createFileAssetRecord(input: {
    id: string;
    uploaderId: string;
    conversationId: string;
    kind: FileKind;
    originalName: string;
    safeName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
    width?: number | null;
    height?: number | null;
  }): Promise<FileMetadataResponse> {
    const file = await this.prisma.fileAsset.create({
      data: {
        id: input.id,
        uploaderId: input.uploaderId,
        conversationId: input.conversationId,
        kind: input.kind,
        originalName: input.originalName,
        safeName: input.safeName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        sha256: input.sha256.toLowerCase(),
        storagePath: input.storagePath,
        width: input.width ?? null,
        height: input.height ?? null,
        status: FileStatus.UPLOADED,
      },
      select: this.fileMetadataSelect(),
    });

    return this.toFileMetadataResponse(file);
  }

  private getStorageRoot(): string {
    return resolve(this.configService.get<string>('FILE_STORAGE_DIR') ?? join(process.cwd(), 'storage', 'files'));
  }

  private toAbsoluteStoragePath(storagePath: string): string {
    const storageRoot = this.getStorageRoot();
    const absolutePath = resolve(storageRoot, ...storagePath.split('/'));
    const relativePath = relative(storageRoot, absolutePath);
    if (relativePath.startsWith('..') || resolve(relativePath) === relativePath) {
      throw new BadRequestException('Invalid storage path');
    }

    return absolutePath;
  }

  private toSafeDownloadMimeType(mimeType: string): string {
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(normalizedMimeType)) {
      return normalizedMimeType;
    }

    return 'application/octet-stream';
  }

  private async calculateSha256(path: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  }

  private async moveFile(source: string, destination: string): Promise<void> {
    try {
      await rename(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }

      await pipeline(createReadStream(source), createWriteStream(destination));
      await unlink(source);
    }
  }

  private async removeFileIfExists(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private isRecoveredOriginalNameReasonable(originalName: string, recoveredName: string): boolean {
    if (!recoveredName || recoveredName === originalName || recoveredName.includes('\uFFFD')) {
      return false;
    }

    const originalCjkCount = this.countCjkCharacters(originalName);
    const recoveredCjkCount = this.countCjkCharacters(recoveredName);
    if (recoveredCjkCount > originalCjkCount) {
      return true;
    }

    if (this.hasC1ControlCharacter(originalName) && !this.hasC1ControlCharacter(recoveredName)) {
      return true;
    }

    return this.hasCommonMojibakeMarker(originalName) && !this.hasCommonMojibakeMarker(recoveredName);
  }

  private countCjkCharacters(value: string): number {
    return Array.from(value).filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
        (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff)
      );
    }).length;
  }

  private hasC1ControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x80 && codePoint <= 0x9f;
    });
  }

  private hasCommonMojibakeMarker(value: string): boolean {
    return Array.from(value).some((character) => 'ÃÂãäåæçèéêëìíîïðñòóôõöùúûü'.includes(character));
  }

  private extractSafeExtension(originalName: string): string {
    const index = originalName.lastIndexOf('.');
    if (index <= 0 || index === originalName.length - 1) {
      return '';
    }

    const extension = originalName.slice(index + 1).toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(extension)) {
      return '';
    }

    return `.${extension}`;
  }

  private validateSha256(sha256: string): void {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new BadRequestException('Valid SHA-256 hash is required');
    }
  }

  private fileMetadataSelect() {
    return {
      id: true,
      uploaderId: true,
      conversationId: true,
      messageId: true,
      kind: true,
      originalName: true,
      safeName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      width: true,
      height: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    } as const;
  }

  private toFileMetadataResponse(file: {
    id: string;
    uploaderId: string;
    conversationId: string;
    messageId: string | null;
    kind: FileKind;
    originalName: string;
    safeName: string;
    mimeType: string;
    sizeBytes: bigint;
    sha256: string;
    width: number | null;
    height: number | null;
    status: FileStatus;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): FileMetadataResponse {
    return {
      id: file.id,
      uploaderId: file.uploaderId,
      conversationId: file.conversationId,
      messageId: file.messageId,
      kind: file.kind,
      originalName: file.originalName,
      safeName: file.safeName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      sha256: file.sha256,
      width: file.width,
      height: file.height,
      status: file.status,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      deletedAt: file.deletedAt,
    };
  }
}
