-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_mime_type" TEXT,
ADD COLUMN     "avatar_storage_path" TEXT,
ADD COLUMN     "avatar_updated_at" TIMESTAMP(3),
ADD COLUMN     "status_message" TEXT;
