import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  constructor(private readonly configService: ConfigService) {}

  async sendVerificationCode(email: string, code: string): Promise<void> {
    const ttlMinutes = this.configService.getOrThrow<string | number>('EMAIL_CODE_TTL_MINUTES');
    const transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.configService.getOrThrow<string | number>('SMTP_PORT')),
      secure: Number(this.configService.getOrThrow<string | number>('SMTP_PORT')) === 465,
      auth: {
        user: this.configService.getOrThrow<string>('SMTP_USER'),
        pass: this.configService.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });

    await transporter.sendMail({
      from: this.configService.getOrThrow<string>('SMTP_FROM'),
      to: email,
      subject: 'LanGram verification code',
      text: `Your LanGram verification code is ${code}. It expires in ${ttlMinutes} minutes.`,
      html: `<p>Your LanGram verification code expires in ${ttlMinutes} minutes.</p><p><strong>${code}</strong></p>`,
    });
  }
}
