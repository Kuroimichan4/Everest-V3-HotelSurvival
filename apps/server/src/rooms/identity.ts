import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export function newId(): string { return randomUUID(); }
export function newToken(): string { return randomBytes(32).toString("hex"); }
export function newRoomCode(): string { return randomBytes(6).toString("hex").toUpperCase(); }
export function tokenHash(token: string): Buffer { return createHash("sha256").update(token).digest(); }
export function matchesToken(token: string, hash: Buffer): boolean {
  return timingSafeEqual(tokenHash(token), hash);
}

export interface Participant {
  id: string;
  name: string;
  tokenHash: Buffer;
  socketId: string | null;
  /** Solo existe tras el inicio; independiente del id de participante y del rol. */
  characterId: string | null;
}
