// Safe patterns
await prisma.user.deleteMany({ where: { id: userId } });
await prisma.user.updateMany({ where: { id: userId }, data: { name: "test" } });

// Safe raw queries
await prisma.$queryRaw`SELECT 1`;

// Allowed raw SQL
// test-isolation-allow-raw-sql: PRAGMA foreign_keys is required for SQLite isolation testing
await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

// Allowed global mutation
// test-isolation-allow-global-cleanup: We need to wipe everything for integration test
await prisma.user.deleteMany({});
