import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common/current-user';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { FriendsService } from './friends.service';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@UseGuards(AccessTokenGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('pairing-code')
  async createPairingCode(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.friendsService.createPairingCode(request.user.id);
  }

  @Post('requests')
  async createRequest(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<unknown> {
    return this.friendsService.createRequest(request.user.id, dto.pairingCode);
  }

  @Get('requests')
  async listRequests(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.friendsService.listRequests(request.user.id);
  }

  @Delete('requests')
  async clearRequests(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.friendsService.clearRequestHistory(request.user.id);
  }

  @Post('requests/:id/accept')
  async acceptRequest(
    @Req() request: AuthenticatedRequest,
    @Param('id') requestId: string,
  ): Promise<unknown> {
    return this.friendsService.acceptRequest(request.user.id, requestId);
  }

  @Post('requests/:id/reject')
  async rejectRequest(
    @Req() request: AuthenticatedRequest,
    @Param('id') requestId: string,
  ): Promise<unknown> {
    return this.friendsService.rejectRequest(request.user.id, requestId);
  }

  @Get()
  async listFriends(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.friendsService.listFriends(request.user.id);
  }

  @Delete(':id')
  async deleteFriend(
    @Req() request: AuthenticatedRequest,
    @Param('id') friendshipId: string,
  ): Promise<unknown> {
    return this.friendsService.deleteFriend(request.user.id, friendshipId);
  }
}
