import { IsUUID } from 'class-validator';

export class ForwardFileDto {
  @IsUUID()
  targetConversationId!: string;
}
