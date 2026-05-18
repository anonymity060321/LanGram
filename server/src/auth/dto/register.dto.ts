import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeviceDto } from './device.dto';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
