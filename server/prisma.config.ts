import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// CLI-only fallback for `prisma validate` / `prisma generate` when server/.env is absent.
// Real server runtime uses DATABASE_URL from the environment and should point to the VMware NAT IP.
const cliFallbackDatabaseUrl =
  'postgresql://langram_user:change_me@vmware-nat-ip.invalid:5432/langram';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? cliFallbackDatabaseUrl,
  },
});
