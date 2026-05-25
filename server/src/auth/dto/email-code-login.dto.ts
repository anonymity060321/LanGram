import { Type } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { DeviceDto } from './device.dto';

export class EmailCodeLoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @ValidateNested()
  @Type(() => DeviceDto)
  device!: DeviceDto;
}
