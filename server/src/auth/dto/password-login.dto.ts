import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeviceDto } from './device.dto';

export class PasswordLoginDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  identifier?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsUUID()
  captchaId!: string;

  @IsString()
  @MaxLength(32)
  captchaAnswer!: string;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
