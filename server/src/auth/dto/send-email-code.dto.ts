import { IsEmail, IsEnum } from 'class-validator';

export enum EmailCodePurposeDto {
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
}

export class SendEmailCodeDto {
  @IsEmail()
  email!: string;

  @IsEnum(EmailCodePurposeDto)
  purpose!: EmailCodePurposeDto;
}
