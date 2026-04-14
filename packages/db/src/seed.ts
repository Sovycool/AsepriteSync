import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { db } from "./client.js";
import { users, projects, projectMembers, files, fileVersions } from "./schema.js";

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

const aliceId = uuidv4();
const bobId = uuidv4();
const charlieId = uuidv4();
const project1Id = uuidv4();
const project2Id = uuidv4();
const file1Id = uuidv4();
const version1Id = uuidv4();

// ---------------------------------------------------------------------------
// Seed users
// ---------------------------------------------------------------------------

console.log("Seeding users…");
await db
  .insert(users)
  .values([
    {
      id: aliceId,
      email: "alice@example.com",
      username: "alice",
      passwordHash: await bcrypt.hash("password123", BCRYPT_ROUNDS),
      avatarUrl: null,
    },
    {
      id: bobId,
      email: "bob@example.com",
      username: "bob",
      passwordHash: await bcrypt.hash("password123", BCRYPT_ROUNDS),
      avatarUrl: null,
    },
    {
      id: charlieId,
      email: "charlie@example.com",
      username: "charlie",
      passwordHash: await bcrypt.hash("password123", BCRYPT_ROUNDS),
      avatarUrl: null,
    },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// Seed projects
// ---------------------------------------------------------------------------

console.log("Seeding projects…");
await db
  .insert(projects)
  .values([
    {
      id: project1Id,
      name: "Game Jam 2024",
      description: "Assets for the 48h game jam",
      ownerId: aliceId,
    },
    {
      id: project2Id,
      name: "Solo Portfolio",
      description: "Personal pixel art pieces",
      ownerId: bobId,
    },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// Seed project members
// ---------------------------------------------------------------------------

console.log("Seeding project members…");
await db
  .insert(projectMembers)
  .values([
    { projectId: project1Id, userId: aliceId, role: "owner" },
    { projectId: project1Id, userId: bobId, role: "editor" },
    { projectId: project1Id, userId: charlieId, role: "viewer" },
    { projectId: project2Id, userId: bobId, role: "owner" },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// Seed files + initial version
// ---------------------------------------------------------------------------

console.log("Seeding files…");
await db
  .insert(files)
  .values([
    {
      id: file1Id,
      projectId: project1Id,
      name: "hero.aseprite",
      path: "/hero.aseprite",
      currentVersionId: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  ])
  .onConflictDoNothing();

console.log("Seeding file versions…");
await db
  .insert(fileVersions)
  .values([
    {
      id: version1Id,
      fileId: file1Id,
      versionNumber: 1,
      authorId: aliceId,
      // SHA-256 of empty content — placeholder for dev seed
      hashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      sizeBytes: 0,
      storagePath: `storage/${project1Id}/${file1Id}/1.aseprite`,
      previewPath: null,
      isPinned: false,
    },
  ])
  .onConflictDoNothing();

// Resolve circular FK: files.currentVersionId → fileVersions.id
await db
  .update(files)
  .set({ currentVersionId: version1Id })
  .where(eq(files.id, file1Id));

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log("\nSeed complete.\n");
console.log("  alice@example.com   / password123  (owner of Game Jam 2024)");
console.log("  bob@example.com     / password123  (editor of Game Jam 2024, owner of Solo Portfolio)");
console.log("  charlie@example.com / password123  (viewer of Game Jam 2024)");

process.exit(0);
