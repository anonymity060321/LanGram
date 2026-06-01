import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import {
  AuthService,
  createTextCaptchaChallenge,
  normalizeTextCaptchaAnswer,
} from './auth.service';
import { EmailService } from './email.service';
import { EmailCodePurposeDto } from './dto/send-email-code.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeSessionService } from '../realtime/realtime-session.service';
import { UsersService } from '../users/users.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  emailVerificationCode: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  authCaptchaChallenge: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  user: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  session: {
    updateMany: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  device: {
    upsert: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  loginLog: {
    create: MockFunction<(args: unknown) => Promise<unknown>>;
  };
}

function createMockPrisma(): MockPrisma {
  return {
    emailVerificationCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authCaptchaChallenge: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    device: {
      upsert: jest.fn(),
    },
    loginLog: {
      create: jest.fn(),
    },
  };
}

function createConfigService(): ConfigService {
  const values = new Map<string, string>([
    ['EMAIL_CODE_TTL_MINUTES', '5'],
    ['EMAIL_CODE_RESEND_SECONDS', '60'],
    ['ACCESS_TOKEN_TTL_MINUTES', '15'],
    ['REFRESH_TOKEN_TTL_DAYS', '30'],
    ['JWT_ACCESS_SECRET', 'test-access-secret'],
    ['GUEST_LOGIN_ENABLED', 'true'],
  ]);

  return {
    getOrThrow: (key: string) => {
      const value = values.get(key);
      if (!value) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    },
  } as ConfigService;
}

function createService(prisma: MockPrisma): {
  service: AuthService;
  emailService: {
    sendVerificationCode: jest.MockedFunction<(email: string, code: string) => Promise<void>>;
  };
  realtimeSessionService: {
    kickUser: jest.MockedFunction<(userId: string, payload: { reason: 'new_device_login' }) => void>;
  };
} {
  const jwtService = {
    signAsync: jest.fn(async () => 'access-token'),
  } as unknown as JwtService;
  const sendVerificationCode: jest.MockedFunction<(email: string, code: string) => Promise<void>> =
    jest.fn<Promise<void>, [string, string]>(async (): Promise<void> => undefined);
  const emailService = {
    sendVerificationCode,
  };
  const usersService = {
    findPublicById: jest.fn(),
  } as unknown as UsersService;
  const realtimeSessionService = {
    kickUser: jest.fn(),
  };

  return {
    service: new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      createConfigService(),
      emailService as unknown as EmailService,
      usersService,
      realtimeSessionService as unknown as RealtimeSessionService,
    ),
    emailService,
    realtimeSessionService,
  };
}

function createSequenceRandomInt(values: number[]): (min: number, max: number) => number {
  return (min: number, max: number): number => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error('Missing test random value');
    }
    if (value < min || value >= max) {
      throw new Error(`Test random value ${value} is outside [${min}, ${max})`);
    }
    return value;
  };
}

function decodeSvgDataUrl(dataUrl: string): string {
  const prefix = 'data:image/svg+xml;base64,';
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Expected SVG data URL');
  }

  return Buffer.from(dataUrl.slice(prefix.length), 'base64').toString('utf8');
}

function expectCaptchaSvgInterference(svg: string): void {
  expect(svg).toContain('<line ');
  expect(svg).toContain('class="captcha-noise"');
  expect(svg).toContain('<circle ');
}

