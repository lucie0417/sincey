CREATE TABLE "AnonymousSpace" (
  "id" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnonymousSpace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnonymousSpace_tokenHash_key" ON "AnonymousSpace"("tokenHash");
CREATE TABLE "Event" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "lastDoneOn" DATE,
  "note" VARCHAR(10000) NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Event_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "AnonymousSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Event_spaceId_lastDoneOn_idx" ON "Event"("spaceId", "lastDoneOn");
