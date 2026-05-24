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
import { randomBytes, randomInt } from 'crypto';
import { compareAuthSecret, hashAuthSecret } from './auth-hash';
import { EmailService } from './email.service';
import { EmailCodeLoginDto } from './dto/email-code-login.dto';
import { GuestLoginDto } from './dto/guest-login.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailCodePurposeDto, SendEmailCodeDto } from './dto/send-email-code.dto';
import { TextCaptchaResponseDto } from './dto/text-captcha.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

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
    statusMessage: string | null;
    avatarUrl: string | null;
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

const TEXT_CAPTCHA_TTL_SECONDS = 120;
const TEXT_CAPTCHA_MAX_ATTEMPTS = 3;
const TEXT_CAPTCHA_PURPOSE_LOGIN = 'LOGIN';
const TEXT_CAPTCHA_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type TextCaptchaKind = 'arithmetic' | 'code';
type ArithmeticCaptchaOperation = 'add' | 'subtract' | 'multiply' | 'divide';
type CaptchaRandomInt = (min: number, max: number) => number;

interface TextCaptchaChallenge {
  prompt: string;
  answer: string;
  kind: TextCaptchaKind;
}

export function createTextCaptchaChallenge(rng: CaptchaRandomInt = randomInt): TextCaptchaChallenge {
  return rng(0, 2) === 0 ? createArithmeticCaptcha(rng) : createCodeCaptcha(rng);
}

export function normalizeTextCaptchaAnswer(answer: string): string {
  return answer.trim().toUpperCase();
}

function createArithmeticCaptcha(rng: CaptchaRandomInt): TextCaptchaChallenge {
  const operation = getArithmeticOperation(rng(0, 4));

  switch (operation) {
    case 'add': {
      const left = rng(2, 19);
      const right = rng(2, 19);
      return {
        kind: 'arithmetic',
        prompt: `${left} + ${right} = ?`,
        answer: String(left + right),
      };
    }
    case 'subtract': {
      const first = rng(2, 20);
      const second = rng(2, 20);
      const left = Math.max(first, second);
      const right = Math.min(first, second);
      return {
        kind: 'arithmetic',
        prompt: `${left} - ${right} = ?`,
        answer: String(left - right),
      };
    }
    case 'multiply': {
      const left = rng(2, 10);
      const right = rng(2, 10);
      return {
        kind: 'arithmetic',
        prompt: `${left} × ${right} = ?`,
        answer: String(left * right),
      };
    }
    case 'divide': {
      const divisor = rng(2, 10);
      const quotient = rng(2, 10);
      return {
        kind: 'arithmetic',
        prompt: `${divisor * quotient} ÷ ${divisor} = ?`,
        answer: String(quotient),
      };
    }
    default:
      return assertNever(operation);
  }
}

function createCodeCaptcha(rng: CaptchaRandomInt): TextCaptchaChallenge {
  const length = rng(5, 7);
  let answer = '';
  for (let index = 0; index < length; index += 1) {
    answer += TEXT_CAPTCHA_CHARSET[rng(0, TEXT_CAPTCHA_CHARSET.length)];
  }

  return {
    kind: 'code',
    prompt: `输入验证码：${answer}`,
    answer,
  };
}

function getArithmeticOperation(value: number): ArithmeticCaptchaOperation {
  const operations: ArithmeticCaptchaOperation[] = ['add', 'subtract', 'multiply', 'divide'];
  return operations[value] ?? 'add';
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
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
    const codeHash = await hashAuthSecret(code);
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

  async createTextCaptcha(): Promise<TextCaptchaResponseDto> {
    const captcha = createTextCaptchaChallenge();
    const challenge = await this.prisma.authCaptchaChallenge.create({
      data: {
        answerHash: await hashAuthSecret(normalizeTextCaptchaAnswer(captcha.answer)),
        purpose: TEXT_CAPTCHA_PURPOSE_LOGIN,
        expiresAt: new Date(Date.now() + TEXT_CAPTCHA_TTL_SECONDS * 1000),
      },
    });

    return {
      captchaId: challenge.id,
      prompt: captcha.prompt,
      expiresInSeconds: TEXT_CAPTCHA_TTL_SECONDS,
    };
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    await this.consumeEmailCode(email, EmailCodePurposeDto.REGISTER, dto.code);
    const passwordHash = await hashAuthSecret(dto.password);
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

  async loginWithPassword(
    dto: PasswordLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    const email = this.normalizePasswordLoginIdentifier(dto);

    await this.consumeTextCaptcha(dto.captchaId, dto.captchaAnswer);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.accountType !== 'EMAIL' || user.status !== 'ACTIVE' || !user.passwordHash) {
      await this.writeLoginLog(false, { email, reason: 'INVALID_CREDENTIALS', ipAddress, userAgent });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await compareAuthSecret(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.writeLoginLog(false, {
        userId: user.id,
        email,
        reason: 'INVALID_CREDENTIALS',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
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

  async loginWithEmailCode(
    dto: EmailCodeLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.accountType !== 'EMAIL' || user.status !== 'ACTIVE') {
      await this.writeLoginLog(false, { email, reason: 'INVALID_CREDENTIALS', ipAddress, userAgent });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.consumeEmailCode(email, EmailCodePurposeDto.LOGIN, dto.code);

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

  /**
   * Deprecated compatibility path. New clients should call loginWithPassword or loginWithEmailCode.
   */
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
      const passwordMatches = await compareAuthSecret(dto.password, user.passwordHash);
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

    const tokenMatches = await compareAuthSecret(parsed.secret, session.refreshTokenHash);
    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newSecret = this.createTokenSecret();
    const refreshTokenHash = await hashAuthSecret(newSecret);
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

  private normalizePasswordLoginIdentifier(dto: PasswordLoginDto): string {
    const rawIdentifier = dto.email ?? dto.identifier;
    if (!rawIdentifier || !rawIdentifier.includes('@')) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return rawIdentifier.toLowerCase();
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

    const matches = await compareAuthSecret(code, verification.codeHash);
    if (!matches) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.emailVerificationCode.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() },
    });
  }

  private async consumeTextCaptcha(captchaId: string, answer: string): Promise<void> {
    const challenge = await this.prisma.authCaptchaChallenge.findUnique({
      where: { id: captchaId },
    });

    if (
      !challenge ||
      challenge.purpose !== TEXT_CAPTCHA_PURPOSE_LOGIN ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attemptCount >= TEXT_CAPTCHA_MAX_ATTEMPTS
    ) {
      throw new BadRequestException('Invalid or expired captcha');
    }

    const nextAttemptCount = challenge.attemptCount + 1;
    const matches = await compareAuthSecret(
      normalizeTextCaptchaAnswer(answer),
      challenge.answerHash,
    );
    if (!matches) {
      await this.prisma.authCaptchaChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: nextAttemptCount },
      });
      throw new BadRequestException('Invalid or expired captcha');
    }

    await this.prisma.authCaptchaChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: nextAttemptCount,
        consumedAt: new Date(),
      },
    });
  }

  private async issueSession(
    user: {
      id: string;
      email: string | null;
      displayName: string;
      statusMessage?: string | null;
      avatarStoragePath?: string | null;
      accountType: string;
    },
    device: DeviceInput,
  ): Promise<AuthResult> {
    const refreshSecret = this.createTokenSecret();
    const refreshTokenHash = await hashAuthSecret(refreshSecret);
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
        statusMessage: user.statusMessage ?? null,
        avatarUrl: user.avatarStoragePath ? `/api/users/${user.id}/avatar` : null,
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
