import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicUser {
  id: string;
  email: string | null;
  displayName: string;
  statusMessage: string | null;
  avatarUrl: string | null;
  accountType: string;
  status: string;
  createdAt: Date;
}

export interface UploadedAvatarFile {
  path: string;
  mimetype: string;
  size: number;
}

export interface AvatarFileResult {
  stream: ReadStream;
  mimeType: string;
}

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findPublicById(userId: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        statusMessage: true,
        avatarStoragePath: true,
        accountType: true,
        status: true,
        createdAt: true,
      },
    });

    return user ? this.toPublicUser(user) : null;
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.findPublicById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; statusMessage?: string },
  ): Promise<PublicUser> {
    const displayName = input.displayName?.trim();
    const statusMessage = input.statusMessage?.trim();

    if (input.displayName !== undefined && !displayName) {
      throw new BadRequestException('Display name is required');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(input.statusMessage !== undefined ? { statusMessage: statusMessage || null } : {}),
      },
      select: this.publicUserSelect(),
    });

    return this.toPublicUser(user);
  }

  async saveAvatar(userId: string, file: UploadedAvatarFile): Promise<PublicUser> {
    this.validateAvatarFile(file);

    const extension = this.avatarExtension(file.mimetype);
    const storagePath = `${userId}/${Date.now()}${extension}`;
    const absolutePath = this.toAbsoluteAvatarPath(storagePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    try {
      await this.moveFile(file.path, absolutePath);
    } catch (error) {
      await this.removeFileIfExists(file.path);
      await this.removeFileIfExists(absolutePath);
      throw error;
    }

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStoragePath: true },
    });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarStoragePath: storagePath,
        avatarMimeType: file.mimetype.trim().toLowerCase(),
        avatarUpdatedAt: new Date(),
      },
      select: this.publicUserSelect(),
    });

    if (previous?.avatarStoragePath && previous.avatarStoragePath !== storagePath) {
      await this.removeFileIfExists(this.toAbsoluteAvatarPath(previous.avatarStoragePath));
    }

    return this.toPublicUser(user);
  }

  async getAvatar(userId: string): Promise<AvatarFileResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatarStoragePath: true,
        avatarMimeType: true,
      },
    });

    if (!user?.avatarStoragePath || !user.avatarMimeType) {
      throw new NotFoundException('Avatar not found');
    }

    return {
      stream: createReadStream(this.toAbsoluteAvatarPath(user.avatarStoragePath)),
      mimeType: user.avatarMimeType,
    };
  }

  private validateAvatarFile(file: UploadedAvatarFile): void {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new BadRequestException('Avatar file is required');
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new BadRequestException('Avatar exceeds the 5MB limit');
    }

    const mimeType = file.mimetype.trim().toLowerCase();
    if (!AVATAR_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('Unsupported avatar MIME type');
    }
  }

  private publicUserSelect() {
    return {
      id: true,
      email: true,
      displayName: true,
      statusMessage: true,
      avatarStoragePath: true,
      accountType: true,
      status: true,
      createdAt: true,
    } as const;
  }

  private toPublicUser(user: {
    id: string;
    email: string | null;
    displayName: string;
    statusMessage: string | null;
    avatarStoragePath: string | null;
    accountType: string;
    status: string;
    createdAt: Date;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      statusMessage: user.statusMessage,
      avatarUrl: user.avatarStoragePath ? `/api/users/${user.id}/avatar` : null,
      accountType: user.accountType,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  private getAvatarStorageRoot(): string {
    return resolve(this.configService.get<string>('AVATAR_STORAGE_DIR') ?? join(process.cwd(), 'storage', 'avatars'));
  }

  private toAbsoluteAvatarPath(storagePath: string): string {
    const storageRoot = this.getAvatarStorageRoot();
    const absolutePath = resolve(storageRoot, ...storagePath.split('/'));
    const relativePath = relative(storageRoot, absolutePath);
    if (relativePath.startsWith('..') || resolve(relativePath) === relativePath) {
      throw new BadRequestException('Invalid avatar path');
    }

    return absolutePath;
  }

  private avatarExtension(mimeType: string): string {
    if (mimeType === 'image/jpeg') {
      return '.jpg';
    }
    if (mimeType === 'image/png') {
      return '.png';
    }

    return '.webp';
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
}
