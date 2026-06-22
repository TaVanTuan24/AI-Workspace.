// Risky patterns
await prisma.user.deleteMany({});
await prisma.user.deleteMany();
await prisma.user.deleteMany({ where: {} });
await prisma.user.updateMany({ where: {} });
await prisma.$executeRaw`DROP TABLE User`;
await prisma.$queryRawUnsafe("DELETE FROM User");
await prisma.$queryRaw`TRUNCATE User`;
const sql = "DROP DATABASE test";

// Allowed but reason too short
// test-isolation-allow-raw-sql: ok
await prisma.$executeRaw`VACUUM`;
