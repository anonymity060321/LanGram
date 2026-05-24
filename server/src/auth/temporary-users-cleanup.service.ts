import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TemporaryUsersCleanupService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.cleanupTemporaryUsers();
  }

  async cleanupTemporaryUsers(): Promise<{ deletedUsers: number }> {
    const temporaryUsers = await this.prisma.user.findMany({
      where: { isTemporary: true },
      select: { id: true, email: true },
    });

    if (temporaryUsers.length === 0) {
      return { deletedUsers: 0 };
    }

    const userIds = temporaryUsers.map((user) => user.id);
    const emails = temporaryUsers.flatMap((user) => (user.email ? [user.email] : []));
    const temporaryConversations = await this.prisma.conversation.findMany({
      where: {
        members: {
          some: { userId: { in: userIds } },
        },
      },
      select: { id: true },
    });
    const conversationIds = temporaryConversations.map((conversation) => conversation.id);

    await this.prisma.$transaction([
      this.prisma.loginLog.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.device.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.emailVerificationCode.deleteMany({ where: { email: { in: emails } } }),
      this.prisma.friendPairingCode.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.friendship.deleteMany({
        where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
      }),
      this.prisma.friendRequest.deleteMany({
        where: { OR: [{ requesterId: { in: userIds } }, { addresseeId: { in: userIds } }] },
      }),
      this.prisma.messageDelivery.deleteMany({
        where: {
          OR: [
            { receiverId: { in: userIds } },
            { message: { conversationId: { in: conversationIds } } },
          ],
        },
      }),
      this.prisma.fileAsset.deleteMany({
        where: {
          OR: [{ uploaderId: { in: userIds } }, { conversationId: { in: conversationIds } }],
        },
      }),
      this.prisma.message.deleteMany({
        where: {
          OR: [{ senderId: { in: userIds } }, { conversationId: { in: conversationIds } }],
        },
      }),
      this.prisma.conversationMember.deleteMany({
        where: {
          OR: [{ userId: { in: userIds } }, { conversationId: { in: conversationIds } }],
        },
      }),
      this.prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } }),
      this.prisma.user.deleteMany({ where: { id: { in: userIds }, isTemporary: true } }),
    ]);

    return { deletedUsers: userIds.length };
  }
}
