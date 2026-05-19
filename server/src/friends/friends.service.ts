import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { FriendRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_CODE_LENGTH = 8;

type UserSummary = {
  id: string;
  email: string | null;
  displayName: string;
  accountType: string;
};

type RequestWithUsers = {
  id: string;
  status: FriendRequestStatus;
  createdAt: Date;
  respondedAt: Date | null;
  requester: UserSummary;
  addressee: UserSummary;
};

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPairingCode(userId: string): Promise<{ pairingCode: string; expiresAt: Date }> {
    const pairingCode = this.generateNumericCode();
    const codeHash = await bcrypt.hash(pairingCode, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.friendPairingCode.updateMany({
        where: {
          userId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      }),
      this.prisma.friendPairingCode.create({
        data: {
          userId,
          codeHash,
          expiresAt,
        },
      }),
    ]);

    return { pairingCode, expiresAt };
  }

  async createRequest(userId: string, pairingCode: string): Promise<unknown> {
    const code = await this.findMatchingPairingCode(pairingCode);
    if (!code) {
      throw new NotFoundException('Pairing code is invalid or expired');
    }

    if (code.userId === userId) {
      throw new BadRequestException('Cannot add yourself as a friend');
    }

    await this.assertNoExistingFriendship(userId, code.userId);
    await this.assertNoExistingRequest(userId, code.userId);

    const request = await this.prisma.$transaction(async (tx) => {
      await tx.friendPairingCode.update({
        where: { id: code.id },
        data: { consumedAt: new Date() },
      });

      return tx.friendRequest.create({
        data: {
          requesterId: userId,
          addresseeId: code.userId,
        },
        include: this.friendRequestInclude(),
      });
    });

    return this.toFriendRequestDto(request);
  }

  async listRequests(userId: string): Promise<{ incoming: unknown[]; outgoing: unknown[] }> {
    const [incoming, outgoing] = await Promise.all([
      this.prisma.friendRequest.findMany({
        where: { addresseeId: userId },
        orderBy: { createdAt: 'desc' },
        include: this.friendRequestInclude(),
      }),
      this.prisma.friendRequest.findMany({
        where: { requesterId: userId },
        orderBy: { createdAt: 'desc' },
        include: this.friendRequestInclude(),
      }),
    ]);

    return {
      incoming: incoming.map((request) => this.toFriendRequestDto(request)),
      outgoing: outgoing.map((request) => this.toFriendRequestDto(request)),
    };
  }

  async acceptRequest(userId: string, requestId: string): Promise<unknown> {
    const request = await this.prisma.friendRequest.findFirst({
      where: { id: requestId, addresseeId: userId },
      include: this.friendRequestInclude(),
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Only pending friend requests can be accepted');
    }

    await this.assertNoExistingFriendship(request.requester.id, request.addressee.id);
    const [userAId, userBId] = this.normalizeFriendPair(request.requester.id, request.addressee.id);

    const acceptedRequest = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.friendRequest.update({
        where: { id: request.id },
        data: {
          status: FriendRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
        include: this.friendRequestInclude(),
      });

      await tx.friendship.create({
        data: {
          userAId,
          userBId,
          createdFromRequestId: request.id,
        },
      });

      return updated;
    });

    return this.toFriendRequestDto(acceptedRequest);
  }

  async rejectRequest(userId: string, requestId: string): Promise<unknown> {
    const request = await this.prisma.friendRequest.findFirst({
      where: { id: requestId, addresseeId: userId },
      include: this.friendRequestInclude(),
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Only pending friend requests can be rejected');
    }

    const rejectedRequest = await this.prisma.friendRequest.update({
      where: { id: request.id },
      data: {
        status: FriendRequestStatus.REJECTED,
        respondedAt: new Date(),
      },
      include: this.friendRequestInclude(),
    });

    return this.toFriendRequestDto(rejectedRequest);
  }

  async listFriends(userId: string): Promise<{ friends: unknown[] }> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        userA: { select: this.userSelect() },
        userB: { select: this.userSelect() },
      },
    });

    return {
      friends: friendships.map((friendship) => {
        const friend = friendship.userA.id === userId ? friendship.userB : friendship.userA;
        return {
          id: friendship.id,
          friend,
          createdAt: friendship.createdAt,
        };
      }),
    };
  }

  private async findMatchingPairingCode(pairingCode: string): Promise<{ id: string; userId: string } | null> {
    const candidates = await this.prisma.friendPairingCode.findMany({
      where: {
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        codeHash: true,
      },
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(pairingCode, candidate.codeHash)) {
        return { id: candidate.id, userId: candidate.userId };
      }
    }

    return null;
  }

  private async assertNoExistingFriendship(userId: string, otherUserId: string): Promise<void> {
    const [userAId, userBId] = this.normalizeFriendPair(userId, otherUserId);
    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Users are already friends');
    }
  }

  private async assertNoExistingRequest(userId: string, otherUserId: string): Promise<void> {
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
      select: { status: true },
    });

    if (!existing) {
      return;
    }

    throw new ConflictException(`Friend request already exists with status ${existing.status}`);
  }

  private friendRequestInclude(): Prisma.FriendRequestInclude {
    return {
      requester: { select: this.userSelect() },
      addressee: { select: this.userSelect() },
    };
  }

  private userSelect(): Prisma.UserSelect {
    return {
      id: true,
      email: true,
      displayName: true,
      accountType: true,
    };
  }

  private toFriendRequestDto(request: RequestWithUsers): unknown {
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      respondedAt: request.respondedAt,
      requester: request.requester,
      addressee: request.addressee,
    };
  }

  private normalizeFriendPair(userId: string, otherUserId: string): [string, string] {
    return userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  }

  private generateNumericCode(): string {
    const min = 10 ** (PAIRING_CODE_LENGTH - 1);
    const max = 10 ** PAIRING_CODE_LENGTH;
    return String(randomInt(min, max));
  }
}
