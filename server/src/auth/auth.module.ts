import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, EmailService, AccessTokenGuard],
  exports: [AuthService, AccessTokenGuard, JwtModule],
})
export class AuthModule {}