async function expectPasswordLoginAcceptsCaptchaAnswer(
  captchaAnswer: string,
  submittedAnswer = captchaAnswer,
): Promise<void> {
  const prisma = createMockPrisma();
  const captchaHash = await bcrypt.hash(normalizeTextCaptchaAnswer(captchaAnswer), 4);
  const passwordHash = await bcrypt.hash('password123', 4);
  prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
    id: 'captcha-id',
    answerHash: captchaHash,
    purpose: 'LOGIN',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    attemptCount: 0,
  });
  prisma.authCaptchaChallenge.update.mockResolvedValue({});
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-id',
    email: 'user@example.com',
    passwordHash,
    displayName: 'User',
    accountType: 'EMAIL',
    status: 'ACTIVE',
  });
  prisma.session.updateMany.mockResolvedValue({ count: 1 });
  prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
  prisma.session.create.mockResolvedValue({ id: 'session-id' });
  prisma.loginLog.create.mockResolvedValue({});
  const { service } = createService(prisma);

  const result = await service.loginWithPassword({
    email: 'user@example.com',
    password: 'password123',
    captchaId: 'captcha-id',
    captchaAnswer: submittedAnswer,
    device: {
      deviceIdentifier: 'device-123456',
    },
  });

  expect(result.refreshToken).toMatch(/^session-id\./);
  expect(prisma.authCaptchaChallenge.update).toHaveBeenCalledWith({
    where: { id: 'captcha-id' },
    data: { attemptCount: 1, consumedAt: expect.any(Date) },
  });
}

