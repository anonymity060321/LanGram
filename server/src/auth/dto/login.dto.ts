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

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code?: string;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
