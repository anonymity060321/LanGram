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
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  conversationMember: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
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
      update: jest.fn(),
    },
    conversationMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

    if (typeof args === 'function') {
      return (args as (tx: MockPrisma) => Promise<unknown>)(prisma);
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
    intro: null,
    avatarUrl: null,
    announcement: null,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    members: [
      {
        role: ConversationMemberRole.MEMBER,
        groupNickname: null,
        groupRemark: null,
        leftAt: null,
        user: {
          id: 'user-a',
          email: null,
          displayName: 'User A',
          accountType: 'GUEST',
        },
      },
      {
        role: ConversationMemberRole.MEMBER,
        groupNickname: null,
        groupRemark: null,
        leftAt: null,
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
    intro: 'Team intro',
    avatarUrl: null,
    announcement: null,
    members: [
      {
        role: ConversationMemberRole.OWNER,
        groupNickname: null,
        groupRemark: null,
        leftAt: null,
        user: {
          id: 'user-a',
          email: null,
          displayName: 'User A',
          accountType: 'GUEST',
        },
      },
      {
        role: ConversationMemberRole.MEMBER,
        groupNickname: null,
        groupRemark: null,
        leftAt: null,
        user: {
          id: 'user-b',
          email: null,
          displayName: 'User B',
          accountType: 'GUEST',
        },
      },
      {
        role: ConversationMemberRole.MEMBER,
        groupNickname: null,
        groupRemark: null,
        leftAt: null,
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
  it('allows group owner to update group name', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        title: 'New Team Room',
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', { name: ' New Team Room ' }) as {
      conversation: { title: string };
      recipientConversations: Array<{ userId: string; conversation: { title: string } }>;
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { title: 'New Team Room' },
    });
    expect(result.conversation.title).toBe('New Team Room');
    expect(result.recipientConversations).toHaveLength(3);
    expect(result.recipientConversations.map((item) => item.userId)).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('allows group owner to update group intro', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        intro: 'Updated intro',
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', { intro: ' Updated intro ' }) as {
      conversation: { intro: string | null };
      recipientConversations: Array<{ userId: string; conversation: { intro: string | null } }>;
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { intro: 'Updated intro' },
    });
    expect(result.conversation.intro).toBe('Updated intro');
    expect(result.recipientConversations).toHaveLength(3);
  });

  it('allows group owner to update group name and intro together', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        title: 'New Team Room',
        intro: 'Updated intro',
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', {
      name: ' New Team Room ',
      intro: ' Updated intro ',
    }) as { conversation: { title: string; intro: string | null } };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { title: 'New Team Room', intro: 'Updated intro' },
    });
    expect(result.conversation).toEqual(expect.objectContaining({ title: 'New Team Room', intro: 'Updated intro' }));
  });

  it('allows group owner to update group avatarUrl', async () => {
    const prisma = createMockPrisma();
    const avatarUrl = '/api/files/group-avatar-file/download';
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        avatarUrl,
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', {
      avatarUrl: ` ${avatarUrl} `,
    }) as {
      conversation: { avatarUrl: string | null };
      recipientConversations: Array<{ userId: string; conversation: { avatarUrl: string | null } }>;
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { avatarUrl },
    });
    expect(result.conversation.avatarUrl).toBe(avatarUrl);
    expect(result.recipientConversations.map((item) => item.userId)).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('allows group owner to update group announcement', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        announcement: 'Weekly sync at 10:00',
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', {
      announcement: ' Weekly sync at 10:00 ',
    }) as {
      conversation: { announcement: string | null };
      recipientConversations: Array<{ userId: string; conversation: { announcement: string | null } }>;
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { announcement: 'Weekly sync at 10:00' },
    });
    expect(result.conversation.announcement).toBe('Weekly sync at 10:00');
    expect(result.recipientConversations.map((item) => item.userId)).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('allows group owner to update group name, intro, avatarUrl, and announcement together', async () => {
    const prisma = createMockPrisma();
    const avatarUrl = '/api/files/group-avatar-file/download';
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        title: 'New Team Room',
        intro: 'Updated intro',
        avatarUrl,
        announcement: 'Updated announcement',
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', {
      name: ' New Team Room ',
      intro: ' Updated intro ',
      avatarUrl: ` ${avatarUrl} `,
      announcement: ' Updated announcement ',
    }) as { conversation: { title: string; intro: string | null; avatarUrl: string | null; announcement: string | null } };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: {
        title: 'New Team Room',
        intro: 'Updated intro',
        avatarUrl,
        announcement: 'Updated announcement',
      },
    });
    expect(result.conversation).toEqual(expect.objectContaining({
      title: 'New Team Room',
      intro: 'Updated intro',
      avatarUrl,
      announcement: 'Updated announcement',
    }));
  });

  it('allows group owner to clear group intro', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        intro: null,
      });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', { intro: null }) as {
      conversation: { intro: string | null };
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { intro: null },
    });
    expect(result.conversation.intro).toBeNull();
  });

  it('allows group owner to clear group avatarUrl', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        avatarUrl: '/api/files/group-avatar-file/download',
      })
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', { avatarUrl: '' }) as {
      conversation: { avatarUrl: string | null };
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { avatarUrl: null },
    });
    expect(result.conversation.avatarUrl).toBeNull();
  });

  it('allows group owner to clear group avatarUrl with null', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        avatarUrl: '/api/files/group-avatar-file/download',
      })
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    await service.updateGroupConversation('user-a', 'group-conversation-id', { avatarUrl: null });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { avatarUrl: null },
    });
  });

  it('allows group owner to clear group announcement by empty string', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        announcement: 'Old announcement',
      })
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.updateGroupConversation('user-a', 'group-conversation-id', { announcement: '' }) as {
      conversation: { announcement: string | null };
    };

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { announcement: null },
    });
    expect(result.conversation.announcement).toBeNull();
  });

  it('allows group owner to clear group announcement with null', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst
      .mockResolvedValueOnce({
        ...(groupConversationFixture() as Record<string, unknown>),
        announcement: 'Old announcement',
      })
      .mockResolvedValueOnce(groupConversationFixture());
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    await service.updateGroupConversation('user-a', 'group-conversation-id', { announcement: null });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'group-conversation-id' },
      data: { announcement: null },
    });
  });

  it('rejects group intro updates longer than 500 characters', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'group-conversation-id', { intro: 'a'.repeat(501) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group avatarUrl updates longer than 1024 characters', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'group-conversation-id', { avatarUrl: 'a'.repeat(1025) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group announcement updates longer than 2000 characters', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'group-conversation-id', { announcement: 'a'.repeat(2001) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects empty group name updates', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'group-conversation-id', { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group name updates from normal members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-b', 'group-conversation-id', { name: 'Member Room' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group name updates from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-x', 'group-conversation-id', { name: 'Hidden Room' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group name updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'conversation-id', { name: 'Direct Room' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group intro updates from normal members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-b', 'group-conversation-id', { intro: 'Member intro' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group avatarUrl updates from normal members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-b', 'group-conversation-id', { avatarUrl: '/api/files/avatar/download' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group announcement updates from normal members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-b', 'group-conversation-id', { announcement: 'Member announcement' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group intro updates from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-x', 'group-conversation-id', { intro: 'Hidden intro' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group avatarUrl updates from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-x', 'group-conversation-id', { avatarUrl: '/api/files/avatar/download' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group announcement updates from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-x', 'group-conversation-id', { announcement: 'Hidden announcement' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group intro updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'conversation-id', { intro: 'Direct intro' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group avatarUrl updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'conversation-id', { avatarUrl: '/api/files/avatar/download' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects group announcement updates for direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.updateGroupConversation('user-a', 'conversation-id', { announcement: 'Direct announcement' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.update).not.toHaveBeenCalled();
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
  it('allows an active group member to add a friend to a group', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [
        { userId: 'user-a', leftAt: null },
        { userId: 'user-b', leftAt: null },
      ],
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-c' }]);
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    prisma.conversationMember.create.mockResolvedValue({});
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    const result = await service.addGroupMembers('user-a', 'group-conversation-id', ['user-c']) as {
      conversation: { memberCount: number; members: Array<{ id: string }> };
      recipientConversations: Array<{ userId: string }>;
    };

    expect(prisma.conversationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'group-conversation-id',
          userId: 'user-c',
          role: ConversationMemberRole.MEMBER,
        }),
      }),
    );
    expect(result.conversation.memberCount).toBe(3);
    expect(result.conversation.members).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'user-c' })]));
    expect(result.recipientConversations.map((item) => item.userId).sort()).toEqual([
      'user-a',
      'user-b',
      'user-c',
    ]);
  });

  it('rejects adding members to direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conversation-id',
      type: ConversationType.DIRECT,
      members: [
        { userId: 'user-a', leftAt: null },
        { userId: 'user-b', leftAt: null },
      ],
    });
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-a', 'conversation-id', ['user-c'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversationMember.create).not.toHaveBeenCalled();
  });

  it('rejects adding members when the operator is not a group member', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [
        { userId: 'user-a', leftAt: null },
        { userId: 'user-b', leftAt: null },
      ],
    });
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-x', 'group-conversation-id', ['user-c'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.create).not.toHaveBeenCalled();
  });

  it('rejects adding members after the operator has left the group', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [
        { userId: 'user-a', leftAt: new Date('2026-06-27T08:00:00.000Z') },
        { userId: 'user-b', leftAt: null },
      ],
    });
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-a', 'group-conversation-id', ['user-c'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.create).not.toHaveBeenCalled();
  });

  it('rejects adding a non-friend to a group', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [{ userId: 'user-a', leftAt: null }],
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-c' }]);
    prisma.friendship.findUnique.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-a', 'group-conversation-id', ['user-c'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.create).not.toHaveBeenCalled();
  });

  it('rejects adding yourself to a group', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-a', 'group-conversation-id', ['user-a'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('rejects adding an active existing group member', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [
        { userId: 'user-a', leftAt: null },
        { userId: 'user-b', leftAt: null },
      ],
    });
    const service = createService(prisma);

    await expect(service.addGroupMembers('user-a', 'group-conversation-id', ['user-b'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversationMember.create).not.toHaveBeenCalled();
  });

  it('can re-add a member whose leftAt is not null', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
      members: [
        { userId: 'user-a', leftAt: null },
        { userId: 'user-c', leftAt: new Date('2026-06-27T08:00:00.000Z') },
      ],
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-c' }]);
    prisma.friendship.findUnique.mockResolvedValue({ id: 'friendship-id' });
    prisma.conversationMember.update.mockResolvedValue({});
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue({
      ...(groupConversationFixture() as Record<string, unknown>),
      members: [
        {
          groupNickname: null,
          groupRemark: null,
          leftAt: null,
          user: {
            id: 'user-a',
            email: 'user-a@example.test',
            displayName: 'User A',
            accountType: 'EMAIL',
          },
        },
        {
          groupNickname: null,
          groupRemark: null,
          leftAt: null,
          user: {
            id: 'user-c',
            email: 'user-c@example.test',
            displayName: 'User C',
            accountType: 'EMAIL',
          },
        },
      ],
    });
    const service = createService(prisma);

    const result = await service.addGroupMembers('user-a', 'group-conversation-id', ['user-c']) as {
      conversation: { members: Array<{ id: string; leftAt: string | null }> };
    };

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'group-conversation-id',
            userId: 'user-c',
          },
        },
        data: { leftAt: null, joinedAt: expect.any(Date), role: ConversationMemberRole.MEMBER },
      }),
    );
    expect(result.conversation.members.find((member) => member.id === 'user-c')).toMatchObject({
      leftAt: null,
    });
  });

  it('lists conversations for a newly added member after membership exists', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findMany.mockResolvedValue([groupConversationFixture()]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.messageDelivery.count.mockResolvedValue(0);
    const service = createService(prisma);

    const result = await service.listConversations('user-c') as {
      conversations: Array<{ id: string; type: ConversationType }>;
    };

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: 'user-c', leftAt: null } } },
      }),
    );
    expect(result.conversations[0]).toMatchObject({
      id: 'group-conversation-id',
      type: ConversationType.GROUP,
    });
  });

  it('allows a group owner to remove an active member', async () => {
    const prisma = createMockPrisma();
    const updatedConversation = {
      ...(groupConversationFixture() as Record<string, unknown>),
      members: (groupConversationFixture() as { members: unknown[] }).members.filter(
        (member) => (member as { user: { id: string } }).user.id !== 'user-b',
      ),
    };
    prisma.conversation.findFirst
      .mockResolvedValueOnce(groupConversationFixture())
      .mockResolvedValueOnce(updatedConversation);
    prisma.conversationMember.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.removeGroupMember('user-a', 'group-conversation-id', 'user-b');

    expect(prisma.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: 'group-conversation-id',
            userId: 'user-b',
          },
        },
        data: { leftAt: expect.any(Date) },
      }),
    );
    expect(result).toMatchObject({
      conversationId: 'group-conversation-id',
      removedUserId: 'user-b',
      member: expect.objectContaining({ id: 'user-b', userId: 'user-b', role: ConversationMemberRole.MEMBER, leftAt: expect.any(Date) }),
      remainingMemberIds: ['user-a', 'user-c'],
    });
  });

  it('rejects removing members when the operator is a normal member', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(groupConversationFixture());
    const service = createService(prisma);

    await expect(service.removeGroupMember('user-b', 'group-conversation-id', 'user-c')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects removing members when the operator is not an active member', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.removeGroupMember('user-x', 'group-conversation-id', 'user-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects removing members from direct conversations', async () => {
    const prisma = createMockPrisma();
    prisma.conversation.findFirst.mockResolvedValue(conversationFixture());
    const service = createService(prisma);

    await expect(service.removeGroupMember('user-a', 'conversation-id', 'user-b')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects removing yourself through the remove member API', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(service.removeGroupMember('user-a', 'group-conversation-id', 'user-a')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it('rejects removing another owner', async () => {
    const prisma = createMockPrisma();
    const conversation = {
      ...(groupConversationFixture() as Record<string, unknown>),
      members: (groupConversationFixture() as { members: Array<Record<string, unknown>> }).members.map((member) =>
        (member.user as { id: string }).id === 'user-c'
          ? { ...member, role: ConversationMemberRole.OWNER }
          : member,
      ),
    };
    prisma.conversation.findFirst.mockResolvedValue(conversation);
    const service = createService(prisma);

    await expect(service.removeGroupMember('user-a', 'group-conversation-id', 'user-c')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });});
