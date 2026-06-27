import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ConversationMemberRole,
  ConversationType,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  $transaction: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  friendship: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  user: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
  };
  conversation: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  conversationMember: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  message: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  messageDelivery: {
    count: MockFunction<(args: unknown) => Promise<number>>;
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  const prisma = {
    friendship: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    conversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    conversationMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    messageDelivery: {
      count: jest.fn(),
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
    title: null,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    members: [
      {
        groupNickname: null,
        user: {
          id: 'user-a',
          email: null,
          displayName: 'User A',
          accountType: 'GUEST',
        },
      },
      {
        groupNickname: null,
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

function groupConversationFixture(): unknown {
  return {
    ...(conversationFixture() as Record<string, unknown>),
    id: 'group-conversation-id',
    type: ConversationType.GROUP,
    title: 'Team Room',
    members: [
      {
        groupNickname: null,
        user: {
          id: 'user-a',
          email: null,
          displayName: 'User A',
          accountType: 'GUEST',
        },
      },
      {
        groupNickname: null,
        user: {
          id: 'user-b',
          email: null,
          displayName: 'User B',
          accountType: 'GUEST',
        },
      },
      {
        groupNickname: null,
        user: {
          id: 'user-c',
          email: null,
          displayName: 'User C',
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
  it('lists conversations with encrypted last message metadata and unread counts sorted by activity', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([
      {
        ...(conversationFixture() as Record<string, unknown>),
        id: 'older-conversation',
        updatedAt: new Date('2026-05-19T10:00:00.000Z'),
      },
      {
        ...(conversationFixture() as Record<string, unknown>),
        id: 'newer-conversation',
        updatedAt: new Date('2026-05-19T09:00:00.000Z'),
      },
    ]);
    prisma.message.findFirst
      .mockResolvedValueOnce({
        ...(messageFixture() as Record<string, unknown>),
        id: 'older-message',
        conversationId: 'older-conversation',
        createdAt: new Date('2026-05-19T10:30:00.000Z'),
      })
      .mockResolvedValueOnce({
        ...(messageFixture() as Record<string, unknown>),
        id: 'newer-message',
        conversationId: 'newer-conversation',
        createdAt: new Date('2026-05-19T11:00:00.000Z'),
      });
    prisma.messageDelivery.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const service = createService(prisma);

    const result = await service.listConversations('user-b') as {
      conversations: Array<{
        id: string;
        lastMessage: { id: string; ciphertext: string };
        lastMessageAt: Date;
        unreadCount: number;
      }>;
    };

    expect(result.conversations.map((conversation) => conversation.id)).toEqual([
      'newer-conversation',
      'older-conversation',
    ]);
    expect(result.conversations[0]).toMatchObject({
      lastMessage: {
        id: 'newer-message',
        ciphertext: 'encrypted-body',
      },
      lastMessageAt: new Date('2026-05-19T11:00:00.000Z'),
      unreadCount: 0,
    });
    expect(result.conversations[1].unreadCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('plaintext');
    expect(prisma.messageDelivery.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receiverId: 'user-b',
          readAt: null,
          message: expect.objectContaining({
            senderId: { not: 'user-b' },
            status: { not: MessageStatus.RECALLED },
          }),
        }),
      }),
    );
  });

  it('lists group conversations without requiring a peer', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([groupConversationFixture()]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.messageDelivery.count.mockResolvedValue(0);
    const service = createService(prisma);

    const result = await service.listConversations('user-a') as {
      conversations: Array<{
        id: string;
        type: ConversationType;
        title: string;
        peer: null;
        memberCount: number;
      }>;
    };

    expect(result.conversations[0]).toMatchObject({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      title: 'Team Room',
      peer: null,
      memberCount: 3,
    });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: 'user-a', leftAt: null } } },
      }),
    );
  });

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

  it('creates a group conversation with owner and member roles', async () => {
    const prisma = createMockPrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'user-b' }, { id: 'user-c' }]);
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    prisma.conversation.create.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    const result = await service.createGroupConversation('user-a', ' Team Room ', [
      'user-b',
      'user-c',
      'user-b',
    ]);
    const createArgs = prisma.conversation.create.mock.calls[0][0] as {
      data: { members: { create: Array<{ userId: string; role: ConversationMemberRole }> } };
    };

    expect(result).toMatchObject({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      title: 'Team Room',
      memberCount: 3,
      peer: null,
    });
    expect(createArgs.data).toMatchObject({
      type: ConversationType.GROUP,
      title: 'Team Room',
      createdByUserId: 'user-a',
    });
    expect(createArgs.data.members.create).toEqual([
      { userId: 'user-a', role: ConversationMemberRole.OWNER },
      { userId: 'user-b', role: ConversationMemberRole.MEMBER },
      { userId: 'user-c', role: ConversationMemberRole.MEMBER },
    ]);
  });

  it('rejects group creation when a selected member is not a friend', async () => {
    const prisma = createMockPrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'user-b' }]);
    prisma.friendship.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.createGroupConversation('user-a', 'Team Room', ['user-b'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('rejects message reads for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.listMessages('user-c', 'conversation-id', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('returns encrypted message payloads without plaintext fields', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 'member-id' });
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

  it('returns paginated encrypted messages with an older-message cursor', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'cursor-message',
      createdAt: new Date('2026-05-19T00:03:00.000Z'),
    });
    prisma.message.findMany.mockResolvedValue([
      {
        ...(messageFixture() as Record<string, unknown>),
        id: 'message-3',
        createdAt: new Date('2026-05-19T00:02:00.000Z'),
      },
      {
        ...(messageFixture() as Record<string, unknown>),
        id: 'message-2',
        createdAt: new Date('2026-05-19T00:01:00.000Z'),
      },
      {
        ...(messageFixture() as Record<string, unknown>),
        id: 'message-1',
        createdAt: new Date('2026-05-19T00:00:00.000Z'),
      },
    ]);
    const service = createService(prisma);

    const result = await service.listMessages('user-a', 'conversation-id', {
      beforeMessageId: 'cursor-message',
      limit: 2,
    }) as { messages: Array<{ id: string }>; hasMore: boolean; nextCursor: string | null };

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'cursor-message' },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    );
    expect(result.messages.map((message) => message.id)).toEqual(['message-2', 'message-3']);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('message-2');
    expect(JSON.stringify(result)).not.toContain('plaintext');
  });

  it('marks a conversation read for members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 'member-id' });
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
  it('updates the current group member nickname and returns it in the conversation DTO', async () => {
    const prisma = createMockPrisma();
    const updatedConversation = {
      ...(groupConversationFixture() as Record<string, unknown>),
      members: [
        {
          groupNickname: 'Captain',
          user: {
            id: 'user-a',
            email: 'user-a@example.test',
            displayName: 'User A',
            accountType: 'EMAIL',
          },
        },
        ...((groupConversationFixture() as { members: unknown[] }).members.slice(1)),
      ],
    };
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce(updatedConversation);
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupNickname('user-a', 'group-conversation-id', ' Captain ') as {
      members: Array<{ id: string; groupNickname: string | null; displayName: string }>;
    };

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'group-conversation-id',
            userId: 'user-a',
          },
        },
        data: { groupNickname: 'Captain' },
      }),
    );
    expect(result.members.find((member) => member.id === 'user-a')).toMatchObject({
      displayName: 'User A',
      groupNickname: 'Captain',
    });
  });

  it('clears the current group member nickname for blank input', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    await service.updateGroupNickname('user-a', 'group-conversation-id', '   ');

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupNickname: null } }),
    );
  });

  it('rejects group nickname updates for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.updateGroupNickname('user-x', 'group-conversation-id', 'Guest'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects group nickname updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(
      service.updateGroupNickname('user-a', 'conversation-id', 'Direct Alias'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('returns member group nicknames in listed group conversation DTOs without changing display names', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([
      {
        ...(groupConversationFixture() as Record<string, unknown>),
        members: [
          {
            groupNickname: 'Captain',
            user: {
              id: 'user-a',
              email: 'user-a@example.test',
              displayName: 'User A',
              accountType: 'EMAIL',
            },
          },
          {
            groupNickname: null,
            user: {
              id: 'user-b',
              email: 'user-b@example.test',
              displayName: 'User B',
              accountType: 'EMAIL',
            },
          },
        ],
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.messageDelivery.count.mockResolvedValue(0);
    const service = createService(prisma);

    const result = await service.listConversations('user-a') as {
      conversations: Array<{ members: Array<{ id: string; displayName: string; groupNickname: string | null }> }>;
    };

    expect(result.conversations[0].members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'user-a', displayName: 'User A', groupNickname: 'Captain' }),
        expect.objectContaining({ id: 'user-b', displayName: 'User B', groupNickname: null }),
      ]),
    );
  });
  it('allows an active group member to leave and returns remaining active members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.leaveGroup('user-a', 'group-conversation-id');

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'group-conversation-id',
            userId: 'user-a',
          },
        },
        data: { leftAt: expect.any(Date) },
      }),
    );
    expect(result).toMatchObject({
      conversationId: 'group-conversation-id',
      member: expect.objectContaining({ id: 'user-a', userId: 'user-a', leftAt: expect.any(Date) }),
      remainingMemberIds: ['user-b', 'user-c'],
    });
  });

  it('rejects leaving direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.leaveGroup('user-a', 'conversation-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects leaving group conversations for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.leaveGroup('user-x', 'group-conversation-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects group nickname updates after the member has left', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.updateGroupNickname('user-a', 'group-conversation-id', 'Left User'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('queries only conversations where the current user is still active', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([]);
    const service = createService(prisma);

    await service.listConversations('user-a');

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: 'user-a', leftAt: null } } },
      }),
    );
  });
  it('updates the current group member private remark and returns only that member remark', async () => {
    const prisma = createMockPrisma();
    const updatedConversation = {
      ...(groupConversationFixture() as Record<string, unknown>),
      members: [
        {
          groupNickname: null,
          groupRemark: 'Ops Squad',
          user: {
            id: 'user-a',
            email: 'user-a@example.test',
            displayName: 'User A',
            accountType: 'EMAIL',
          },
        },
        {
          groupNickname: null,
          groupRemark: 'User B private remark',
          user: {
            id: 'user-b',
            email: 'user-b@example.test',
            displayName: 'User B',
            accountType: 'EMAIL',
          },
        },
      ],
    };
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce(updatedConversation);
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupRemark('user-a', 'group-conversation-id', ' Ops Squad ') as {
      members: Array<{ id: string; groupRemark: string | null }>;
    };

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'group-conversation-id',
            userId: 'user-a',
          },
        },
        data: { groupRemark: 'Ops Squad' },
      }),
    );
    expect(result.members.find((member) => member.id === 'user-a')).toMatchObject({
      groupRemark: 'Ops Squad',
    });
    expect(result.members.find((member) => member.id === 'user-b')).toMatchObject({
      groupRemark: null,
    });
  });

  it('clears the current group member private remark for blank input', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    await service.updateGroupRemark('user-a', 'group-conversation-id', '   ');

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupRemark: null } }),
    );
  });

  it('rejects group remark updates for non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.updateGroupRemark('user-x', 'group-conversation-id', 'Hidden'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects group remark updates after the member has left', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(
      service.updateGroupRemark('user-a', 'group-conversation-id', 'Left User'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects group remark updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(
      service.updateGroupRemark('user-a', 'conversation-id', 'Direct Remark'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('lists only the current user private group remark', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([
      {
        ...(groupConversationFixture() as Record<string, unknown>),
        members: [
          {
            groupNickname: null,
            groupRemark: 'My Room',
            user: {
              id: 'user-a',
              email: 'user-a@example.test',
              displayName: 'User A',
              accountType: 'EMAIL',
            },
          },
          {
            groupNickname: null,
            groupRemark: 'Other Private Room',
            user: {
              id: 'user-b',
              email: 'user-b@example.test',
              displayName: 'User B',
              accountType: 'EMAIL',
            },
          },
        ],
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.messageDelivery.count.mockResolvedValue(0);
    const service = createService(prisma);

    const result = await service.listConversations('user-a') as {
      conversations: Array<{ members: Array<{ id: string; groupRemark: string | null }> }>;
    };

    expect(result.conversations[0].members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'user-a', groupRemark: 'My Room' }),
        expect.objectContaining({ id: 'user-b', groupRemark: null }),
      ]),
    );
  });
});


