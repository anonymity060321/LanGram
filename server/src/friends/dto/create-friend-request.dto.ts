import { IsString, Length, Matches } from 'class-validator';

export class CreateFriendRequestDto {
  @IsString()
  @Length(6, 12)
  @Matches(/^[0-9]+$/)
  pairingCode!: string;
}
