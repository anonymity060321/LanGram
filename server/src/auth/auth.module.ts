import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { TemporaryUsersCleanupService } from './temporary-users-cleanup.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [JwtModule.register({}), UsersModule, RealtimeModule],
  controllers: [AuthController],
  providers: [AuthService, EmailService, AccessTokenGuard, TemporaryUsersCleanupService],
  exports: [AuthService, AccessTokenGuard, JwtModule],
})
export class AuthModule {}
