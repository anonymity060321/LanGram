ALTER TABLE "users" ADD COLUMN "is_temporary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "friendships" DROP CONSTRAINT "friendships_created_from_request_id_fkey";
ALTER TABLE "friendships" ALTER COLUMN "created_from_request_id" DROP NOT NULL;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_created_from_request_id_fkey" FOREIGN KEY ("created_from_request_id") REFERENCES "friend_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
