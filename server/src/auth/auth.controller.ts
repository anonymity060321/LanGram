import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { EmailCodeLoginDto } from './dto/email-code-login.dto';
import { GuestLoginDto } from './dto/guest-login.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { TemporaryRegisterDto } from './dto/temporary-register.dto';
import { TextCaptchaResponseDto } from './dto/text-captcha.dto';
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

  @Post('captcha/text')
  async createTextCaptcha(): Promise<TextCaptchaResponseDto> {
    return this.authService.createTextCaptcha();
  }

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<unknown> {
    return this.authService.register(dto);
  }

  @Post('register/temporary')
  async registerTemporary(@Body() dto: TemporaryRegisterDto): Promise<unknown> {
    return this.authService.registerTemporary(dto);
  }

  @Post('login/password')
  async loginWithPassword(@Body() dto: PasswordLoginDto, @Req() request: Request): Promise<unknown> {
    return this.authService.loginWithPassword(dto, request.ip, request.headers['user-agent']);
  }

  @Post('login/email-code')
  async loginWithEmailCode(
    @Body() dto: EmailCodeLoginDto,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.authService.loginWithEmailCode(dto, request.ip, request.headers['user-agent']);
  }

  /**
   * Deprecated compatibility endpoint. Client login UI will switch in a later phase.
   */
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
