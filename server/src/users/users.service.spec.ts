import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  user: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function createService(prisma: MockPrisma, storageDir = join(tmpdir(), 'langram-avatar-test')): UsersService {
  const configService = {
    get: jest.fn((key: string) => (key === 'AVATAR_STORAGE_DIR' ? storageDir : undefined)),
  };

  return new UsersService(
    prisma as unknown as PrismaService,
    configService as unknown as ConfigService,
  );
}

function userFixture(): unknown {
  return {
    id: 'user-a',
    email: 'user-a@example.com',
    displayName: 'User A',
    statusMessage: 'Available',
    avatarStoragePath: 'user-a/avatar.webp',
    accountType: 'EMAIL',
    status: 'ACTIVE',
    createdAt: new Date('2026-05-23T00:00:00.000Z'),
  };
}

describe('UsersService', () => {
  it('returns public profiles without avatar storage paths', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(userFixture());
    const service = createService(prisma);

    const result = await service.findPublicById('user-a');

    expect(result).toMatchObject({
      id: 'user-a',
      displayName: 'User A',
      statusMessage: 'Available',
      avatarUrl: '/api/users/user-a/avatar',
    });
    expect(result).not.toHaveProperty('avatarStoragePath');
  });

  it('updates display name and status message', async () => {
    const prisma = createMockPrisma();
    prisma.user.update.mockResolvedValue({
      ...(userFixture() as Record<string, unknown>),
      displayName: 'Updated',
      statusMessage: 'Working',
    });
    const service = createService(prisma);

    const result = await service.updateProfile('user-a', {
      displayName: ' Updated ',
      statusMessage: ' Working ',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a' },
        data: {
          displayName: 'Updated',
          statusMessage: 'Working',
        },
      }),
    );
    expect(result.displayName).toBe('Updated');
    expect(result.statusMessage).toBe('Working');
  });

  it('rejects empty display names', async () => {
    const service = createService(createMockPrisma());

    await expect(service.updateProfile('user-a', { displayName: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unsupported avatar MIME types and files larger than 5MB', async () => {
    const service = createService(createMockPrisma());

    await expect(
      service.saveAvatar('user-a', {
        path: 'avatar.tmp',
        mimetype: 'text/plain',
        size: 128,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.saveAvatar('user-a', {
        path: 'avatar.tmp',
        mimetype: 'image/png',
        size: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores avatars under the configured root and returns only public metadata', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'langram-avatar-test-'));
    const tempFile = join(tempDir, 'upload.tmp');
    await writeFile(tempFile, 'avatar-content');
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ avatarStoragePath: null });
    prisma.user.update.mockResolvedValue({
      ...(userFixture() as Record<string, unknown>),
      avatarStoragePath: 'user-a/avatar.webp',
      avatarMimeType: 'image/webp',
    });
    const service = createService(prisma, join(tempDir, 'avatars'));

    const result = await service.saveAvatar('user-a', {
      path: tempFile,
      mimetype: 'image/webp',
      size: 14,
    });
    const updateArgs = prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };

    expect(updateArgs.data.avatarStoragePath).toEqual(expect.stringMatching(/^user-a\/.+\.webp$/));
    expect(updateArgs.data.avatarMimeType).toBe('image/webp');
    expect(result.avatarUrl).toBe('/api/users/user-a/avatar');
    expect(result).not.toHaveProperty('avatarStoragePath');

    await rm(tempDir, { recursive: true, force: true });
  });
});
