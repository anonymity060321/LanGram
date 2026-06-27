import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';
import { ConversationsService } from './conversations.service';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { CreateGroupConversationDto } from './dto/create-group-conversation.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { UpdateGroupNicknameDto } from './dto/update-group-nickname.dto';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@UseGuards(AccessTokenGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

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
    return this.conversationsService.updateGroupNickname(
      request.user.id,
      conversationId,
      dto.groupNickname,
    );
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
