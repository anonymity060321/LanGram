import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'crypto';
import { EmailService } from './email.service';
import { GuestLoginDto } from './dto/guest-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailCodePurposeDto, SendEmailCodeDto } from './dto/send-email-code.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const HASH_ROUNDS = 12;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

interface AuthResult extends TokenPair {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    accountType: string;
  };
}

interface DeviceInput {
  deviceIdentifier: string;
  name?: string;
  platform?: string;
}

interface JwtPayload {
  sub: string;
  sessionId: string;
  accountType: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
  ) {}

  async sendEmailCode(dto: SendEmailCodeDto): Promise<void> {
    const email = dto.email.toLowerCase();
    const resendSeconds = this.getNumberConfig('EMAIL_CODE_RESEND_SECONDS');
    const latestCode = await this.prisma.emailVerificationCode.findFirst({
      where: { email, purpose: dto.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (latestCode && Date.now() - latestCode.createdAt.getTime() < resendSeconds * 1000) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, HASH_ROUNDS);
    const ttlMinutes = this.getNumberConfig('EMAIL_CODE_TTL_MINUTES');

    await this.prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash,
        purpose: dto.purpose,
        expiresAt: this.addMinutes(new Date(), ttlMinutes),
      },
    });

    await this.emailService.sendVerificationCode(email, code);
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    await this.consumeEmailCode(email, EmailCodePurposeDto.REGISTER, dto.code);
    const passwordHash = await bcrypt.hash(dto.password, HASH_ROUNDS);
    const displayName = dto.displayName?.trim() || email.split('@')[0];

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        accountType: 'EMAIL',
      },
    });

    return this.issueSession(user, dto.device);
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.accountType !== 'EMAIL') {
      await this.writeLoginLog(false, { email, reason: 'USER_NOT_FOUND', ipAddress, userAgent });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      await this.writeLoginLog(false, {
        userId: user.id,
        email,
        reason: 'USER_DISABLED',
        ipAddress,
        userAgent,
      });
      throw new ForbiddenException('User is disabled');
    }

    if (dto.code) {
      await this.consumeEmailCode(email, EmailCodePurposeDto.LOGIN, dto.code);
    } else if (dto.password && user.passwordHash) {
      const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
      if (!passwordMatches) {
        await this.writeLoginLog(false, {
          userId: user.id,
          email,
          reason: 'BAD_PASSWORD',
          ipAddress,
          userAgent,
        });
        throw new UnauthorizedException('Invalid credentials');
      }
    } else {
      throw new BadRequestException('Password or email verification code is required');
    }

    const result = await this.issueSession(user, dto.device);
    await this.writeLoginLog(true, {
      userId: user.id,
      email,
      deviceIdentifier: dto.device.deviceIdentifier,
      ipAddress,
      userAgent,
    });

    return result;
  }

  async guestLogin(
    dto: GuestLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    if (!this.getBooleanConfig('GUEST_LOGIN_ENABLED')) {
      throw new ForbiddenException('Guest login is disabled');
    }

    const displayName = dto.displayName?.trim() || 'Guest';
    const user = await this.prisma.user.create({
      data: {
        displayName,
        accountType: 'GUEST',
      },
    });

    const result = await this.issueSession(user, dto.device);
    await this.writeLoginLog(true, {
      userId: user.id,
      deviceIdentifier: dto.device.deviceIdentifier,
      ipAddress,
      userAgent,
    });

    return result;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const parsed = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: {
        id: parsed.sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!session || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenMatches = await bcrypt.compare(parsed.secret, session.refreshTokenHash);
    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newSecret = this.createTokenSecret();
    const refreshTokenHash = await bcrypt.hash(newSecret, HASH_ROUNDS);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = await this.signAccessToken({
      sub: session.userId,
      sessionId: session.id,
      accountType: session.user.accountType,
    });

    return {
      accessToken,
      refreshToken: `${session.id}.${newSecret}`,
      expiresInSeconds: this.getNumberConfig('ACCESS_TOKEN_TTL_MINUTES') * 60,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getCurrentUser(userId: string): Promise<unknown> {
    const user = await this.usersService.findPublicById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { user };
  }

  private async consumeEmailCode(
    email: string,
    purpose: EmailCodePurposeDto,
    code: string,
  ): Promise<void> {
    const verification = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const matches = await bcrypt.compare(code, verification.codeHash);
    if (!matches) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.emailVerificationCode.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() },
    });
  }

  private async issueSession(
    user: { id: string; email: string | null; displayName: string; accountType: string },
    device: DeviceInput,
  ): Promise<AuthResult> {
    const refreshSecret = this.createTokenSecret();
    const refreshTokenHash = await bcrypt.hash(refreshSecret, HASH_ROUNDS);
    const refreshTokenTtlDays = this.getNumberConfig('REFRESH_TOKEN_TTL_DAYS');

    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const savedDevice = await this.prisma.device.upsert({
      where: {
        userId_deviceIdentifier: {
          userId: user.id,
          deviceIdentifier: device.deviceIdentifier,
        },
      },
      update: {
        name: device.name,
        platform: device.platform,
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        deviceIdentifier: device.deviceIdentifier,
        name: device.name,
        platform: device.platform,
        lastSeenAt: new Date(),
      },
    });

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        deviceId: savedDevice.id,
        refreshTokenHash,
        expiresAt: this.addDays(new Date(), refreshTokenTtlDays),
      },
    });

    const accessToken = await this.signAccessToken({
      sub: user.id,
      sessionId: session.id,
      accountType: user.accountType,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        accountType: user.accountType,
      },
      accessToken,
      refreshToken: `${session.id}.${refreshSecret}`,
      expiresInSeconds: this.getNumberConfig('ACCESS_TOKEN_TTL_MINUTES') * 60,
    };
  }

  private async signAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: `${this.getNumberConfig('ACCESS_TOKEN_TTL_MINUTES')}m`,
    });
  }

  private async writeLoginLog(
    success: boolean,
    data: {
      userId?: string;
      email?: string;
      deviceIdentifier?: string;
      reason?: string;
      ipAddress?: string;
      userAgent?: string | string[];
    },
  ): Promise<void> {
    await this.prisma.loginLog.create({
      data: {
        userId: data.userId,
        email: data.email,
        deviceIdentifier: data.deviceIdentifier,
        success,
        reason: data.reason,
        ipAddress: data.ipAddress,
        userAgent: Array.isArray(data.userAgent) ? data.userAgent.join(',') : data.userAgent,
      },
    });
  }

  private parseRefreshToken(refreshToken: string): { sessionId: string; secret: string } {
    const separatorIndex = refreshToken.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === refreshToken.length - 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      sessionId: refreshToken.slice(0, separatorIndex),
      secret: refreshToken.slice(separatorIndex + 1),
    };
  }

  private createTokenSecret(): string {
    return randomBytes(48).toString('base64url');
  }

  private addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private getNumberConfig(key: string): number {
    return Number(this.configService.getOrThrow<string | number>(key));
  }

  private getBooleanConfig(key: string): boolean {
    const value = this.configService.getOrThrow<string | boolean>(key);
    return value === true || value === 'true';
  }
}
