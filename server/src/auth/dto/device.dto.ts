import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DeviceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  deviceIdentifier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;
}
