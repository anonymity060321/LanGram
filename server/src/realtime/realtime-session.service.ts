import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../common/current-user';
import { REALTIME_EVENTS, type SessionKickedPayload } from './realtime.events';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
  };
}

@Injectable()
export class RealtimeSessionService {
  private readonly socketsByUserId = new Map<string, AuthenticatedSocket>();

  registerSocket(user: AuthenticatedUser, client: AuthenticatedSocket): void {
    const existing = this.socketsByUserId.get(user.id);
    if (existing && existing.id !== client.id) {
      this.kickSocket(existing, { reason: 'new_device_login' });
    }

    this.socketsByUserId.set(user.id, client);
  }

  unregisterSocket(userId: string, socketId: string): boolean {
    if (this.socketsByUserId.get(userId)?.id !== socketId) {
      return false;
    }

    this.socketsByUserId.delete(userId);
    return true;
  }

  getSocket(userId: string): AuthenticatedSocket | null {
    return this.socketsByUserId.get(userId) ?? null;
  }

  kickUser(userId: string, payload: SessionKickedPayload): void {
    const socket = this.socketsByUserId.get(userId);
    if (!socket) {
      return;
    }

    this.socketsByUserId.delete(userId);
    this.kickSocket(socket, payload);
  }

  private kickSocket(socket: AuthenticatedSocket, payload: SessionKickedPayload): void {
    socket.emit(REALTIME_EVENTS.SESSION_KICKED, payload);
    socket.disconnect(true);
  }
}
