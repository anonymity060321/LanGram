export interface ImageUploadFile {
  file: File;
  width: number;
  height: number;
  compressed: boolean;
}

const MAX_IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.82;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isCompressibleImage(file: File): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
}

export async function prepareImageUploadFile(
  file: File,
  sendOriginal: boolean,
): Promise<ImageUploadFile> {
  const bitmap = await createImageBitmap(file);
  try {
    if (sendOriginal) {
      return {
        file,
        width: bitmap.width,
        height: bitmap.height,
        compressed: false,
      };
    }

    const dimensions = fitWithinMaxEdge(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas is not available');
    }

    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    const targetMimeType = file.type.toLowerCase() === 'image/png' ? 'image/webp' : file.type;
    const blob = await canvasToBlob(canvas, targetMimeType, IMAGE_QUALITY);
    const canUseCompressed =
      blob.type === targetMimeType &&
      blob.size > 0 &&
      blob.size < file.size &&
      SUPPORTED_IMAGE_MIME_TYPES.has(blob.type);

    if (!canUseCompressed) {
      return {
        file,
        width: bitmap.width,
        height: bitmap.height,
        compressed: false,
      };
    }

    return {
      file: new File([blob], renameForMimeType(file.name, blob.type), {
        type: blob.type,
        lastModified: Date.now(),
      }),
      width: dimensions.width,
      height: dimensions.height,
      compressed: true,
    };
  } finally {
    bitmap.close();
  }
}

function fitWithinMaxEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Image compression failed'));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function renameForMimeType(fileName: string, mimeType: string): string {
  const extension = mimeTypeToExtension(mimeType);
  const safeBaseName = (fileName.split(/[\\/]/).pop() ?? 'image')
    .replace(/\.[^.]*$/, '')
    .replace(/[\r\n]/g, '')
    .trim();

  return `${safeBaseName || 'image'}${extension}`;
}

function mimeTypeToExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }
  if (mimeType === 'image/png') {
    return '.png';
  }

  return '.webp';
}
