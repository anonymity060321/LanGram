export type TextCaptchaType = 'ARITHMETIC' | 'TEXT';

export interface TextCaptchaResponseDto {
  captchaId: string;
  prompt: string;
  expiresInSeconds: number;
  captchaType: TextCaptchaType;
  imageDataUrl?: string;
}
