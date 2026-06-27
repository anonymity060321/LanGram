-- CreateEnum
CREATE TYPE "conversation_member_role" AS ENUM ('OWNER', 'MEMBER');

-- AlterEnum
ALTER TYPE "conversation_type" ADD VALUE 'GROUP';

-- DropIndex
DROP INDEX "conversation_members_user_id_idx";

-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "left_at" TIMESTAMP(3),
ADD COLUMN     "role" "conversation_member_role" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "conversation_members_conversation_id_left_at_idx" ON "conversation_members"("conversation_id", "left_at");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_left_at_idx" ON "conversation_members"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "conversations_type_idx" ON "conversations"("type");

-- CreateIndex
CREATE INDEX "conversations_created_by_user_id_idx" ON "conversations"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
