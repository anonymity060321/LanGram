import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationMemberRole,
  ConversationType,
  MessageStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

type UserSummary = {
  id: string;
  email: string | null;
  displayName: string;
  statusMessage: string | null;
  avatarStoragePath: string | null;
  accountType: string;
  lastSeenAt: Date | null;
};

type ConversationWithMembers = {
  id: string;
  type: ConversationType;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{ groupNickname: string | null; groupRemark: string | null; leftAt: Date | null; user: UserSummary }>;
};

export type GroupMemberRealtimeDto = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  statusMessage?: string | null;
  avatarUrl?: string | null;
  accountType?: string;
  isOnline?: boolean;
  lastSeenAt?: Date | string | null;
  groupNickname?: string | null;
  groupRemark?: string | null;
  leftAt?: Date | string | null;
};

export type LeaveGroupResult = {
  conversationId: string;
  leftAt: Date;
  member: GroupMemberRealtimeDto;
  remainingMemberIds: string[];
};

type ConversationListItem = ConversationWithMembers & {
  lastMessage: MessageRecord | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: string;
  ciphertext: string;
  encryptionVersion: string;
  nonce: string;
  replyToMessageId: string | null;
  status: MessageStatus;
  fileAsset: MessageFileAssetRecord | null;
  editedAt: Date | null;
  recalledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageFileAssetRecord = {
  id: string;
  uploaderId: string;
  conversationId: string;
  messageId: string | null;
  kind: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  width: number | null;
  height: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenceService: PresenceService,
  ) {}

  async listConversations(userId: string): Promise<{ conversations: unknown[] }> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        members: { some: { userId, leftAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      include: this.conversationInclude(),
    });
    const enrichedConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const typedConversation = conversation as unknown as ConversationWithMembers;
        const lastMessage = await this.prisma.message.findFirst({
          where: { conversationId: typedConversation.id },
          orderBy: { createdAt: 'desc' },
          select: this.messageSelect(),
        });
        const unreadCount = await this.prisma.messageDelivery.count({
          where: {
            receiverId: userId,
            readAt: null,
            message: {
              conversationId: typedConversation.id,
              senderId: { not: userId },
              status: { not: MessageStatus.RECALLED },
            },
          },
        });

        return {
          ...typedConversation,
          lastMessage: lastMessage ? (lastMessage as unknown as MessageRecord) : null,
          lastMessageAt: lastMessage?.createdAt ?? null,
          unreadCount,
        };
      }),
    );
    enrichedConversations.sort(
      (left, right) =>
        this.conversationSortTime(right).getTime() - this.conversationSortTime(left).getTime(),
    );

    return {
      conversations: enrichedConversations.map((conversation) =>
        this.toConversationDto(conversation, userId),
      ),
    };
  }

  async createDirectConversation(userId: string, friendUserId: string): Promise<unknown> {
    if (userId === friendUserId) {
      throw new BadRequestException('Cannot create a direct conversation with yourself');
    }

    await this.assertFriendship(userId, friendUserId);
    const [directUserAId, directUserBId] = this.normalizeUserPair(userId, friendUserId);

    const existing = await this.prisma.conversation.findUnique({
      where: {
        type_directUserAId_directUserBId: {
          type: ConversationType.DIRECT,
          directUserAId,
          directUserBId,
        },
      },
      include: this.conversationInclude(),
    });

    if (existing) {
      return this.toConversationDto(existing as unknown as ConversationWithMembers, userId);
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        directUserAId,
        directUserBId,
        members: {
          create: [{ userId }, { userId: friendUserId }],
        },
      },
      include: this.conversationInclude(),
    });

    return this.toConversationDto(conversation as unknown as ConversationWithMembers, userId);
  }

  async createGroupConversation(
    userId: string,
    title: string,
    memberUserIds: string[],
  ): Promise<unknown> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new BadRequestException('Group title is required');
    }

    const uniqueMemberIds = Array.from(
      new Set(memberUserIds.map((memberUserId) => memberUserId.trim()).filter(Boolean)),
    ).filter((memberUserId) => memberUserId !== userId);

    if (uniqueMemberIds.length < 1) {
      throw new BadRequestException('Group conversations require at least one friend');
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueMemberIds },
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    const foundUserIds = new Set(users.map((user) => user.id));
    if (uniqueMemberIds.some((memberUserId) => !foundUserIds.has(memberUserId))) {
      throw new BadRequestException('One or more group members do not exist');
    }

    await Promise.all(
      uniqueMemberIds.map((memberUserId) => this.assertFriendship(userId, memberUserId)),
    );

    const conversation = await this.prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title: normalizedTitle,
        createdByUserId: userId,
        members: {
          create: [
            { userId, role: ConversationMemberRole.OWNER },
            ...uniqueMemberIds.map((memberUserId) => ({
              userId: memberUserId,
              role: ConversationMemberRole.MEMBER,
            })),
          ],
        },
      },
      include: this.conversationInclude(),
    });

    return this.toConversationDto(conversation as unknown as ConversationWithMembers, userId);
  }

  async updateGroupNickname(
    userId: string,
    conversationId: string,
    groupNickname: string | null | undefined,
  ): Promise<unknown> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { userId, leftAt: null } },
      },
      include: this.conversationInclude(),
    });

    if (!conversation) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Group nickname can only be set for group conversations');
    }

    const normalizedNickname = groupNickname?.trim() || null;
    await this.prisma.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: { groupNickname: normalizedNickname },
    });

    const updatedConversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { userId, leftAt: null } },
      },
      include: this.conversationInclude(),
    });

    if (!updatedConversation) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    return this.toConversationDto(updatedConversation as unknown as ConversationWithMembers, userId);
  }

  async updateGroupRemark(
    userId: string,
    conversationId: string,
    groupRemark: string | null | undefined,
  ): Promise<unknown> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { userId, leftAt: null } },
      },
      include: this.conversationInclude(),
    });

    if (!conversation) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Group remark can only be set for group conversations');
    }

    const normalizedRemark = groupRemark?.trim() || null;
    await this.prisma.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: { groupRemark: normalizedRemark },
    });

    const updatedConversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { userId, leftAt: null } },
      },
      include: this.conversationInclude(),
    });

    if (!updatedConversation) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    return this.toConversationDto(updatedConversation as unknown as ConversationWithMembers, userId);
  }
  async leaveGroup(userId: string, conversationId: string): Promise<LeaveGroupResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { userId, leftAt: null } },
      },
      include: this.conversationInclude(),
    });

    if (!conversation) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Only group conversations can be left');
    }

    const typedConversation = conversation as unknown as ConversationWithMembers;
    const leavingMember = typedConversation.members.find((member) => member.user.id === userId);
    if (!leavingMember) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    const leftAt = new Date();
    await this.prisma.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: { leftAt },
    });

    return {
      conversationId,
      leftAt,
      member: this.toConversationMemberDto(
        leavingMember.user,
        leavingMember.groupNickname,
        leavingMember.groupRemark,
        leftAt,
      ) as GroupMemberRealtimeDto,
      remainingMemberIds: typedConversation.members
        .map((member) => member.user.id)
        .filter((memberUserId) => memberUserId !== userId),
    };
  }

  async listMessages(
    userId: string,
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<{ messages: unknown[]; hasMore: boolean; nextCursor: string | null }> {
    await this.assertConversationMember(userId, conversationId);
    const limit = query.limit ?? 50;
    const beforeMessageId = query.beforeMessageId ?? query.before;
    const beforeMessage = beforeMessageId
      ? await this.findMessageInConversation(conversationId, beforeMessageId)
      : null;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
      },
      ...(beforeMessage ? { cursor: { id: beforeMessage.id }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: this.messageSelect(),
    });
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();

    return {
      messages: page.map((message) => this.toMessageDto(message)),
      hasMore,
      nextCursor: page[0]?.id ?? null,
    };
  }

  async markRead(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ read: true; messageId: string }> {
    await this.assertConversationMember(userId, conversationId);
    const message = await this.findMessageInConversation(conversationId, messageId);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        data: {
          lastReadMessageId: message.id,
          lastReadAt: now,
        },
      }),
      this.prisma.messageDelivery.updateMany({
        where: {
          receiverId: userId,
          message: {
            conversationId,
            createdAt: { lte: message.createdAt },
          },
          readAt: null,
        },
        data: { readAt: now },
      }),
    ]);

    return { read: true, messageId };
  }

  private async assertFriendship(userId: string, friendUserId: string): Promise<void> {
    const [userAId, userBId] = this.normalizeUserPair(userId, friendUserId);
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true },
    });

    if (!friendship) {
      throw new ForbiddenException('Direct conversations can only be created between friends');
    }
  }

  private async assertConversationMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
      select: { id: true },
    });

    if (!member) {
      throw new ForbiddenException('Conversation is not accessible');
    }
  }

  private async findMessageInConversation(
    conversationId: string,
    messageId: string,
  ): Promise<{ id: string; createdAt: Date }> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  private conversationInclude(): Prisma.ConversationInclude {
    return {
      members: {
        where: { leftAt: null },
        select: {
          groupNickname: true,
          groupRemark: true,
          leftAt: true,
          user: { select: this.userSelect() },
        },
        orderBy: { joinedAt: 'asc' },
      },
    };
  }

  private userSelect(): Prisma.UserSelect {
    return {
      id: true,
      email: true,
      displayName: true,
      statusMessage: true,
      avatarStoragePath: true,
      accountType: true,
      lastSeenAt: true,
    };
  }

  private messageSelect(): Prisma.MessageSelect {
    return {
      id: true,
      conversationId: true,
      senderId: true,
      messageType: true,
      ciphertext: true,
      encryptionVersion: true,
      nonce: true,
      replyToMessageId: true,
      status: true,
      fileAsset: {
        select: this.fileMetadataSelect(),
      },
      editedAt: true,
      recalledAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private fileMetadataSelect(): Prisma.FileAssetSelect {
    return {
      id: true,
      uploaderId: true,
      conversationId: true,
      messageId: true,
      kind: true,
      originalName: true,
      safeName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      width: true,
      height: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    };
  }

  private toConversationDto(
    conversation: ConversationWithMembers | ConversationListItem,
    currentUserId: string,
  ): unknown {
    const peer =
      conversation.type === ConversationType.DIRECT
        ? conversation.members.find((member) => member.user.id !== currentUserId)?.user ?? null
        : null;
    const listItem =
      'lastMessage' in conversation
        ? conversation
        : { lastMessage: null, lastMessageAt: null, unreadCount: 0 };

    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      peer: peer ? this.toUserDto(peer) : null,
      members: conversation.members.map((member) =>
        this.toConversationMemberDto(
          member.user,
          member.groupNickname,
          member.user.id === currentUserId ? member.groupRemark : null,
          member.leftAt,
        ),
      ),
      memberCount: conversation.members.length,
      lastMessage: listItem.lastMessage ? this.toMessageDto(listItem.lastMessage) : null,
      lastMessageAt: listItem.lastMessageAt,
      unreadCount: listItem.unreadCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toUserDto(user: UserSummary): unknown {
    const presence = this.presenceService.getPresence(user);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      statusMessage: user.statusMessage,
      avatarUrl: user.avatarStoragePath ? `/api/users/${user.id}/avatar` : null,
      accountType: user.accountType,
      isOnline: presence.isOnline,
      lastSeenAt: presence.lastSeenAt,
    };
  }

  private toConversationMemberDto(
    user: UserSummary,
    groupNickname: string | null,
    groupRemark: string | null,
    leftAt: Date | null = null,
  ): unknown {
    return {
      ...(this.toUserDto(user) as Record<string, unknown>),
      userId: user.id,
      groupNickname,
      groupRemark,
      leftAt,
    };
  }

  private toMessageDto(message: MessageRecord): unknown {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageType: message.messageType,
      ciphertext: message.ciphertext,
      encryptionVersion: message.encryptionVersion,
      nonce: message.nonce,
      replyToMessageId: message.replyToMessageId,
      status: message.status,
      file: message.fileAsset ? this.toFileMetadataDto(message.fileAsset) : null,
      editedAt: message.editedAt,
      recalledAt: message.recalledAt,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  private toFileMetadataDto(file: MessageFileAssetRecord): unknown {
    return {
      id: file.id,
      uploaderId: file.uploaderId,
      conversationId: file.conversationId,
      messageId: file.messageId,
      kind: file.kind,
      originalName: file.originalName,
      safeName: file.safeName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      sha256: file.sha256,
      width: file.width,
      height: file.height,
      status: file.status,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      deletedAt: file.deletedAt,
    };
  }

  private conversationSortTime(conversation: ConversationListItem): Date {
    return conversation.lastMessageAt ?? conversation.updatedAt;
  }

  private normalizeUserPair(userId: string, friendUserId: string): [string, string] {
    return userId < friendUserId ? [userId, friendUserId] : [friendUserId, userId];
  }
}









