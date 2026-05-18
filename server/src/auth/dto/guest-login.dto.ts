import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { DeviceDto } from './device.dto';

export class GuestLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
