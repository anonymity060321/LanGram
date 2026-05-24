import { TemporaryUsersCleanupService } from './temporary-users-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

type MockFunction<T extends (...args: never[]) => unknown> = jest.MockedFunction<T>;

interface MockPrisma {
  $transaction: MockFunction<(args: unknown[]) => Promise<unknown[]>>;
  user: {
    findMany: MockFunction<(args: unknown) => Promise<Array<{ id: string; email: string | null }>>>;
    deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>>;
  };
  conversation: {
    findMany: MockFunction<(args: unknown) => Promise<Array<{ id: string }>>>;
    deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>>;
  };
  loginLog: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  session: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  device: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  emailVerificationCode: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  friendPairingCode: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  friendship: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  friendRequest: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  messageDelivery: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  fileAsset: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  message: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
  conversationMember: { deleteMany: MockFunction<(args: unknown) => Promise<{ count: number }>> };
}

function deleteManyMock(): MockFunction<(args: unknown) => Promise<{ count: number }>> {
  return jest.fn<Promise<{ count: number }>, [unknown]>(async () => ({ count: 0 }));
}

function createMockPrisma(): MockPrisma {
  return {
    $transaction: jest.fn(async (args: unknown[]) => args),
    user: {
      findMany: jest.fn(),
      deleteMany: deleteManyMock(),
    },
    conversation: {
      findMany: jest.fn(),
      deleteMany: deleteManyMock(),
    },
    loginLog: { deleteMany: deleteManyMock() },
    session: { deleteMany: deleteManyMock() },
    device: { deleteMany: deleteManyMock() },
    emailVerificationCode: { deleteMany: deleteManyMock() },
    friendPairingCode: { deleteMany: deleteManyMock() },
    friendship: { deleteMany: deleteManyMock() },
    friendRequest: { deleteMany: deleteManyMock() },
    messageDelivery: { deleteMany: deleteManyMock() },
    fileAsset: { deleteMany: deleteManyMock() },
    message: { deleteMany: deleteManyMock() },
    conversationMember: { deleteMany: deleteManyMock() },
  };
}

describe('TemporaryUsersCleanupService', () => {
  it('does nothing when there are no temporary users', async () => {
    const prisma = createMockPrisma();
    prisma.user.findMany.mockResolvedValue([]);
    const service = new TemporaryUsersCleanupService(prisma as unknown as PrismaService);

    await expect(service.cleanupTemporaryUsers()).resolves.toEqual({ deletedUsers: 0 });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { isTemporary: true },
      select: { id: true, email: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes only users explicitly marked as temporary and their related records', async () => {
    const prisma = createMockPrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'temp-user-id', email: 'temp@example.com' }]);
    prisma.conversation.findMany.mockResolvedValue([{ id: 'conversation-id' }]);
    const service = new TemporaryUsersCleanupService(prisma as unknown as PrismaService);

    await expect(service.cleanupTemporaryUsers()).resolves.toEqual({ deletedUsers: 1 });

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { members: { some: { userId: { in: ['temp-user-id'] } } } },
      select: { id: true },
    });
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: { in: ['temp-user-id'] } }, { userBId: { in: ['temp-user-id'] } }] },
    });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['temp-user-id'] }, isTemporary: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
  });
});
