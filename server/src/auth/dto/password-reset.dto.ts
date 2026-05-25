import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordResetCodeDto {
  @IsEmail()
  email!: string;
}

export class PasswordResetDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
