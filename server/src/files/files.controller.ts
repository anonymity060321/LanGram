import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';
import { FileMetadataResponse } from './dto/file-metadata.dto';
import { FilesService } from './files.service';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@UseGuards(AccessTokenGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':id')
  async getMetadata(
    @Req() request: AuthenticatedRequest,
    @Param('id') fileId: string,
  ): Promise<FileMetadataResponse> {
    return this.filesService.getFileMetadata(request.user.id, fileId);
  }
}
