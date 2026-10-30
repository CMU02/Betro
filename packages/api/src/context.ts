import type { Session } from "@Betro/auth";
import type { Database } from "@Betro/db";

export type Context = {
  session: Session | null;
  db: Database;
};
