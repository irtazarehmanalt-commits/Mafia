-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('LOBBY', 'ROLE_REVEAL', 'NIGHT', 'NIGHT_RESOLUTION', 'DAY_ANNOUNCEMENT', 'DISCUSSION', 'VOTING', 'VOTE_RESOLUTION', 'GAME_OVER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MAFIA', 'DOCTOR', 'DETECTIVE', 'CIVILIAN');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('MAFIA', 'TOWN');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'SERVER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rooms" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "maxPlayers" INTEGER NOT NULL DEFAULT 10,
    "settings" JSONB NOT NULL,
    "hostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "game_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "displayName" TEXT NOT NULL,
    "seat" INTEGER NOT NULL DEFAULT 0,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "isSpectator" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role",
    "team" "Team",
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL DEFAULT 1,
    "currentPhase" "Phase" NOT NULL DEFAULT 'LOBBY',
    "phaseStartedAt" TIMESTAMP(3),
    "phaseEndsAt" TIMESTAMP(3),
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "winner" "Team",
    "stateSnapshot" JSONB,
    "result" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_actions" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetPlayerId" TEXT,
    "phase" "Phase" NOT NULL,
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "targetId" TEXT,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC',
    "audience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dayNumber" INTEGER NOT NULL DEFAULT 0,
    "phase" "Phase" NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
node.exe : ┌─────────────────────────────────────────────────────────┐
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (┌──────────────...──────────────┐:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
│  Update available 6.19.3 -> 8.0.0-rc.12                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "game_rooms_roomCode_key" ON "game_rooms"("roomCode");

-- CreateIndex
CREATE INDEX "game_rooms_status_updatedAt_idx" ON "game_rooms"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "game_players_roomId_idx" ON "game_players"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_roomId_displayName_key" ON "game_players"("roomId", "displayName");

-- CreateIndex
CREATE INDEX "games_roomId_status_idx" ON "games"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "games_roomId_gameNumber_key" ON "games"("roomId", "gameNumber");

-- CreateIndex
CREATE INDEX "game_actions_gameId_dayNumber_idx" ON "game_actions"("gameId", "dayNumber");

-- CreateIndex
CREATE INDEX "votes_gameId_round_idx" ON "votes"("gameId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "votes_gameId_round_voterId_key" ON "votes"("gameId", "round", "voterId");

-- CreateIndex
CREATE INDEX "game_events_gameId_createdAt_idx" ON "game_events"("gameId", "createdAt");

-- AddForeignKey
ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "game_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "game_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

