import { createAuth } from "@Betro/auth";
import { createDb } from "@Betro/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
