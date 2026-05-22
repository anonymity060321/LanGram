-- AlterEnum
ALTER TYPE "message_type" ADD VALUE 'IMAGE';
ALTER TYPE "message_type" ADD VALUE 'FILE';

-- CreateEnum
CREATE TYPE "file_kind" AS ENUM ('IMAGE', 'FILE');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('UPLOADED', 'ATTACHED', 'DELETED');

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "kind" "file_kind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "safe_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "file_status" NOT NULL DEFAULT 'UPLOADED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_message_id_key" ON "file_assets"("message_id");

-- CreateIndex
CREATE INDEX "file_assets_conversation_id_created_at_idx" ON "file_assets"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "file_assets_uploader_id_created_at_idx" ON "file_assets"("uploader_id", "created_at");

-- CreateIndex
CREATE INDEX "file_assets_status_created_at_idx" ON "file_assets"("status", "created_at");

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
