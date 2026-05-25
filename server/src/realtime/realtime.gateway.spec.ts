import { MessageStatus, MessageType } from '@prisma/client';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { REALTIME_EVENTS } from './realtime.events';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSessionService } from './realtime-session.service';

type MockSocket = {
  id: string;
  data: Record<string, unknown>;
  handshake: {
    auth: { token?: string };
    query: Record<string, string | string[] | undefined>;
  };
  emit: jest.MockedFunction<(event: string, payload: unknown) => void>;
  disconnect: jest.MockedFunction<(close?: boolean) => void>;
};

function createSocket(id: string, token = 'access-token'): MockSocket {
  return {
    id,
    data: {},
    handshake: {
      auth: { token },
      query: {},
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

function messagePayload(): {
  messageId: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  replyToMessageId: null;
  status: MessageStatus;
  file: null;
  createdAt: Date;
} {
  return {
    messageId: 'message-id',
    conversationId: 'conversation-id',
    senderId: 'user-a',
    messageType: MessageType.TEXT,
    ciphertext: 'ciphertext-value',
    nonce: 'nonce-value',
    encryptionVersion: 'mvp-v1',
    replyToMessageId: null,
    status: MessageStatus.SENT,
    file: null,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
  };
}

function createGateway(): {
  gateway: RealtimeGateway;
  authService: {
    authenticate: jest.MockedFunction<(token: string | null) => Promise<unknown>>;
  };
  messagesService: {
    listUndeliveredMessages: jest.MockedFunction<(userId: string) => Promise<unknown[]>>;
    markDelivered: jest.MockedFunction<(receiverId: string, messageId: string) => Promise<unknown>>;
    sendTextMessage: jest.MockedFunction<(input: unknown) => Promise<unknown>>;
    markRead: jest.MockedFunction<
      (readerId: string, conversationId: string, messageId: string) => Promise<unknown>
    >;
    recallMessage: jest.MockedFunction<
      (userId: string, conversationId: string, messageId: string) => Promise<unknown>
    >;
    editMessage: jest.MockedFunction<
      (
        userId: string,
        conversationId: string,
        messageId: string,
        encryptedPayload: unknown,
      ) => Promise<unknown>
    >;
    getConversationPeerIds: jest.MockedFunction<
      (conversationId: string, userId: string) => Promise<string[]>
    >;
  };
  presenceService: {
    markOnline: jest.MockedFunction<
      (userId: string) => { isOnline: boolean; lastSeenAt: Date | null }
    >;
    markOffline: jest.MockedFunction<
      (userId: string) => Promise<{ isOnline: boolean; lastSeenAt: Date | null }>
    >;
    listFriendUserIds: jest.MockedFunction<(userId: string) => Promise<string[]>>;
  };
  realtimeSessionService: RealtimeSessionService;
} {
  const authService = {
    authenticate: jest.fn(),
  };
  const messagesService = {
    listUndeliveredMessages: jest.fn(),
    markDelivered: jest.fn(),
    sendTextMessage: jest.fn(),
    markRead: jest.fn(),
    recallMessage: jest.fn(),
    editMessage: jest.fn(),
    getConversationPeerIds: jest.fn(),
  };
  const presenceService = {
    markOnline: jest.fn((userId: string) => {
      void userId;
      return { isOnline: true, lastSeenAt: null };
    }),
    markOffline: jest.fn(async (userId: string) => {
      void userId;
      return {
        isOnline: false,
        lastSeenAt: new Date('2026-05-19T00:00:02.000Z'),
      };
    }),
    listFriendUserIds: jest.fn(async (userId: string) => {
      void userId;
      return [];
    }),
  };
  const realtimeSessionService = new RealtimeSessionService();

  return {
    gateway: new RealtimeGateway(
      authService as unknown as RealtimeAuthService,
      messagesService as unknown as MessagesService,
      presenceService as unknown as PresenceService,
      realtimeSessionService,
    ),
    authService,
    messagesService,
    presenceService,
    realtimeSessionService,
  };
}

describe('RealtimeGateway', () => {
  it('authenticates connections and delivers offline ciphertext messages', async () => {
    const { gateway, authService, messagesService } = createGateway();
    const socket = createSocket('socket-a');
    authService.authenticate.mockResolvedValue({
      id: 'user-b',
      sessionId: 'session-id',
      accountType: 'GUEST',
    });
    messagesService.listUndeliveredMessages.mockResolvedValue([messagePayload()]);
    messagesService.markDelivered.mockResolvedValue({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      receiverId: 'user-b',
      deliveredAt: new Date('2026-05-19T00:00:01.000Z'),
    });

    await gateway.handleConnection(socket as never);

    expect(authService.authenticate).toHaveBeenCalledWith('access-token');
    expect(socket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_NEW,
      expect.objectContaining({ ciphertext: 'ciphertext-value' }),
    );
    expect(messagesService.markDelivered).toHaveBeenCalledWith('user-b', 'message-id');
  });

  it('rejects unauthorized connections without exposing tokens', async () => {
    const { gateway, authService } = createGateway();
    const socket = createSocket('socket-a');
    authService.authenticate.mockRejectedValue(new Error('invalid token value'));

    await gateway.handleConnection(socket as never);

    expect(socket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.ERROR,
      expect.objectContaining({ code: 'WS_UNAUTHORIZED' }),
    );
    expect(JSON.stringify(socket.emit.mock.calls)).not.toContain('access-token');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('keeps one active realtime socket per user', async () => {
    const { gateway, authService, messagesService } = createGateway();
    const first = createSocket('socket-a');
    const second = createSocket('socket-b');
    authService.authenticate.mockResolvedValue({
      id: 'user-a',
      sessionId: 'session-id',
      accountType: 'GUEST',
    });
    messagesService.listUndeliveredMessages.mockResolvedValue([]);

    await gateway.handleConnection(first as never);
    await gateway.handleConnection(second as never);

    expect(first.emit).toHaveBeenCalledWith(REALTIME_EVENTS.SESSION_KICKED, {
      reason: 'new_device_login',
    });
    expect(first.disconnect).toHaveBeenCalledWith(true);
  });

  it('emits presence updates to online friends on connect and disconnect', async () => {
    const { gateway, authService, messagesService, presenceService } = createGateway();
    const user = createSocket('user-socket');
    const friend = createSocket('friend-socket');
    authService.authenticate
      .mockResolvedValueOnce({ id: 'user-a', sessionId: 'session-a', accountType: 'GUEST' })
      .mockResolvedValueOnce({ id: 'user-b', sessionId: 'session-b', accountType: 'GUEST' });
    messagesService.listUndeliveredMessages.mockResolvedValue([]);
    presenceService.listFriendUserIds
      .mockResolvedValueOnce(['user-b'])
      .mockResolvedValueOnce(['user-a'])
      .mockResolvedValueOnce(['user-b']);

    await gateway.handleConnection(user as never);
    await gateway.handleConnection(friend as never);
    await gateway.handleDisconnect(user as never);

    expect(presenceService.markOnline).toHaveBeenCalledWith('user-a');
    expect(presenceService.markOffline).toHaveBeenCalledWith('user-a');
    expect(friend.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.PRESENCE_UPDATE,
      {
        userId: 'user-a',
        isOnline: false,
        lastSeenAt: '2026-05-19T00:00:02.000Z',
      },
    );
  });

  it('handles message:send and emits message:new plus delivered receipts', async () => {
    const { gateway, authService, messagesService } = createGateway();
    const sender = createSocket('sender-socket');
    const receiver = createSocket('receiver-socket');
    authService.authenticate
      .mockResolvedValueOnce({ id: 'user-a', sessionId: 'session-a', accountType: 'GUEST' })
      .mockResolvedValueOnce({ id: 'user-b', sessionId: 'session-b', accountType: 'GUEST' });
    messagesService.listUndeliveredMessages.mockResolvedValue([]);
    messagesService.sendTextMessage.mockResolvedValue({
      message: messagePayload(),
      receiverIds: ['user-b'],
    });
    messagesService.markDelivered.mockResolvedValue({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      receiverId: 'user-b',
      deliveredAt: new Date('2026-05-19T00:00:01.000Z'),
    });

    await gateway.handleConnection(sender as never);
    await gateway.handleConnection(receiver as never);
    await gateway.handleMessageSend(sender as never, {
      clientMessageId: 'client-message-id',
      conversationId: 'conversation-id',
      messageType: 'TEXT',
      ciphertext: 'ciphertext-value',
      nonce: 'nonce-value',
      encryptionVersion: 'mvp-v1',
      fileId: null,
    });

    expect(messagesService.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 'user-a',
        ciphertext: 'ciphertext-value',
        fileId: null,
      }),
    );
    expect(receiver.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_NEW,
      expect.objectContaining({ messageId: 'message-id' }),
    );
    expect(sender.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_DELIVERED,
      expect.objectContaining({ messageId: 'message-id' }),
    );
  });

  it('handles message:recall and emits message:recalled to both peers', async () => {
    const { gateway, authService, messagesService } = createGateway();
    const sender = createSocket('sender-socket');
    const receiver = createSocket('receiver-socket');
    const recalledAt = new Date('2026-05-19T00:01:00.000Z');
    authService.authenticate
      .mockResolvedValueOnce({ id: 'user-a', sessionId: 'session-a', accountType: 'GUEST' })
      .mockResolvedValueOnce({ id: 'user-b', sessionId: 'session-b', accountType: 'GUEST' });
    messagesService.listUndeliveredMessages.mockResolvedValue([]);
    messagesService.recallMessage.mockResolvedValue({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      senderId: 'user-a',
      recalledAt,
    });
    messagesService.getConversationPeerIds.mockResolvedValue(['user-b']);

    await gateway.handleConnection(sender as never);
    await gateway.handleConnection(receiver as never);
    await gateway.handleMessageRecall(sender as never, {
      conversationId: 'conversation-id',
      messageId: 'message-id',
    });

    expect(messagesService.recallMessage).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      'message-id',
    );
    expect(sender.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_RECALLED,
      expect.objectContaining({ messageId: 'message-id', recalledAt }),
    );
    expect(receiver.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_RECALLED,
      expect.objectContaining({ messageId: 'message-id', recalledAt }),
    );
  });

  it('handles message:edit and emits message:edited to both peers', async () => {
    const { gateway, authService, messagesService } = createGateway();
    const sender = createSocket('sender-socket');
    const receiver = createSocket('receiver-socket');
    const editedAt = new Date('2026-05-19T00:10:00.000Z');
    authService.authenticate
      .mockResolvedValueOnce({ id: 'user-a', sessionId: 'session-a', accountType: 'GUEST' })
      .mockResolvedValueOnce({ id: 'user-b', sessionId: 'session-b', accountType: 'GUEST' });
    messagesService.listUndeliveredMessages.mockResolvedValue([]);
    messagesService.editMessage.mockResolvedValue({
      conversationId: 'conversation-id',
      messageId: 'message-id',
      senderId: 'user-a',
      ciphertext: 'edited-ciphertext',
      nonce: 'edited-nonce',
      encryptionVersion: 'mvp-v1',
      editedAt,
    });
    messagesService.getConversationPeerIds.mockResolvedValue(['user-b']);

    await gateway.handleConnection(sender as never);
    await gateway.handleConnection(receiver as never);
    await gateway.handleMessageEdit(sender as never, {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      ciphertext: 'edited-ciphertext',
      nonce: 'edited-nonce',
      encryptionVersion: 'mvp-v1',
    });

    expect(messagesService.editMessage).toHaveBeenCalledWith(
      'user-a',
      'conversation-id',
      'message-id',
      {
        ciphertext: 'edited-ciphertext',
        nonce: 'edited-nonce',
        encryptionVersion: 'mvp-v1',
      },
    );
    expect(sender.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({ messageId: 'message-id', editedAt }),
    );
    expect(receiver.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.MESSAGE_EDITED,
      expect.objectContaining({ messageId: 'message-id', editedAt }),
    );
  });
});
