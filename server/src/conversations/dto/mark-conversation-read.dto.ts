import { IsUUID } from 'class-validator';

export class MarkConversationReadDto {
  @IsUUID()
  messageId!: string;
}
