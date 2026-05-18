import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsUrl({ require_tld: false })
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT!: number;

  @IsString()
  @IsNotEmpty()
  SMTP_USER!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_FROM!: string;

  @IsInt()
  @Min(1)
  EMAIL_CODE_TTL_MINUTES!: number;

  @IsInt()
  @Min(1)
  EMAIL_CODE_RESEND_SECONDS!: number;

  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_MINUTES!: number;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS!: number;

  @IsBoolean()
  GUEST_LOGIN_ENABLED!: boolean;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  }

  return validatedConfig;
}
