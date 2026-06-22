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
    findUniqueOrThrow: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  fileAsset: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  friendship: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
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
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    fileAsset: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    friendship: {
      findUnique: jest.fn().mockResolvedValue({ id: 'friendship-id' }),
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
    fileAsset: null,
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
    prisma.message.findUniqueOrThrow.mockResolvedValue(messageFixture());
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

  it('rejects file messages without fileId', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(
      service.sendTextMessage({
        ...sendInput(),
        messageType: MessageType.IMAGE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects TEXT messages with fileId', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(
      service.sendTextMessage({
        ...sendInput(),
        fileId: 'file-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('attaches uploaded file metadata when sending IMAGE messages', async () => {
    const prisma = createMockPrisma();
    const fileAsset = {
      id: 'file-id',
      uploaderId: 'user-a',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      kind: 'IMAGE',
      originalName: 'photo.jpg',
      safeName: 'file-id.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(1024),
      sha256: 'a'.repeat(64),
      width: 800,
      height: 600,
      status: 'ATTACHED',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
      deletedAt: null,
    };
    prisma.conversationMember.findMany.mockResolvedValue([
      { userId: 'user-a' },
      { userId: 'user-b' },
    ]);
    prisma.fileAsset.findFirst.mockResolvedValue({ id: 'file-id' });
    prisma.message.create.mockResolvedValue({
      ...(messageFixture() as Record<string, unknown>),
      messageType: MessageType.IMAGE,
      fileAsset: null,
    });
    prisma.fileAsset.update.mockResolvedValue({});
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      ...(messageFixture() as Record<string, unknown>),
      messageType: MessageType.IMAGE,
      fileAsset,
    });
    prisma.conversation.update.mockResolvedValue({});
    const service = createService(prisma);

    const result = await service.sendTextMessage({
      ...sendInput(),
      messageType: MessageType.IMAGE,
      fileId: 'file-id',
    });

    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'file-id',
          conversationId: 'conversation-id',
          status: 'UPLOADED',
        }),
      }),
    );
    expect(prisma.fileAsset.update).toHaveBeenCalledWith({
      where: { id: 'file-id' },
      data: {
        messageId: 'message-id',
        status: 'ATTACHED',
      },
    });
    expect(result.message).toMatchObject({
      messageType: MessageType.IMAGE,
      file: {
        id: 'file-id',
        originalName: 'photo.jpg',
        sizeBytes: '1024',
      },
    });
    expect(JSON.stringify(result.message)).not.toContain('storagePath');
  });

  it('rejects sends from non-members', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findMany.mockResolvedValue([{ userId: 'user-b' }]);
    const service = createService(prisma);

    await expect(service.sendTextMessage(sendInput())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects sends when direct conversation members are no longer friends', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findMany.mockResolvedValue([
      { userId: 'user-a' },
      { userId: 'user-b' },
    ]);
    prisma.friendship.findUnique.mockResolvedValue(null);
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

  it('allows the sender to edit a message within fifteen minutes', async () => {
    const prisma = createMockPrisma();
    const editedAt = new Date('2026-05-19T00:10:00.000Z');
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.SENT,
      createdAt: new Date(),
    });
    prisma.message.update.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      ciphertext: 'edited-ciphertext',
      nonce: 'edited-nonce',
      encryptionVersion: 'mvp-v1',
      editedAt,
    });
    const service = createService(prisma);

    const result = await service.editMessage('user-a', 'conversation-id', 'message-id', {
      ciphertext: 'edited-ciphertext',
      nonce: 'edited-nonce',
      encryptionVersion: 'mvp-v1',
    });

    expect(result).toMatchObject({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      senderId: 'user-a',
      ciphertext: 'edited-ciphertext',
      nonce: 'edited-nonce',
      encryptionVersion: 'mvp-v1',
      editedAt,
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-id' },
      data: {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
        editedAt: expect.any(Date),
      },
      select: expect.objectContaining({
        ciphertext: true,
        nonce: true,
        encryptionVersion: true,
        editedAt: true,
      }),
    });
  });

  it('rejects edit from a non-sender', async () => {
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
      service.editMessage('user-b', 'conversation-id', 'message-id', {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('rejects edit after fifteen minutes', async () => {
    const prisma = createMockPrisma();
    prisma.conversationMember.findUnique.mockResolvedValue({ id: 'member-id' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'user-a',
      status: MessageStatus.SENT,
      createdAt: new Date(Date.now() - 901000),
    });
    const service = createService(prisma);

    await expect(
      service.editMessage('user-a', 'conversation-id', 'message-id', {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('rejects editing recalled messages', async () => {
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
      service.editMessage('user-a', 'conversation-id', 'message-id', {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('rejects edit with empty encrypted payload fields', async () => {
    const prisma = createMockPrisma();
    const service = createService(prisma);

    await expect(
      service.editMessage('user-a', 'conversation-id', 'message-id', {
        ciphertext: '',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.editMessage('user-a', 'conversation-id', 'message-id', {
        ciphertext: 'edited-ciphertext',
        nonce: ' ',
        encryptionVersion: 'mvp-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.editMessage('user-a', 'conversation-id', 'message-id', {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});
