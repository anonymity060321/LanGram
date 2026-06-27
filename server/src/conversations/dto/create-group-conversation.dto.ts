import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateGroupConversationDto {
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  memberUserIds!: string[];
}
