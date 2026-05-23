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
import { FileMetadataResponse } from './dto/file-metadata.dto';
import { ForwardFileDto } from './dto/forward-file.dto';
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

  @Post(':id/forward')
  async forward(
    @Req() request: AuthenticatedRequest,
    @Param('id') fileId: string,
    @Body() dto: ForwardFileDto,
  ): Promise<FileMetadataResponse> {
    return this.filesService.forwardFileAsset({
      userId: request.user.id,
      sourceFileId: fileId,
      targetConversationId: dto.targetConversationId,
    });
  }

  @Get(':id/download')
  async download(
    @Req() request: AuthenticatedRequest,
    @Param('id') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.getDownloadFile(request.user.id, fileId);

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Content-Disposition', buildAttachmentDisposition(file.originalName));
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(file.stream);
  }
}

function buildAttachmentDisposition(originalName: string): string {
  const fallbackName = originalName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim()
    .slice(0, 180);
  const quotedFallback = (fallbackName || 'file').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `attachment; filename="${quotedFallback}"; filename*=UTF-8''${encodeRFC5987ValueChars(
    originalName,
  )}`;
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