describe('AuthService', () => {
  it('stores only hashed email verification codes', async () => {
    const prisma = createMockPrisma();
    prisma.emailVerificationCode.findFirst.mockResolvedValue(null);
    prisma.emailVerificationCode.create.mockResolvedValue({});
    const { service, emailService } = createService(prisma);

    await service.sendEmailCode({
      email: 'USER@Example.com',
      purpose: EmailCodePurposeDto.REGISTER,
    });

    const sentCode = emailService.sendVerificationCode.mock.calls[0][1];
    const createArgs = prisma.emailVerificationCode.create.mock.calls[0][0] as {
      data: { email: string; codeHash: string };
    };

    expect(createArgs.data.email).toBe('user@example.com');
    expect(createArgs.data.codeHash).not.toBe(sentCode);
    await expect(bcrypt.compare(sentCode, createArgs.data.codeHash)).resolves.toBe(true);
  });

  it('sends password reset codes only for active email users without exposing plaintext codes', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'hashed-password',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.emailVerificationCode.findFirst.mockResolvedValue(null);
    prisma.emailVerificationCode.create.mockResolvedValue({});
    const { service, emailService } = createService(prisma);

    await service.sendPasswordResetCode({ email: 'USER@example.com' });

    const sentCode = emailService.sendVerificationCode.mock.calls[0][1];
    const createArgs = prisma.emailVerificationCode.create.mock.calls[0][0] as {
      data: { email: string; codeHash: string; purpose: string };
    };
    expect(createArgs.data).toMatchObject({
      email: 'user@example.com',
      purpose: 'PASSWORD_RESET',
    });
    expect(createArgs.data.codeHash).not.toBe(sentCode);
    await expect(bcrypt.compare(sentCode, createArgs.data.codeHash)).resolves.toBe(true);
  });

  it('returns from password reset code requests for unknown emails without sending mail', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const { service, emailService } = createService(prisma);

    await service.sendPasswordResetCode({ email: 'missing@example.com' });

    expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    expect(prisma.emailVerificationCode.create).not.toHaveBeenCalled();
  });

  it('resets password with a valid password reset code and revokes active sessions', async () => {
    const prisma = createMockPrisma();
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'old-password-hash',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash,
      createdAt: new Date(),
    });
    prisma.emailVerificationCode.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.session.updateMany.mockResolvedValue({ count: 2 });
    const { service } = createService(prisma);

    await service.resetPassword({
      email: 'USER@example.com',
      code: '123456',
      newPassword: 'new-password123',
    });

    const updateArgs = prisma.user.update.mock.calls[0][0] as {
      where: { id: string };
      data: { passwordHash: string };
    };
    expect(updateArgs.where.id).toBe('user-id');
    expect(updateArgs.data.passwordHash).not.toBe('new-password123');
    await expect(bcrypt.compare('new-password123', updateArgs.data.passwordHash)).resolves.toBe(true);
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'code-id' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('uses a generic reset failure for invalid password reset codes', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'old-password-hash',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash: await bcrypt.hash('123456', 4),
      createdAt: new Date(),
    });
    const { service } = createService(prisma);

    await expect(
      service.resetPassword({
        email: 'user@example.com',
        code: '654321',
        newPassword: 'new-password123',
      }),
    ).rejects.toThrow('Email, code, or new password is invalid');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('registers an email user and revokes old active sessions before issuing a new one', async () => {
    const prisma = createMockPrisma();
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash,
      createdAt: new Date(),
    });
    prisma.emailVerificationCode.update.mockResolvedValue({});
    prisma.user.create.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      displayName: 'User',
      accountType: 'EMAIL',
    });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    const { service, realtimeSessionService } = createService(prisma);

    const result = await service.register({
      email: 'USER@example.com',
      password: 'password123',
      code: '123456',
      displayName: 'User',
      device: {
        deviceIdentifier: 'device-123456',
        name: 'Windows PC',
        platform: 'windows',
      },
    });

    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(realtimeSessionService.kickUser).toHaveBeenCalledWith('user-id', {
      reason: 'new_device_login',
    });
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'code-id' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('registers a temporary email user without consuming an email code', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'temp-user-id',
      email: 'temp@example.com',
      displayName: 'Temp',
      accountType: 'EMAIL',
      isTemporary: true,
    });
    prisma.session.updateMany.mockResolvedValue({ count: 0 });
    prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    const { service } = createService(prisma);

    const result = await service.registerTemporary({
      email: 'TEMP@example.com',
      password: 'password123',
      displayName: 'Temp',
      device: {
        deviceIdentifier: 'device-123456',
      },
    });

    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(prisma.emailVerificationCode.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'temp@example.com',
        passwordHash: expect.any(String),
        displayName: 'Temp',
        accountType: 'EMAIL',
        isTemporary: true,
      },
    });
  });

  it('rotates refresh token hashes without storing the plaintext token', async () => {
    const prisma = createMockPrisma();
    const refreshSecret = 'refresh-secret';
    const refreshTokenHash = await bcrypt.hash(refreshSecret, 4);
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-id',
      userId: 'user-id',
      refreshTokenHash,
      user: {
        status: 'ACTIVE',
        accountType: 'EMAIL',
      },
    });
    prisma.session.update.mockResolvedValue({});
    const { service } = createService(prisma);

    const result = await service.refresh(`session-id.${refreshSecret}`);
    const updateArgs = prisma.session.update.mock.calls[0][0] as {
      data: { refreshTokenHash: string };
    };

    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(updateArgs.data.refreshTokenHash).not.toBe(result.refreshToken);
    expect(updateArgs.data.refreshTokenHash).not.toContain(refreshSecret);
  });

  it('creates text captcha challenges without storing plaintext answers', async () => {
    const prisma = createMockPrisma();
    prisma.authCaptchaChallenge.create.mockResolvedValue({ id: 'captcha-id' });
    const { service } = createService(prisma);

    const result = await service.createTextCaptcha();
    const createArgs = prisma.authCaptchaChallenge.create.mock.calls[0][0] as {
      data: { answerHash: string; purpose: string; expiresAt: Date };
    };

    expect(result).toEqual({
      captchaId: 'captcha-id',
      prompt: expect.any(String),
      expiresInSeconds: 120,
      captchaType: expect.stringMatching(/^(ARITHMETIC|TEXT)$/),
      imageDataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(createArgs.data.purpose).toBe('LOGIN');
    expect(createArgs.data.answerHash).not.toContain(result.prompt);
  });

  it('generates and validates addition text captchas', async () => {
    const captcha = createTextCaptchaChallenge(createSequenceRandomInt([0, 0, 8, 6]));

    expect(captcha).toEqual({
      captchaType: 'ARITHMETIC',
      prompt: '8 + 6 = ?',
      answer: '14',
      imageDataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
    expectCaptchaSvgInterference(decodeSvgDataUrl(captcha.imageDataUrl));
    await expectPasswordLoginAcceptsCaptchaAnswer(captcha.answer);
  });

  it('generates and validates subtraction text captchas without negative answers', async () => {
    const captcha = createTextCaptchaChallenge(createSequenceRandomInt([0, 1, 5, 13]));

    expect(captcha.prompt).toBe('13 - 5 = ?');
    expect(captcha.captchaType).toBe('ARITHMETIC');
    expect(Number(captcha.answer)).toBeGreaterThanOrEqual(0);
    expectCaptchaSvgInterference(decodeSvgDataUrl(captcha.imageDataUrl));
    await expectPasswordLoginAcceptsCaptchaAnswer(captcha.answer);
  });

  it('generates and validates multiplication text captchas', async () => {
    const captcha = createTextCaptchaChallenge(createSequenceRandomInt([0, 2, 4, 7]));

    expect(captcha).toEqual({
      captchaType: 'ARITHMETIC',
      prompt: '4 × 7 = ?',
      answer: '28',
      imageDataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
    expectCaptchaSvgInterference(decodeSvgDataUrl(captcha.imageDataUrl));
    await expectPasswordLoginAcceptsCaptchaAnswer(captcha.answer);
  });

  it('generates and validates divisible division text captchas', async () => {
    const captcha = createTextCaptchaChallenge(createSequenceRandomInt([0, 3, 6, 4]));

    expect(captcha).toEqual({
      captchaType: 'ARITHMETIC',
      prompt: '24 ÷ 6 = ?',
      answer: '4',
      imageDataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
    expect(24 % 6).toBe(0);
    expectCaptchaSvgInterference(decodeSvgDataUrl(captcha.imageDataUrl));
    await expectPasswordLoginAcceptsCaptchaAnswer(captcha.answer);
  });

  it('generates and validates alphanumeric text captchas without ambiguous characters', async () => {
    const captcha = createTextCaptchaChallenge(
      createSequenceRandomInt([1, 0, 5, 10, 20, 25, 29]),
    );

    expect(captcha.captchaType).toBe('TEXT');
    expect(captcha.answer).toHaveLength(6);
    expect(captcha.answer).toMatch(/^[A-Z2-9]+$/);
    expect(captcha.answer).not.toMatch(/[0O1IL]/);
    expect(captcha.prompt).toBe('Enter the characters shown in the image');
    expect(captcha.prompt).not.toContain(captcha.answer);
    expect(captcha.imageDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expectCaptchaSvgInterference(decodeSvgDataUrl(captcha.imageDataUrl));
    await expectPasswordLoginAcceptsCaptchaAnswer(captcha.answer);
  });

  it('logs in with password after consuming a valid captcha', async () => {
    const prisma = createMockPrisma();
    const captchaHash = await bcrypt.hash('15', 4);
    const passwordHash = await bcrypt.hash('password123', 4);
    prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
      id: 'captcha-id',
      answerHash: captchaHash,
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attemptCount: 0,
    });
    prisma.authCaptchaChallenge.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash,
      displayName: 'User',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    prisma.loginLog.create.mockResolvedValue({});
    const { service } = createService(prisma);

    const result = await service.loginWithPassword({
      identifier: 'USER@example.com',
      password: 'password123',
      captchaId: 'captcha-id',
      captchaAnswer: '15',
      device: {
        deviceIdentifier: 'device-123456',
      },
    });

    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(prisma.authCaptchaChallenge.update).toHaveBeenCalledWith({
      where: { id: 'captcha-id' },
      data: { attemptCount: 1, consumedAt: expect.any(Date) },
    });
  });

  it('rejects password login with an invalid password after consuming captcha', async () => {
    const prisma = createMockPrisma();
    const captchaHash = await bcrypt.hash('15', 4);
    const passwordHash = await bcrypt.hash('password123', 4);
    prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
      id: 'captcha-id',
      answerHash: captchaHash,
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attemptCount: 0,
    });
    prisma.authCaptchaChallenge.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash,
      displayName: 'User',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.loginLog.create.mockResolvedValue({});
    const { service } = createService(prisma);

    await expect(
      service.loginWithPassword({
        email: 'user@example.com',
        password: 'wrong-password',
        captchaId: 'captcha-id',
        captchaAnswer: '15',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid credentials');
    expect(prisma.authCaptchaChallenge.update).toHaveBeenCalledWith({
      where: { id: 'captcha-id' },
      data: { attemptCount: 1, consumedAt: expect.any(Date) },
    });
  });

  it('rejects password login with an invalid captcha answer', async () => {
    const prisma = createMockPrisma();
    const captchaHash = await bcrypt.hash('15', 4);
    prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
      id: 'captcha-id',
      answerHash: captchaHash,
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attemptCount: 0,
    });
    prisma.authCaptchaChallenge.update.mockResolvedValue({});
    const { service } = createService(prisma);

    await expect(
      service.loginWithPassword({
        email: 'user@example.com',
        password: 'password123',
        captchaId: 'captcha-id',
        captchaAnswer: '16',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid or expired captcha');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.authCaptchaChallenge.update).toHaveBeenCalledWith({
      where: { id: 'captcha-id' },
      data: { attemptCount: 1 },
    });
  });

  it('accepts alphanumeric captcha answers case-insensitively', async () => {
    await expectPasswordLoginAcceptsCaptchaAnswer('A7K9Q', 'a7k9q');
  });

  it('rejects password login with an expired captcha', async () => {
    const prisma = createMockPrisma();
    prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
      id: 'captcha-id',
      answerHash: await bcrypt.hash('15', 4),
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
      attemptCount: 0,
    });
    const { service } = createService(prisma);

    await expect(
      service.loginWithPassword({
        email: 'user@example.com',
        password: 'password123',
        captchaId: 'captcha-id',
        captchaAnswer: '15',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid or expired captcha');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects repeated captcha use', async () => {
    const prisma = createMockPrisma();
    prisma.authCaptchaChallenge.findUnique.mockResolvedValue({
      id: 'captcha-id',
      answerHash: await bcrypt.hash('15', 4),
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      attemptCount: 1,
    });
    const { service } = createService(prisma);

    await expect(
      service.loginWithPassword({
        email: 'user@example.com',
        password: 'password123',
        captchaId: 'captcha-id',
        captchaAnswer: '15',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid or expired captcha');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('logs in with an email verification code for an active email user', async () => {
    const prisma = createMockPrisma();
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      displayName: 'User',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash,
      createdAt: new Date(),
    });
    prisma.emailVerificationCode.update.mockResolvedValue({});
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    prisma.loginLog.create.mockResolvedValue({});
    const { service } = createService(prisma);

    const result = await service.loginWithEmailCode({
      email: 'USER@example.com',
      code: '123456',
      device: {
        deviceIdentifier: 'device-123456',
      },
    });

    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'code-id' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('rejects email-code login with an invalid code', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      displayName: 'User',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.emailVerificationCode.findFirst.mockResolvedValue({
      id: 'code-id',
      codeHash: await bcrypt.hash('123456', 4),
      createdAt: new Date(),
    });
    const { service } = createService(prisma);

    await expect(
      service.loginWithEmailCode({
        email: 'user@example.com',
        code: '654321',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid or expired verification code');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('rejects email-code login for an unregistered email', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.loginLog.create.mockResolvedValue({});
    const { service } = createService(prisma);

    await expect(
      service.loginWithEmailCode({
        email: 'missing@example.com',
        code: '123456',
        device: {
          deviceIdentifier: 'device-123456',
        },
      }),
    ).rejects.toThrow('Invalid credentials');
    expect(prisma.emailVerificationCode.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the deprecated login endpoint compatible with password login', async () => {
    const prisma = createMockPrisma();
    const passwordHash = await bcrypt.hash('password123', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash,
      displayName: 'User',
      accountType: 'EMAIL',
      status: 'ACTIVE',
    });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.device.upsert.mockResolvedValue({ id: 'device-id' });
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    prisma.loginLog.create.mockResolvedValue({});
    const { service } = createService(prisma);

    const result = await service.login({
      email: 'user@example.com',
      password: 'password123',
      device: {
        deviceIdentifier: 'device-123456',
      },
    });

    expect(result.refreshToken).toMatch(/^session-id\./);
  });
});
