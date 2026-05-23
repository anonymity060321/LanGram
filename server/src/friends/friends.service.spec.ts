import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FriendRequestStatus } from '@prisma/client';
import { FriendsService } from './friends.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  $transaction: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  friendPairingCode: {
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  friendRequest: {
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  friendship: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  const prisma = {
    friendPairingCode: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    friendRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    friendship: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as unknown as MockPrisma;

  prisma.$transaction = jest.fn(async (args: unknown): Promise<unknown> => {
    if (Array.isArray(args)) {
      return Promise.all(args);
    }

    if (typeof args === 'function') {
      return (args as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }

    return undefined;
  });

  return prisma;
}

function createService(prisma: MockPrisma): FriendsService {
  const presenceService = {
    getPresence: jest.fn((user: { lastSeenAt?: Date | null }) => ({
      isOnline: false,
      lastSeenAt: user.lastSeenAt ?? null,
    })),
  };

  return new FriendsService(
    prisma as unknown as PrismaService,
    presenceService as unknown as PresenceService,
  );
}

function requestFixture(status: FriendRequestStatus): unknown {
  return {
    id: 'request-id',
    status,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    respondedAt: null,
    requester: {
      id: 'user-b',
      email: null,
      displayName: 'User B',
      accountType: 'GUEST',
    },
    addressee: {
      id: 'user-a',
      email: null,
      displayName: 'User A',
      accountType: 'GUEST',
    },
  };
}

describe('FriendsService', () => {
  it('stores only hashed pairing codes with a five minute expiry', async () => {
    const prisma = createMockPrisma();
    prisma.friendPairingCode.updateMany.mockResolvedValue({ count: 0 });
    prisma.friendPairingCode.create.mockResolvedValue({});
    const service = createService(prisma);

    const before = Date.now();
    const result = await service.createPairingCode('user-a');
    const after = Date.now();
    const createArgs = prisma.friendPairingCode.create.mock.calls[0][0] as {
      data: { codeHash: string; expiresAt: Date };
    };

    expect(createArgs.data.codeHash).not.toBe(result.pairingCode);
    await expect(bcrypt.compare(result.pairingCode, createArgs.data.codeHash)).resolves.toBe(true);
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(createArgs.data.expiresAt.getTime()).toBeLessThanOrEqual(after + 5 * 60 * 1000);
  });

  it('rejects adding yourself as a friend', async () => {
    const prisma = createMockPrisma();
    prisma.friendPairingCode.findMany.mockResolvedValue([
      {
        id: 'code-id',
        userId: 'user-a',
        codeHash: await bcrypt.hash('12345678', 4),
      },
    ]);
    const service = createService(prisma);

    await expect(service.createRequest('user-a', '12345678')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate friends', async () => {
    const prisma = createMockPrisma();
    prisma.friendPairingCode.findMany.mockResolvedValue([
      {
        id: 'code-id',
        userId: 'user-a',
        codeHash: await bcrypt.hash('12345678', 4),
      },
    ]);
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    const service = createService(prisma);

    await expect(service.createRequest('user-b', '12345678')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  it('does not accept rejected friend requests', async () => {
    const prisma = createMockPrisma();
    prisma.friendRequest.findFirst.mockResolvedValue(requestFixture(FriendRequestStatus.REJECTED));
    const service = createService(prisma);

    await expect(service.acceptRequest('user-a', 'request-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.friendship.create).not.toHaveBeenCalled();
  });

  it('accepts pending requests and creates a normalized friendship', async () => {
    const prisma = createMockPrisma();
    prisma.friendRequest.findFirst.mockResolvedValue(requestFixture(FriendRequestStatus.PENDING));
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendRequest.update.mockResolvedValue(requestFixture(FriendRequestStatus.ACCEPTED));
    prisma.friendship.create.mockResolvedValue({});
    const service = createService(prisma);

    await service.acceptRequest('user-a', 'request-id');

    expect(prisma.friendRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: FriendRequestStatus.ACCEPTED }),
      }),
    );
    expect(prisma.friendship.create).toHaveBeenCalledWith({
      data: {
        userAId: 'user-a',
        userBId: 'user-b',
        createdFromRequestId: 'request-id',
      },
    });
  });
});
