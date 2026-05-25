import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

class TestPrismaService extends PrismaService {
  protected override getMaxConnectAttempts(): number {
    return 3;
  }

  protected override getConnectRetryDelayMs(): number {
    return 1;
  }

  protected override async sleep(): Promise<void> {
    await Promise.resolve();
  }
}

function createService(): TestPrismaService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('postgresql://langram:password@localhost:5432/langram'),
  } as unknown as ConfigService;

  return new TestPrismaService(configService);
}

describe('PrismaService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects without retry when the database is available', async () => {
    const service = createService();
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('retries until the database becomes available', async () => {
    const service = createService();
    const connectSpy = jest
      .spyOn(service, '$connect')
      .mockRejectedValueOnce(new Error('temporary database error'))
      .mockResolvedValueOnce(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('throws after the maximum retry attempts', async () => {
    const service = createService();
    const error = new Error('database unavailable');
    const connectSpy = jest.spyOn(service, '$connect').mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toThrow('database unavailable');
    expect(connectSpy).toHaveBeenCalledTimes(3);
  });
});
