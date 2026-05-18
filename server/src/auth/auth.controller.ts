import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { GuestLoginDto } from './dto/guest-login.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AuthenticatedUser } from '../common/current-user';

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/code')
  async sendEmailCode(@Body() dto: SendEmailCodeDto): Promise<{ sent: true }> {
    await this.authService.sendEmailCode(dto);
    return { sent: true };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<unknown> {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<unknown> {
    return this.authService.login(dto, request.ip, request.headers['user-agent']);
  }

  @Post('guest')
  async guestLogin(@Body() dto: GuestLoginDto, @Req() request: Request): Promise<unknown> {
    return this.authService.guestLogin(dto, request.ip, request.headers['user-agent']);
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<unknown> {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(AccessTokenGuard)
  @Post('logout')
  async logout(@Req() request: AuthenticatedRequest): Promise<{ loggedOut: true }> {
    await this.authService.logout(request.user.sessionId);
    return { loggedOut: true };
  }

  @UseGuards(AccessTokenGuard)
  @Get('me')
  async getCurrentUser(@Req() request: AuthenticatedRequest): Promise<unknown> {
    return this.authService.getCurrentUser(request.user.id);
  }
}
