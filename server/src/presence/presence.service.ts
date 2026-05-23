import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PresenceState {
  isOnline: boolean;
  lastSeenAt: Date | null;
}

@Injectable()
export class PresenceService {
  private readonly onlineUserIds = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  markOnline(userId: string): PresenceState {
    this.onlineUserIds.add(userId);
    return { isOnline: true, lastSeenAt: null };
  }

  async markOffline(userId: string): Promise<PresenceState> {
    this.onlineUserIds.delete(userId);
    const lastSeenAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt },
    });

    return { isOnline: false, lastSeenAt };
  }

  getPresence(user: { id: string; lastSeenAt?: Date | null }): PresenceState {
    const isOnline = this.onlineUserIds.has(user.id);
    return {
      isOnline,
      lastSeenAt: isOnline ? null : (user.lastSeenAt ?? null),
    };
  }

  isOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  async listFriendUserIds(userId: string): Promise<string[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: {
        userAId: true,
        userBId: true,
      },
    });

    return friendships.map((friendship) =>
      friendship.userAId === userId ? friendship.userBId : friendship.userAId,
    );
  }
}
