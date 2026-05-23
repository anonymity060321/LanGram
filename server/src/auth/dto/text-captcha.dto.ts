export interface TextCaptchaResponseDto {
  captchaId: string;
  prompt: string;
  expiresInSeconds: number;
}
