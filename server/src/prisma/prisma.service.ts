import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  protected getMaxConnectAttempts(): number {
    return 60;
  }

  protected getConnectRetryDelayMs(): number {
    return 2000;
  }

  protected async connectWithRetry(): Promise<void> {
    const maxAttempts = this.getMaxConnectAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log('Database connection established.');
        }
        return;
      } catch (error) {
        if (attempt >= maxAttempts) {
          this.logger.error('Database unavailable after maximum retry attempts.');
          throw error;
        }

        this.logger.warn(
          `Database unavailable, retrying... (${attempt}/${maxAttempts})`,
        );
        await this.sleep(this.getConnectRetryDelayMs());
      }
    }
  }

  protected async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
