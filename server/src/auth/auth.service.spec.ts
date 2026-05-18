import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { EmailCodePurposeDto } from './dto/send-email-code.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  emailVerificationCode: {
    findFirst: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
    update: MockFunction<(args: unknown) => Promise<unknown>>;
  };
  user: {
    findUnique: MockFunction<(args: unknown) => Promise<unknown>>;
    create: MockFunction<(args: unknown) => Promise<unknown>>;
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
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
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

  return {
    service: new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      createConfigService(),
      emailService as unknown as EmailService,
      usersService,
    ),
    emailService,
  };
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
    const { service } = createService(prisma);

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
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'code-id' },
      data: { consumedAt: expect.any(Date) },
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
});
