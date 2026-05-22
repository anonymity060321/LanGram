import { FileKind, FileStatus } from '@prisma/client';

export interface FileMetadataResponse {
  id: string;
  uploaderId: string;
  conversationId: string;
  messageId: string | null;
  kind: FileKind;
  originalName: string;
  safeName: string;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
  width: number | null;
  height: number | null;
  status: FileStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
