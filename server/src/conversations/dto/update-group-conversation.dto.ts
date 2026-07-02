import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  intro?: string | null;
}