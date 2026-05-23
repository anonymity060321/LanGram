-- CreateEnum
CREATE TYPE "auth_captcha_purpose" AS ENUM ('LOGIN');

-- CreateTable
CREATE TABLE "auth_captcha_challenges" (
    "id" UUID NOT NULL,
    "answer_hash" TEXT NOT NULL,
    "purpose" "auth_captcha_purpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_captcha_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_captcha_challenges_purpose_created_at_idx" ON "auth_captcha_challenges"("purpose", "created_at");

-- CreateIndex
CREATE INDEX "auth_captcha_challenges_expires_at_consumed_at_idx" ON "auth_captcha_challenges"("expires_at", "consumed_at");
