import { ForbiddenException } from '@nestjs/common';
import { ConversationType, MessageStatus, MessageType } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  $transaction: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  friendship: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  conversation: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  conversationMember: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  message: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  messageDelivery: {
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  const prisma = {
    friendship: {
      findUnique: jest.fn(),
    },
    conversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    conversationMember: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    messageDelivery: {
      updateMany: jest.fn(),
    },
  } as unknown as MockPrisma;

  prisma.$transaction = jest.fn(async (args: unknown): Promise<unknown> => {
    if (Array.isArray(args)) {
      return Promise.all(args);
    }

    return undefined;
  });

  return prisma;
}

function createService(prisma: MockPrisma): ConversationsService {
  const presenceService = {
    getPresence: jest.fn((user: { lastSeenAt?: Date | null }) => ({
      isOnline: false,
      lastSeenAt: user.lastSeenAt ?? null,
    })),
  };

  return new ConversationsService(
    prisma as unknown as PrismaService,
    presenceService as unknown as PresenceService,
  );
}

function conversationFixture(): unknown {
  return {
    id: 'conversation-id',
    type: ConversationType.DIRECT,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    members: [
      {
        user: {
          id: 'user-a',
          email: null,
          displayName: 'User A',
          accountType: 'GUEST',
        },
      },
      {
        user: {
          id: 'user-b',
          email: null,
          displayName: 'User B',
          accountType: 'GUEST',
        },
      },
    ],
  };
}

function messageFixture(): unknown {
  return {
    id: 'message-id',
    conversationId: 'conversation-id',
    senderId: 'user-a',
    messageType: MessageType.TEXT,
    ciphertext: 'encrypted-body',
    encryptionVersion: 'mvp-v1',
    nonce: 'nonce-value',
    replyToMessageId: null,
    status: MessageStatus.SENT,
    editedAt: null,
    recalledAt: null,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    updatedAt: new Date('2026-05-19T00:00:00.000Z'),
  };
}

describe('ConversationsService', () => {
  it('creates a direct conversation only for friends', async () => {
    const prisma = createMockPrisma();
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    const result = await service.createDirectConversation('user-a', 'user-b');

    expect(result).toMatchObject({
      id: 'conversation-id',
      type: ConversationType.DIRECT,
      peer: { id: 'user-b' },
    });
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ConversationType.DIRECT,
          directUserAId: 'user-a',
          directUserBId: 'user-b',
        }),
      }),
    );
  });

  it('rejects direct conversation creation for non-friends', async () => {
    const prisma = createMockPrisma();
    prisma.friendship.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.createDirectConversation('user-a', 'user-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('returns an existing direct conversation for duplicate creation', async () => {
    const prisma = createMockPrisma();
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    prisma.conversation.findUnique.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    const result = await service.createDirectConversation('user-a', 'user-b');

    expect(result).toMatchObject({ id: 'conversation-id' });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('rejects message reads for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.listMessages('user-c', 'conversation-id', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('returns encrypted message payloads without plaintext fields', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findMany.mockResolvedValue([messageFixture()]);
    const service = createService(prisma);

    const result = await service.listMessages('user-a', 'conversation-id', {});
    const findManyArgs = prisma.message.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };

    expect(findManyArgs.select).toMatchObject({
      ciphertext: true,
      encryptionVersion: true,
      nonce: true,
    });
    expect(JSON.stringify(result)).toContain('encrypted-body');
    expect(JSON.stringify(result)).not.toContain('plaintext');
  });

  it('marks a conversation read for members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
    });
    prisma.conversationMember.update.mockResolvedValue({});
    prisma.messageDelivery.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await service.markRead('user-b', 'conversation-id', 'message-id');

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastReadMessageId: 'message-id',
          lastReadAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.messageDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receiverId: 'user-b',
          readAt: null,
        }),
      }),
    );
  });
});
