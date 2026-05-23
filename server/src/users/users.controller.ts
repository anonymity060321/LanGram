import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UploadedAvatarFile, UsersService } from './users.service';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const TEMP_AVATAR_DIR = join(tmpdir(), 'langram-avatars');
mkdirSync(TEMP_AVATAR_DIR, { recursive: true });

@UseGuards(AccessTokenGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.usersService.getMe(request.user.id);
  }

  @Patch('me/profile')
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<unknown> {
    return this.usersService.updateProfile(request.user.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      dest: TEMP_AVATAR_DIR,
      limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
    }),
  )
  uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedAvatarFile,
  ): Promise<unknown> {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    return this.usersService.saveAvatar(request.user.id, file);
  }

  @Get(':id/avatar')
  async getAvatar(
    @Param('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const avatar = await this.usersService.getAvatar(userId);

    response.setHeader('Content-Type', avatar.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(avatar.stream);
  }
}
