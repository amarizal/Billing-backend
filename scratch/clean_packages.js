const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanPackages() {
  console.log('--- Memulai Pembersihan Paket Duplikat ---');
  
  const packages = await prisma.package.findMany();
  console.log(`Menemukan total ${packages.length} paket di database.`);
  packages.forEach(p => console.log(`- [${p.id}] Name: "${p.name}"`));
  
  const uniqueNames = new Set();
  const toDelete = [];

  for (const pkg of packages) {
    const cleanName = pkg.name.trim().toLowerCase();
    if (uniqueNames.has(cleanName)) {
      toDelete.push(pkg.id);
    } else {
      uniqueNames.add(cleanName);
    }
  }

  if (toDelete.length > 0) {
    await prisma.package.deleteMany({
      where: {
        id: { in: toDelete }
      }
    });
    console.log(`Berhasil menghapus ${toDelete.length} paket duplikat.`);
  } else {
    console.log('Tidak ada paket duplikat yang ditemukan.');
  }

  await prisma.$disconnect();
}

cleanPackages();
