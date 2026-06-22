import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FileStatus, MessageStatus, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SendTextMessageInput {
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  messageType: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  replyToMessageId?: string | null;
  fileId?: string | null;
}

export interface MessageFileMetadataPayload {
  id: string;
  uploaderId: string;
  conversationId: string;
  messageId: string | null;
  kind: string;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
  width: number | null;
  height: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MessageEventPayload {
  messageId: string;
  clientMessageId?: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  replyToMessageId: string | null;
  status: MessageStatus;
  file: MessageFileMetadataPayload | null;
  createdAt: Date;
}

export interface DeliveryEventPayload {
  conversationId: string;
  messageId: string;
  receiverId: string;
  deliveredAt: Date;
}

export interface ReadEventPayload {
  conversationId: string;
  messageId: string;
  readerId: string;
  readAt: Date;
}

export interface RecallEventPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  recalledAt: Date;
}

export interface EditMessageInput {
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
}

export interface EditedEventPayload {
  conversationId: string;
  messageId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: string;
  editedAt: Date;
}

type MessageWithSender = {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  ciphertext: string;
  encryptionVersion: string;
  nonce: string;
  replyToMessageId: string | null;
  status: MessageStatus;
  fileAsset: MessageFileAssetRecord | null;
  createdAt: Date;
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

const MESSAGE_RECALL_WINDOW_MS = 2 * 60 * 1000;
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async sendTextMessage(input: SendTextMessageInput): Promise<{
    message: MessageEventPayload;
    receiverIds: string[];
  }> {
    this.assertMessageInput(input);

    const members = await this.getConversationMembers(input.conversationId);
    if (!members.some((member) => member.userId === input.senderId)) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    const receiverIds = members
      .map((member) => member.userId)
      .filter((memberUserId) => memberUserId !== input.senderId);

    if (receiverIds.length !== 1) {
      throw new BadRequestException('Only direct text messages are supported');
    }

    await this.assertDirectFriendship(input.senderId, receiverIds[0]);

    if (input.replyToMessageId) {
      await this.assertMessageInConversation(input.conversationId, input.replyToMessageId);
    }

    const message = await this.prisma.$transaction(async (tx) => {
      let fileAsset: { id: string } | null = null;
      if (input.messageType !== MessageType.TEXT) {
        fileAsset = await tx.fileAsset.findFirst({
          where: {
            id: input.fileId ?? '',
            conversationId: input.conversationId,
            status: FileStatus.UPLOADED,
            deletedAt: null,
          },
          select: { id: true },
        });

        if (!fileAsset) {
          throw new BadRequestException('File is not available for this conversation');
        }
      }

      const created = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: input.senderId,
          messageType: input.messageType as MessageType,
          ciphertext: input.ciphertext,
          encryptionVersion: input.encryptionVersion,
          nonce: input.nonce,
          replyToMessageId: input.replyToMessageId ?? null,
          status: MessageStatus.SENT,
          deliveries: {
            create: receiverIds.map((receiverId) => ({ receiverId })),
          },
        },
        select: this.messageSelect(),
      });

      if (fileAsset) {
        await tx.fileAsset.update({
          where: { id: fileAsset.id },
          data: {
            messageId: created.id,
            status: FileStatus.ATTACHED,
          },
        });
      }

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });

      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        select: this.messageSelect(),
      });
    });

    return {
      message: this.toMessageEventPayload(message, input.clientMessageId),
      receiverIds,
    };
  }

  async markDelivered(
    receiverId: string,
    messageId: string,
  ): Promise<DeliveryEventPayload | null> {
    const delivery = await this.prisma.messageDelivery.findFirst({
      where: {
        messageId,
        receiverId,
      },
      include: {
        message: {
          select: {
            id: true,
            conversationId: true,
            status: true,
          },
        },
      },
    });

    if (!delivery || delivery.readAt) {
      return null;
    }

    const deliveredAt = delivery.deliveredAt ?? new Date();

    await this.prisma.$transaction([
      this.prisma.messageDelivery.update({
        where: {
          messageId_receiverId: {
            messageId,
            receiverId,
          },
        },
        data: { deliveredAt },
      }),
      ...(delivery.message.status === MessageStatus.SENT
        ? [
            this.prisma.message.update({
              where: { id: messageId },
              data: { status: MessageStatus.DELIVERED },
            }),
          ]
        : []),
    ]);

    return {
      conversationId: delivery.message.conversationId,
      messageId,
      receiverId,
      deliveredAt,
    };
  }

  async markRead(
    readerId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ReadEventPayload> {
    await this.assertConversationMember(readerId, conversationId);
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: {
        id: true,
        senderId: true,
        createdAt: true,
      },
    });

    if (!message) {
      throw new BadRequestException('Message does not belong to this conversation');
    }

    const readAt = new Date();

    await this.prisma.$transaction([
      this.prisma.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId: readerId,
          },
        },
        data: {
          lastReadMessageId: messageId,
          lastReadAt: readAt,
        },
      }),
      this.prisma.messageDelivery.updateMany({
        where: {
          receiverId: readerId,
          message: {
            conversationId,
            createdAt: { lte: message.createdAt },
          },
          readAt: null,
        },
        data: {
          deliveredAt: readAt,
          readAt,
        },
      }),
      this.prisma.message.updateMany({
        where: {
          id: messageId,
          senderId: { not: readerId },
          status: { not: MessageStatus.RECALLED },
        },
        data: { status: MessageStatus.READ },
      }),
    ]);

    return {
      conversationId,
      messageId,
      readerId,
      readAt,
    };
  }

  async recallMessage(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<RecallEventPayload> {
    await this.assertConversationMember(userId, conversationId);

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        status: true,
        createdAt: true,
      },
    });

    if (!message) {
      throw new BadRequestException('Message does not belong to this conversation');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can recall this message');
    }

    if (message.status === MessageStatus.RECALLED) {
      throw new BadRequestException('Message has already been recalled');
    }

    if (Date.now() - message.createdAt.getTime() > MESSAGE_RECALL_WINDOW_MS) {
      throw new BadRequestException('Message recall window has expired');
    }

    const recalledAt = new Date();
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.RECALLED,
        recalledAt,
      },
    });

    return {
      conversationId: message.conversationId,
      messageId: message.id,
      senderId: message.senderId,
      recalledAt,
    };
  }

  async editMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    encryptedPayload: EditMessageInput,
  ): Promise<EditedEventPayload> {
    this.assertEncryptedPayload(encryptedPayload);
    await this.assertConversationMember(userId, conversationId);

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        status: true,
        createdAt: true,
      },
    });

    if (!message) {
      throw new BadRequestException('Message does not belong to this conversation');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can edit this message');
    }

    if (message.status === MessageStatus.RECALLED) {
      throw new BadRequestException('Recalled messages cannot be edited');
    }

    if (Date.now() - message.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
      throw new BadRequestException('Message edit window has expired');
    }

    const editedAt = new Date();
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        ciphertext: encryptedPayload.ciphertext,
        nonce: encryptedPayload.nonce,
        encryptionVersion: encryptedPayload.encryptionVersion,
        editedAt,
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        ciphertext: true,
        nonce: true,
        encryptionVersion: true,
        editedAt: true,
      },
    });

    return {
      conversationId: updated.conversationId,
      messageId: updated.id,
      senderId: updated.senderId,
      ciphertext: updated.ciphertext,
      nonce: updated.nonce,
      encryptionVersion: updated.encryptionVersion,
      editedAt: updated.editedAt ?? editedAt,
    };
  }

  async listUndeliveredMessages(userId: string): Promise<MessageEventPayload[]> {
    const deliveries = await this.prisma.messageDelivery.findMany({
      where: {
        receiverId: userId,
        deliveredAt: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        message: {
          select: this.messageSelect(),
        },
      },
    });

    return deliveries.map((delivery) => this.toMessageEventPayload(delivery.message));
  }

  async getConversationPeerIds(conversationId: string, userId: string): Promise<string[]> {
    const members = await this.getConversationMembers(conversationId);
    if (!members.some((member) => member.userId === userId)) {
      throw new ForbiddenException('Conversation is not accessible');
    }

    return members
      .map((member) => member.userId)
      .filter((memberUserId) => memberUserId !== userId);
  }

  private assertMessageInput(input: SendTextMessageInput): void {
    if (
      input.messageType !== MessageType.TEXT &&
      input.messageType !== MessageType.IMAGE &&
      input.messageType !== MessageType.FILE
    ) {
      throw new BadRequestException('Unsupported message type');
    }

    if (input.messageType === MessageType.TEXT && input.fileId) {
      throw new BadRequestException('TEXT messages cannot include a file');
    }

    if (input.messageType !== MessageType.TEXT && !input.fileId?.trim()) {
      throw new BadRequestException('File message requires fileId');
    }

    this.assertEncryptedPayload(input);
  }

  private assertEncryptedPayload(input: EditMessageInput): void {
    if (!input.ciphertext.trim() || !input.nonce.trim() || !input.encryptionVersion.trim()) {
      throw new BadRequestException('Encrypted message payload is required');
    }
  }

  private async getConversationMembers(conversationId: string): Promise<Array<{ userId: string }>> {
    return this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
  }

  private async assertConversationMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      select: { id: true },
    });

    if (!member) {
      throw new ForbiddenException('Conversation is not accessible');
    }
  }

  private async assertMessageInConversation(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
      },
      select: { id: true },
    });

    if (!message) {
      throw new BadRequestException('Reply target does not belong to this conversation');
    }
  }

  private async assertDirectFriendship(userId: string, peerId: string): Promise<void> {
    const [userAId, userBId] = this.normalizeUserPair(userId, peerId);
    const friendship = await this.prisma.friendship.findUnique({
      where: {
        userAId_userBId: {
          userAId,
          userBId,
        },
      },
      select: { id: true },
    });

    if (!friendship) {
      throw new ForbiddenException('FRIENDSHIP_REQUIRED');
    }
  }

  private normalizeUserPair(userId: string, peerId: string): [string, string] {
    return userId < peerId ? [userId, peerId] : [peerId, userId];
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
      createdAt: true,
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

  private toMessageEventPayload(
    message: MessageWithSender,
    clientMessageId?: string,
  ): MessageEventPayload {
    return {
      messageId: message.id,
      clientMessageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageType: message.messageType,
      ciphertext: message.ciphertext,
      nonce: message.nonce,
      encryptionVersion: message.encryptionVersion,
      replyToMessageId: message.replyToMessageId,
      status: message.status,
      file: message.fileAsset ? this.toFileMetadataPayload(message.fileAsset) : null,
      createdAt: message.createdAt,
    };
  }

  private toFileMetadataPayload(file: MessageFileAssetRecord): MessageFileMetadataPayload {
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
}
