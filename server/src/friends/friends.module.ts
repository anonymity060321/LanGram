import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [FriendsController],
  providers: [FriendsService],
})
export class FriendsModule {}
