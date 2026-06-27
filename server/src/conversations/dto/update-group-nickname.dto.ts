import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupNicknameDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  groupNickname!: string | null;
}