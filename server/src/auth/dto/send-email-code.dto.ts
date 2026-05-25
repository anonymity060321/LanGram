import { IsEmail, IsEnum, MaxLength } from 'class-validator';

export enum EmailCodePurposeDto {
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
}

export class SendEmailCodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(EmailCodePurposeDto)
  purpose!: EmailCodePurposeDto;
}
