import { MessageStatus, MessageType } from '@prisma/client';
import { MessagesService } from '../messages/messages.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { REALTIME_EVENTS } from './realtime.events';
import { RealtimeGateway } from './realtime.gateway';

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
    getConversationPeerIds: jest.MockedFunction<
      (conversationId: string, userId: string) => Promise<string[]>
    >;
  };
} {
  const authService = {
    authenticate: jest.fn(),
  };
  const messagesService = {
    listUndeliveredMessages: jest.fn(),
    markDelivered: jest.fn(),
    sendTextMessage: jest.fn(),
    markRead: jest.fn(),
    getConversationPeerIds: jest.fn(),
  };

  return {
    gateway: new RealtimeGateway(
      authService as unknown as RealtimeAuthService,
      messagesService as unknown as MessagesService,
    ),
    authService,
    messagesService,
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
      reason: 'new_realtime_connection',
    });
    expect(first.disconnect).toHaveBeenCalledWith(true);
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
    });

    expect(messagesService.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 'user-a',
        ciphertext: 'ciphertext-value',
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
});
