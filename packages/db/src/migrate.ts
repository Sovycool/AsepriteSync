import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client.js";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied successfully.");
process.exit(0);
