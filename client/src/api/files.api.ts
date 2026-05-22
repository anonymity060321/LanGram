import { apiRequest } from './http';

export type FileKind = 'IMAGE' | 'FILE';
export type FileStatus = 'UPLOADED' | 'ATTACHED' | 'DELETED';

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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UploadFileParams {
  file: File;
  conversationId: string;
  kind: FileKind;
  width?: number;
  height?: number;
}

export function uploadFile(params: UploadFileParams): Promise<FileMetadataResponse> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('conversationId', params.conversationId);
  formData.append('kind', params.kind);

  if (params.width !== undefined) {
    formData.append('width', String(params.width));
  }
  if (params.height !== undefined) {
    formData.append('height', String(params.height));
  }

  return apiRequest('/files/upload', {
    method: 'POST',
    body: formData,
  });
}
