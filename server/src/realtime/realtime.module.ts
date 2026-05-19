import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagesModule } from '../messages/messages.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({}), MessagesModule],
  providers: [RealtimeAuthService, RealtimeGateway],
})
export class RealtimeModule {}
