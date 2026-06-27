import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';
import { REALTIME_EVENTS } from '../realtime/realtime.events';
import { RealtimeSessionService } from '../realtime/realtime-session.service';
import { ConversationsService, type GroupMemberRealtimeDto, type LeaveGroupResult } from './conversations.service';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { CreateGroupConversationDto } from './dto/create-group-conversation.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { UpdateGroupNicknameDto } from './dto/update-group-nickname.dto';
import { UpdateGroupRemarkDto } from './dto/update-group-remark.dto';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

interface ConversationMemberRealtimeDto {
  id: string;
  email: string | null;
  displayName: string | null;
  statusMessage?: string | null;
  avatarUrl?: string | null;
  accountType?: string;
  isOnline?: boolean;
  lastSeenAt?: Date | string | null;
  groupNickname?: string | null;
  groupRemark?: string | null;
}

interface ConversationRealtimeDto {
  id: string;
  members: ConversationMemberRealtimeDto[];
}

@UseGuards(AccessTokenGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly realtimeSessionService: RealtimeSessionService,
  ) {}

  @Get()
  async listConversations(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.conversationsService.listConversations(request.user.id);
  }

  @Post('direct')
  async createDirectConversation(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateDirectConversationDto,
  ): Promise<unknown> {
    return this.conversationsService.createDirectConversation(request.user.id, dto.friendUserId);
  }

  @Post('groups')
  async createGroupConversation(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateGroupConversationDto,
  ): Promise<unknown> {
    return this.conversationsService.createGroupConversation(
      request.user.id,
      dto.title,
      dto.memberUserIds,
    );
  }

  @Patch(':id/group-nickname')
  async updateGroupNickname(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() dto: UpdateGroupNicknameDto,
  ): Promise<unknown> {
    const conversation = await this.conversationsService.updateGroupNickname(
      request.user.id,
      conversationId,
      dto.groupNickname,
    );
    this.broadcastGroupMemberUpdated(conversation, request.user.id);
    return conversation;
  }

  private broadcastGroupMemberUpdated(conversation: unknown, userId: string): void {
    if (!isConversationRealtimeDto(conversation)) {
      return;
    }

    const member = conversation.members.find((item) => item.id === userId);
    if (!member) {
      return;
    }

    const payload = {
      conversationId: conversation.id,
      reason: 'group_member_updated' as const,
      member: toPublicConversationMember(member),
    };

    for (const activeMember of conversation.members) {
      this.realtimeSessionService
        .getSocket(activeMember.id)
        ?.emit(REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED, payload);
    }
  }

  @Patch(':id/group-remark')
  async updateGroupRemark(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() dto: UpdateGroupRemarkDto,
  ): Promise<unknown> {
    return this.conversationsService.updateGroupRemark(
      request.user.id,
      conversationId,
      dto.groupRemark,
    );
  }
  @Post(':id/leave')
  async leaveGroup(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ): Promise<unknown> {
    const result = await this.conversationsService.leaveGroup(request.user.id, conversationId);
    this.broadcastGroupMemberLeft(result);
    return { conversationId: result.conversationId, leftAt: result.leftAt };
  }

  private broadcastGroupMemberLeft(result: LeaveGroupResult): void {
    const payload = {
      conversationId: result.conversationId,
      reason: 'group_member_left' as const,
      member: toPublicConversationMember(result.member),
    };

    for (const memberId of result.remainingMemberIds) {
      this.realtimeSessionService
        .getSocket(memberId)
        ?.emit(REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED, payload);
    }
  }

  @Get(':id/messages')
  async listMessages(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<unknown> {
    return this.conversationsService.listMessages(request.user.id, conversationId, query);
  }

  @Post(':id/read')
  async markRead(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() dto: MarkConversationReadDto,
  ): Promise<unknown> {
    return this.conversationsService.markRead(request.user.id, conversationId, dto.messageId);
  }
}

function toPublicConversationMember(
  member: ConversationMemberRealtimeDto | GroupMemberRealtimeDto,
): Omit<ConversationMemberRealtimeDto | GroupMemberRealtimeDto, 'groupRemark'> {
  const publicMember = { ...member };
  delete publicMember.groupRemark;
  return publicMember;
}
function isConversationRealtimeDto(value: unknown): value is ConversationRealtimeDto {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const conversation = value as { id?: unknown; members?: unknown };
  return typeof conversation.id === 'string' && Array.isArray(conversation.members);
}







