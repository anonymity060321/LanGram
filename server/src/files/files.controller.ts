import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';
import { FileMetadataResponse } from './dto/file-metadata.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { FilesService, UploadedDiskFile } from './files.service';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const TEMP_UPLOAD_DIR = join(tmpdir(), 'langram-uploads');
mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

@UseGuards(AccessTokenGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: TEMP_UPLOAD_DIR,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UploadFileDto,
    @UploadedFile() file?: UploadedDiskFile,
  ): Promise<FileMetadataResponse> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.filesService.saveUploadedFile({
      userId: request.user.id,
      conversationId: dto.conversationId,
      kind: dto.kind,
      file,
      width: dto.width ?? null,
      height: dto.height ?? null,
    });
  }

  @Get(':id')
  async getMetadata(
    @Req() request: AuthenticatedRequest,
    @Param('id') fileId: string,
  ): Promise<FileMetadataResponse> {
    return this.filesService.getFileMetadata(request.user.id, fileId);
  }
}
