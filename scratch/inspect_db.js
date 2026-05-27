const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== RECENT SESSIONS ===");
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      package: true,
      unit: true,
    }
  });
  console.log(JSON.stringify(sessions, null, 2));

  console.log("=== RECENT RECEIPTS ===");
  const receipts = await prisma.receipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(JSON.stringify(receipts, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
