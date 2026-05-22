import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

  sanitizeOriginalName(originalName: string): string {
    const baseName = originalName.split(/[\\/]/).pop() ?? '';
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

  async assertFileConversationAccess(userId: string, fileId: string): Promise<void> {
    const file = await this.prisma.fileAsset.findFirst({
      where: {
        id: fileId,
        deletedAt: null,
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
