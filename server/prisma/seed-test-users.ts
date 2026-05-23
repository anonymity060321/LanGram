import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { AccountType, PrismaClient, UserStatus } from '@prisma/client';
import { hashAuthSecret } from '../src/auth/auth-hash';

interface TestUserSeed {
  email: string;
  password: string;
  displayName: string;
}

const TEST_USERS: TestUserSeed[] = [
  {
    email: 'test-a@langram.local',
    password: 'Test@123456',
    displayName: '测试用户A',
  },
  {
    email: 'test-b@langram.local',
    password: 'Test@123456',
    displayName: '测试用户B',
  },
  {
    email: 'test-c@langram.local',
    password: 'Test@123456',
    displayName: '测试用户C',
  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test users when NODE_ENV=production');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed test users');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    for (const testUser of TEST_USERS) {
      const email = testUser.email.toLowerCase();
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      const passwordHash = await hashAuthSecret(testUser.password);
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          passwordHash,
          displayName: testUser.displayName,
          accountType: AccountType.EMAIL,
          status: UserStatus.ACTIVE,
        },
        create: {
          email,
          passwordHash,
          displayName: testUser.displayName,
          accountType: AccountType.EMAIL,
          status: UserStatus.ACTIVE,
        },
        select: {
          email: true,
          displayName: true,
          accountType: true,
          status: true,
        },
      });

      const action = existingUser ? 'updated' : 'created';
      console.log(`${action}: ${user.email} / ${user.displayName} / ${user.accountType} / ${user.status}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Failed to seed test users');
  process.exitCode = 1;
});
