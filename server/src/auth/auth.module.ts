import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { AccessTokenGuard } from './guards/access-token.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, EmailService, AccessTokenGuard],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
