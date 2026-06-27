import blankIconUrl from 'file-icon-vectors/dist/icons/vivid/blank.svg?url';
import csvIconUrl from 'file-icon-vectors/dist/icons/vivid/csv.svg?url';
import docIconUrl from 'file-icon-vectors/dist/icons/vivid/doc.svg?url';
import docxIconUrl from 'file-icon-vectors/dist/icons/vivid/docx.svg?url';
import gifIconUrl from 'file-icon-vectors/dist/icons/vivid/gif.svg?url';
import imageIconUrl from 'file-icon-vectors/dist/icons/vivid/image.svg?url';
import jpgIconUrl from 'file-icon-vectors/dist/icons/vivid/jpg.svg?url';
import pdfIconUrl from 'file-icon-vectors/dist/icons/vivid/pdf.svg?url';
import pngIconUrl from 'file-icon-vectors/dist/icons/vivid/png.svg?url';
import pptIconUrl from 'file-icon-vectors/dist/icons/vivid/ppt.svg?url';
import pptxIconUrl from 'file-icon-vectors/dist/icons/vivid/pptx.svg?url';
import rarIconUrl from 'file-icon-vectors/dist/icons/vivid/rar.svg?url';
import txtIconUrl from 'file-icon-vectors/dist/icons/vivid/txt.svg?url';
import webpIconUrl from 'file-icon-vectors/dist/icons/vivid/webp.svg?url';
import xlsIconUrl from 'file-icon-vectors/dist/icons/vivid/xls.svg?url';
import xlsxIconUrl from 'file-icon-vectors/dist/icons/vivid/xlsx.svg?url';
import zipIconUrl from 'file-icon-vectors/dist/icons/vivid/zip.svg?url';
import sevenZipIconUrl from 'file-icon-vectors/dist/icons/vivid/7z.svg?url';

export type FileIconDescriptor = {
  src: string;
  label: string;
  extension: string;
};

const extensionIconMap: Record<string, FileIconDescriptor> = {
  pdf: { src: pdfIconUrl, label: 'PDF', extension: 'pdf' },
  doc: { src: docIconUrl, label: 'DOC', extension: 'doc' },
  docx: { src: docxIconUrl, label: 'DOCX', extension: 'docx' },
  xls: { src: xlsIconUrl, label: 'XLS', extension: 'xls' },
  xlsx: { src: xlsxIconUrl, label: 'XLSX', extension: 'xlsx' },
  ppt: { src: pptIconUrl, label: 'PPT', extension: 'ppt' },
  pptx: { src: pptxIconUrl, label: 'PPTX', extension: 'pptx' },
  txt: { src: txtIconUrl, label: 'TXT', extension: 'txt' },
  csv: { src: csvIconUrl, label: 'CSV', extension: 'csv' },
  zip: { src: zipIconUrl, label: 'ZIP', extension: 'zip' },
  rar: { src: rarIconUrl, label: 'RAR', extension: 'rar' },
  '7z': { src: sevenZipIconUrl, label: '7Z', extension: '7z' },
  jpg: { src: jpgIconUrl, label: 'JPG', extension: 'jpg' },
  jpeg: { src: jpgIconUrl, label: 'JPEG', extension: 'jpeg' },
  png: { src: pngIconUrl, label: 'PNG', extension: 'png' },
  webp: { src: webpIconUrl, label: 'WEBP', extension: 'webp' },
  gif: { src: gifIconUrl, label: 'GIF', extension: 'gif' },
};

const mimeExtensionMap: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const genericIcon: FileIconDescriptor = {
  src: blankIconUrl,
  label: 'FILE',
  extension: 'generic',
};

const imageFallbackIcon: FileIconDescriptor = {
  src: imageIconUrl,
  label: 'IMAGE',
  extension: 'image',
};

export function getFileIconByName(
  fileName?: string | null,
  mimeType?: string | null,
): FileIconDescriptor {
  const extensionIcon = getFileIconByExtension(extractFileExtension(fileName));
  if (extensionIcon !== genericIcon) {
    return extensionIcon;
  }

  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? '';
  if (normalizedMimeType.startsWith('image/')) {
    return imageFallbackIcon;
  }

  const extension = mimeExtensionMap[normalizedMimeType];
  return getFileIconByExtension(extension);
}

export function getFileIconByExtension(extension?: string | null): FileIconDescriptor {
  const normalizedExtension = extension?.trim().toLowerCase().replace(/^\./, '') ?? '';
  return extensionIconMap[normalizedExtension] ?? genericIcon;
}

function extractFileExtension(fileName?: string | null): string | null {
  const normalizedFileName = fileName?.trim() ?? '';
  const lastDotIndex = normalizedFileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === normalizedFileName.length - 1) {
    return null;
  }

  return normalizedFileName.slice(lastDotIndex + 1);
}