-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "notes" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "embedding_pending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL DEFAULT 'legacy',
    "owner_user_id" BIGINT,
    "owner_guest_session_id" BIGINT,
    "board_id" BIGINT NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" BIGSERIAL NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "share_token_hash" TEXT,
    "share_permission" TEXT NOT NULL DEFAULT 'view',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_kind" TEXT NOT NULL DEFAULT 'legacy',
    "owner_user_id" BIGINT,
    "owner_guest_session_id" BIGINT,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_collaborators" (
    "id" BIGSERIAL NOT NULL,
    "board_id" BIGINT NOT NULL,
    "invited_email" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_action_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notes_created_at" ON "notes"("created_at" DESC);
CREATE INDEX "idx_notes_owner_updated_at" ON "notes"("owner_id", "updated_at" DESC);
CREATE INDEX "idx_notes_board_updated_at" ON "notes"("board_id", "updated_at" DESC);
CREATE INDEX "idx_notes_owner_user_updated_at" ON "notes"("owner_user_id", "updated_at" DESC);
CREATE INDEX "idx_notes_owner_guest_updated_at" ON "notes"("owner_guest_session_id", "updated_at" DESC);

CREATE UNIQUE INDEX "idx_boards_share_token_hash_unique" ON "boards"("share_token_hash");
CREATE INDEX "idx_boards_owner_updated_at" ON "boards"("owner_id", "updated_at" DESC);
CREATE INDEX "idx_boards_owner_user_updated_at" ON "boards"("owner_user_id", "updated_at" DESC);
CREATE INDEX "idx_boards_owner_guest_updated_at" ON "boards"("owner_guest_session_id", "updated_at" DESC);

CREATE INDEX "idx_board_collaborators_email" ON "board_collaborators"("invited_email");
CREATE INDEX "idx_board_collaborators_board" ON "board_collaborators"("board_id", "permission");
CREATE INDEX "idx_board_collaborators_user" ON "board_collaborators"("user_id", "board_id");
CREATE UNIQUE INDEX "board_collaborators_board_id_email_key" ON "board_collaborators"("board_id", "invited_email");

CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "guest_sessions"("token_hash");
CREATE UNIQUE INDEX "guest_sessions_owner_id_key" ON "guest_sessions"("owner_id");
CREATE INDEX "idx_guest_sessions_expiry" ON "guest_sessions"("expires_at");

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions"("user_id", "created_at" DESC);
CREATE INDEX "idx_auth_sessions_expiry" ON "auth_sessions"("expires_at");

CREATE UNIQUE INDEX "auth_action_tokens_token_hash_key" ON "auth_action_tokens"("token_hash");
CREATE INDEX "idx_auth_action_tokens_user_purpose" ON "auth_action_tokens"("user_id", "purpose", "created_at" DESC);
CREATE INDEX "idx_auth_action_tokens_expiry" ON "auth_action_tokens"("expires_at");

CREATE UNIQUE INDEX "idx_users_email_lower_unique" ON "users"(LOWER("email"));

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_guest_session_id_fkey" FOREIGN KEY ("owner_guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_guest_session_id_fkey" FOREIGN KEY ("owner_guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_collaborators" ADD CONSTRAINT "board_collaborators_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "board_collaborators" ADD CONSTRAINT "board_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma does not model PostgreSQL CHECK constraints or functional indexes.
ALTER TABLE "users"
  ADD CONSTRAINT "users_name_length_check"
  CHECK (char_length(btrim("name")) >= 2);

ALTER TABLE "boards"
  ADD CONSTRAINT "boards_share_permission_check"
  CHECK ("share_permission" IN ('view', 'edit'));

ALTER TABLE "board_collaborators"
  ADD CONSTRAINT "board_collaborators_permission_check"
  CHECK ("permission" IN ('view', 'edit'));

ALTER TABLE "auth_action_tokens"
  ADD CONSTRAINT "auth_action_tokens_purpose_check"
  CHECK ("purpose" IN ('email_verification', 'password_reset'));

ALTER TABLE "boards"
  ADD CONSTRAINT "boards_owner_kind_check"
  CHECK ("owner_kind" IN ('user', 'guest', 'legacy'));

ALTER TABLE "boards"
  ADD CONSTRAINT "boards_owner_reference_check"
  CHECK (
    ("owner_kind" = 'user' AND "owner_user_id" IS NOT NULL AND "owner_guest_session_id" IS NULL)
    OR ("owner_kind" = 'guest' AND "owner_user_id" IS NULL AND "owner_guest_session_id" IS NOT NULL)
    OR ("owner_kind" = 'legacy' AND "owner_user_id" IS NULL AND "owner_guest_session_id" IS NULL)
  );

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_owner_kind_check"
  CHECK ("owner_kind" IN ('user', 'guest', 'legacy'));

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_owner_reference_check"
  CHECK (
    ("owner_kind" = 'user' AND "owner_user_id" IS NOT NULL AND "owner_guest_session_id" IS NULL)
    OR ("owner_kind" = 'guest' AND "owner_user_id" IS NULL AND "owner_guest_session_id" IS NOT NULL)
    OR ("owner_kind" = 'legacy' AND "owner_user_id" IS NULL AND "owner_guest_session_id" IS NULL)
  );