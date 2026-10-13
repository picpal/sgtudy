import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";
import { ROOM_CASES } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

for (const c of ROOM_CASES) sqlTest(`rooms: ${c.name}`, withCase(db, c.run));
