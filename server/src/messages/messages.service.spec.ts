import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MessageStatus, MessageType } from '@prisma/client';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  $transaction: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  conversation: {
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  conversationMember: {
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  message: {
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  messageDelivery: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    findMany: MockFunction<(args: unknown) => Promise<unknown[]>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  const prisma = {
    conversation: {
      update: jest.fn(),
    },
    conversationMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    messageDelivery: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
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

function createService(prisma: MockPrisma): MessagesService {
  return new MessagesService(prisma as unknown as PrismaService);
}

function messageFixture(): unknown {
  return {
    id: 'message-id',
    conversationId: 'conversation-id',
    senderId: 'user-a',
    messageType: MessageType.TEXT,
    ciphertext: 'ciphertext-value',
    encryptionVersion: 'mvp-v1',
    nonce: 'nonce-value',
    replyToMessageId: null,
    status: MessageStatus.SENT,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
  };
}

function sendInput(): Parameters<MessagesService['sendTextMessage']>[0] {
  return {
    clientMessageId: 'client-message-id',
    conversationId: 'conversation-id',
    senderId: 'user-a',
    messageType: MessageType.TEXT,
    ciphertext: 'ciphertext-value',
    nonce: 'nonce-value',
    encryptionVersion: 'mvp-v1',
    replyToMessageId: null,
  };
}

describe('MessagesService', () => {
  it('stores only encrypted text message payloads and creates receiver deliveries', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findMany.mockResolvedValue([
      { userId: 'user-a' },
      { userId: 'user-b' },
    ]);
    prisma.message.create.mockResolvedValue(messageFixture());
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.sendTextMessage(sendInput());
    const createArgs = prisma.message.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };

    expect(createArgs.data).toMatchObject({
      ciphertext: 'ciphertext-value',
      nonce: 'nonce-value',
      encryptionVersion: 'mvp-v1',
      messageType: MessageType.TEXT,
    });
    expect(createArgs.data).not.toHaveProperty('plaintext');
    expect(createArgs.data.deliveries).toEqual({
      create: [{ receiverId: 'user-b' }],
    });
    expect(result.message).toMatchObject({
      clientMessageId: 'client-message-id',
      ciphertext: 'ciphertext-value',
    });
    expect(result.receiverIds).toEqual(['user-b']);
  });

  it('rejects non-TEXT messages in Phase 4.2', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(
      service.sendTextMessage({
        ...sendInput(),
        messageType: 'IMAGE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects sends from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-b' }]);
    const service = createService(prisma);

    await expect(service.sendTextMessage(sendInput())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('marks online deliveries as delivered and updates message status', async () => {
    const prisma = createMockPrisma();
    prisma.messageDelivery.findFirst.mockResolvedValue({
      messageId: 'message-id',
      receiverId: 'user-b',
      deliveredAt: null,
      readAt: null,
      message: {
        id: 'message-id',
        conversationId: 'conversation-id',
        status: MessageStatus.SENT,
      },
    });
    prisma.messageDelivery.update.mockResolvedValue({});
    prisma.message.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.markDelivered('user-b', 'message-id');

    expect(result).toMatchObject({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      receiverId: 'user-b',
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-id' },
      data: { status: MessageStatus.DELIVERED },
    });
  });

  it('returns undelivered ciphertext messages for offline delivery', async () => {
    const prisma = createMockPrisma();
    prisma.messageDelivery.findMany.mockResolvedValue([{ message: messageFixture() }]);
    const service = createService(prisma);

    const result = await service.listUndeliveredMessages('user-b');
    const findManyArgs = prisma.messageDelivery.findMany.mock.calls[0][0] as {
      include: { message: { select: Record<string, boolean> } };
    };

    expect(findManyArgs.include.message.select).toMatchObject({
      ciphertext: true,
      nonce: true,
      encryptionVersion: true,
    });
    expect(JSON.stringify(result)).toContain('ciphertext-value');
    expect(JSON.stringify(result)).not.toContain('plaintext');
  });

  it('marks read messages and updates read delivery state', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      senderId: 'user-a',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
    });
    prisma.conversationMember.update.mockResolvedValue({});
    prisma.messageDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.message.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    const result = await service.markRead('user-b', 'conversation-id', 'message-id');

    expect(result).toMatchObject({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      readerId: 'user-b',
    });
    expect(prisma.messageDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receiverId: 'user-b',
          readAt: null,
        }),
      }),
    );
    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: MessageStatus.READ },
      }),
    );
  });

  it('allows the sender to recall a message within two minutes', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.SENT,
      createdAt: new Date(),
    });
    prisma.message.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.recallMessage('user-a', 'conversation-id', 'message-id');

    expect(result).toMatchObject({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      senderId: 'user-a',
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-id' },
      data: {
        status: MessageStatus.RECALLED,
        recalledAt: expect.any(Date),
      },
    });
  });

  it('rejects recall from a non-sender', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.SENT,
      createdAt: new Date(),
    });
    const service = createService(prisma);

    await expect(
      service.recallMessage('user-b', 'conversation-id', 'message-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('rejects recall after two minutes', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.SENT,
      createdAt: new Date(Date.now() - 121000),
    });
    const service = createService(prisma);

    await expect(
      service.recallMessage('user-a', 'conversation-id', 'message-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('rejects repeated recall', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.RECALLED,
      createdAt: new Date(),
    });
    const service = createService(prisma);

    await expect(
      service.recallMessage('user-a', 'conversation-id', 'message-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});
