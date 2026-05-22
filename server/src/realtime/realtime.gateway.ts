import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../common/current-user';
import { MessagesService } from '../messages/messages.service';
import { RealtimeAuthService } from './realtime-auth.service';
import {
  MessageEditPayload,
  MessageRecallPayload,
  MessageReadPayload,
  MessageSendPayload,
  REALTIME_EVENTS,
  RealtimeErrorPayload,
} from './realtime.events';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
  };
}

@WebSocketGateway({
  path: '/ws',
  cors: { origin: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly socketsByUserId = new Map<string, AuthenticatedSocket>();

  constructor(
    private readonly authService: RealtimeAuthService,
    private readonly messagesService: MessagesService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const user = await this.authService.authenticate(this.extractToken(client));
      client.data.user = user;
      this.registerSocket(user.id, client);
      await this.deliverOfflineMessages(user.id);
    } catch {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime connection',
      } satisfies RealtimeErrorPayload);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    const userId = client.data.user?.id;
    if (!userId) {
      return;
    }

    if (this.socketsByUserId.get(userId)?.id === client.id) {
      this.socketsByUserId.delete(userId);
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.MESSAGE_SEND)
  async handleMessageSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: MessageSendPayload,
  ): Promise<void> {
    const user = this.getSocketUser(client);
    if (!user) {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime event',
      } satisfies RealtimeErrorPayload);
      return;
    }

    try {
      const result = await this.messagesService.sendTextMessage({
        clientMessageId: payload.clientMessageId,
        conversationId: payload.conversationId,
        senderId: user.id,
        messageType: payload.messageType,
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        encryptionVersion: payload.encryptionVersion,
        fileId: payload.fileId ?? null,
        replyToMessageId: payload.replyToMessageId ?? null,
      });

      client.emit(REALTIME_EVENTS.MESSAGE_NEW, result.message);

      for (const receiverId of result.receiverIds) {
        const receiverSocket = this.socketsByUserId.get(receiverId);
        if (!receiverSocket) {
          continue;
        }

        receiverSocket.emit(REALTIME_EVENTS.MESSAGE_NEW, result.message);
        const delivered = await this.messagesService.markDelivered(receiverId, result.message.messageId);
        if (delivered) {
          client.emit(REALTIME_EVENTS.MESSAGE_DELIVERED, delivered);
        }
      }
    } catch (error) {
      client.emit(REALTIME_EVENTS.ERROR, this.toErrorPayload(error));
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.MESSAGE_READ)
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: MessageReadPayload,
  ): Promise<void> {
    const user = this.getSocketUser(client);
    if (!user) {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime event',
      } satisfies RealtimeErrorPayload);
      return;
    }

    try {
      const read = await this.messagesService.markRead(
        user.id,
        payload.conversationId,
        payload.messageId,
      );
      client.emit(REALTIME_EVENTS.MESSAGE_READ, read);

      const peerIds = await this.messagesService.getConversationPeerIds(payload.conversationId, user.id);
      for (const peerId of peerIds) {
        this.socketsByUserId.get(peerId)?.emit(REALTIME_EVENTS.MESSAGE_READ, read);
      }
    } catch (error) {
      client.emit(REALTIME_EVENTS.ERROR, this.toErrorPayload(error));
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.MESSAGE_RECALL)
  async handleMessageRecall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: MessageRecallPayload,
  ): Promise<void> {
    const user = this.getSocketUser(client);
    if (!user) {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime event',
      } satisfies RealtimeErrorPayload);
      return;
    }

    try {
      const recalled = await this.messagesService.recallMessage(
        user.id,
        payload.conversationId,
        payload.messageId,
      );
      client.emit(REALTIME_EVENTS.MESSAGE_RECALLED, recalled);

      const peerIds = await this.messagesService.getConversationPeerIds(payload.conversationId, user.id);
      for (const peerId of peerIds) {
        this.socketsByUserId.get(peerId)?.emit(REALTIME_EVENTS.MESSAGE_RECALLED, recalled);
      }
    } catch (error) {
      client.emit(REALTIME_EVENTS.ERROR, this.toErrorPayload(error));
    }
  }

  @SubscribeMessage(REALTIME_EVENTS.MESSAGE_EDIT)
  async handleMessageEdit(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: MessageEditPayload,
  ): Promise<void> {
    const user = this.getSocketUser(client);
    if (!user) {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime event',
      } satisfies RealtimeErrorPayload);
      return;
    }

    try {
      const edited = await this.messagesService.editMessage(
        user.id,
        payload.conversationId,
        payload.messageId,
        {
          ciphertext: payload.ciphertext,
          nonce: payload.nonce,
          encryptionVersion: payload.encryptionVersion,
        },
      );
      client.emit(REALTIME_EVENTS.MESSAGE_EDITED, edited);

      const peerIds = await this.messagesService.getConversationPeerIds(payload.conversationId, user.id);
      for (const peerId of peerIds) {
        this.socketsByUserId.get(peerId)?.emit(REALTIME_EVENTS.MESSAGE_EDITED, edited);
      }
    } catch (error) {
      client.emit(REALTIME_EVENTS.ERROR, this.toErrorPayload(error));
    }
  }

  private registerSocket(userId: string, client: AuthenticatedSocket): void {
    const existing = this.socketsByUserId.get(userId);
    if (existing && existing.id !== client.id) {
      existing.emit(REALTIME_EVENTS.SESSION_KICKED, { reason: 'new_realtime_connection' });
      existing.disconnect(true);
    }

    this.socketsByUserId.set(userId, client);
  }

  private async deliverOfflineMessages(userId: string): Promise<void> {
    const socket = this.socketsByUserId.get(userId);
    if (!socket) {
      return;
    }

    const messages = await this.messagesService.listUndeliveredMessages(userId);
    for (const message of messages) {
      socket.emit(REALTIME_EVENTS.MESSAGE_NEW, message);
      const delivered = await this.messagesService.markDelivered(userId, message.messageId);
      if (!delivered) {
        continue;
      }

      const senderSocket = this.socketsByUserId.get(message.senderId);
      senderSocket?.emit(REALTIME_EVENTS.MESSAGE_DELIVERED, delivered);
    }
  }

  private extractToken(client: Socket): string | null {
    const token = client.handshake.auth.token ?? client.handshake.query.token;
    if (Array.isArray(token)) {
      return token[0] ?? null;
    }

    return typeof token === 'string' && token ? token : null;
  }

  private getSocketUser(client: AuthenticatedSocket): AuthenticatedUser | null {
    return client.data.user ?? null;
  }

  private toErrorPayload(error: unknown): RealtimeErrorPayload {
    if (error instanceof Error) {
      return {
        code: error.name,
        message: error.message,
      };
    }

    return {
      code: 'REALTIME_ERROR',
      message: 'Realtime event failed',
    };
  }
}
