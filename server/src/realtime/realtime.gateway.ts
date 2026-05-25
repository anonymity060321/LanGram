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
import { PresenceService, type PresenceState } from '../presence/presence.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeSessionService } from './realtime-session.service';
import {
  MessageEditPayload,
  MessageRecallPayload,
  MessageReadPayload,
  MessageSendPayload,
  PresenceUpdatePayload,
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
  constructor(
    private readonly authService: RealtimeAuthService,
    private readonly messagesService: MessagesService,
    private readonly presenceService: PresenceService,
    private readonly realtimeSessionService: RealtimeSessionService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const user = await this.authService.authenticate(this.extractToken(client));
      client.data.user = user;
      this.realtimeSessionService.registerSocket(user, client);
      this.presenceService.markOnline(user.id);
      await this.notifyFriendsPresence(user.id, { isOnline: true, lastSeenAt: null });
      await this.deliverOfflineMessages(user.id);
    } catch {
      client.emit(REALTIME_EVENTS.ERROR, {
        code: 'WS_UNAUTHORIZED',
        message: 'Unauthorized realtime connection',
      } satisfies RealtimeErrorPayload);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    const userId = client.data.user?.id;
    if (!userId) {
      return;
    }

    if (this.realtimeSessionService.unregisterSocket(userId, client.id)) {
      const presence = await this.presenceService.markOffline(userId);
      await this.notifyFriendsPresence(userId, presence);
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
        const receiverSocket = this.realtimeSessionService.getSocket(receiverId);
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
        this.realtimeSessionService.getSocket(peerId)?.emit(REALTIME_EVENTS.MESSAGE_READ, read);
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
        this.realtimeSessionService.getSocket(peerId)?.emit(REALTIME_EVENTS.MESSAGE_RECALLED, recalled);
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
        this.realtimeSessionService.getSocket(peerId)?.emit(REALTIME_EVENTS.MESSAGE_EDITED, edited);
      }
    } catch (error) {
      client.emit(REALTIME_EVENTS.ERROR, this.toErrorPayload(error));
    }
  }

  private async deliverOfflineMessages(userId: string): Promise<void> {
    const socket = this.realtimeSessionService.getSocket(userId);
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

      const senderSocket = this.realtimeSessionService.getSocket(message.senderId);
      senderSocket?.emit(REALTIME_EVENTS.MESSAGE_DELIVERED, delivered);
    }
  }

  private async notifyFriendsPresence(userId: string, presence: PresenceState): Promise<void> {
    const friendIds = await this.presenceService.listFriendUserIds(userId);
    const payload: PresenceUpdatePayload = {
      userId,
      isOnline: presence.isOnline,
      lastSeenAt: presence.lastSeenAt ? presence.lastSeenAt.toISOString() : null,
    };

    for (const friendId of friendIds) {
      this.realtimeSessionService.getSocket(friendId)?.emit(REALTIME_EVENTS.PRESENCE_UPDATE, payload);
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
