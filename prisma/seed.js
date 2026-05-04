const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Admin Account ─────────────────────────────
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      name: 'Administrator',
      username: 'admin',
      passwordHash: adminPassword,
      role: 'admin',
    },
  });
  console.log(`✅ Admin: ${admin.username}`);

  // ─── Kasir Account ─────────────────────────────
  const kasirPassword = await bcrypt.hash('kasir123', 10);
  const kasir = await prisma.user.upsert({
    where: { username: 'kasir1' },
    update: {},
    create: {
      name: 'Kasir 1',
      username: 'kasir1',
      passwordHash: kasirPassword,
      role: 'kasir',
    },
  });
  console.log(`✅ Kasir: ${kasir.username}`);

  // ─── Units (PS4 x6, PS5 x2) ───────────────────
  const units = [
    { name: 'PS4 Unit 1', type: 'PS4', displayOrder: 1 },
    { name: 'PS4 Unit 2', type: 'PS4', displayOrder: 2 },
    { name: 'PS4 Unit 3', type: 'PS4', displayOrder: 3 },
    { name: 'PS4 Unit 4', type: 'PS4', displayOrder: 4 },
    { name: 'PS4 Unit 5', type: 'PS4', displayOrder: 5 },
    { name: 'PS4 Unit 6', type: 'PS4', displayOrder: 6 },
    { name: 'PS5 Unit 1', type: 'PS5', displayOrder: 7 },
    { name: 'PS5 Unit 2', type: 'PS5', displayOrder: 8 },
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { id: `unit-${unit.displayOrder}` },
      update: {},
      create: { id: `unit-${unit.displayOrder}`, ...unit },
    });
  }
  console.log(`✅ 8 Units seeded (6 PS4, 2 PS5)`);

  // ─── Packages ──────────────────────────────────
  const packages = [
    { name: '1 Jam',      type: 'package', durationMinutes: 60,  price: 10000, displayOrder: 1 },
    { name: '2 Jam',      type: 'package', durationMinutes: 120, price: 18000, displayOrder: 2 },
    { name: '3 Jam',      type: 'package', durationMinutes: 180, price: 25000, displayOrder: 3 },
    { name: 'Per Jam',    type: 'hourly',  durationMinutes: 0,   price: 10000, displayOrder: 4 },
  ];

  for (const pkg of packages) {
    await prisma.package.create({ data: pkg }).catch(() => {});
  }
  console.log(`✅ ${packages.length} Packages seeded`);

  // ─── POS Categories ────────────────────────────
  const categories = [
    { name: 'Minuman',   displayOrder: 1 },
    { name: 'Makanan',   displayOrder: 2 },
    { name: 'Snack',     displayOrder: 3 },
    { name: 'Lainnya',   displayOrder: 4 },
  ];

  const createdCategories = {};
  for (const cat of categories) {
    const created = await prisma.posCategory.create({ data: cat });
    createdCategories[cat.name] = created.id;
  }
  console.log(`✅ ${categories.length} POS Categories seeded`);

  // ─── POS Items ─────────────────────────────────
  const items = [
    { categoryName: 'Minuman', name: 'Air Mineral',      price: 3000  },
    { categoryName: 'Minuman', name: 'Teh Botol',        price: 5000  },
    { categoryName: 'Minuman', name: 'Kopi Sachet',      price: 4000  },
    { categoryName: 'Minuman', name: 'Minuman Soda Kaleng', price: 8000 },
    { categoryName: 'Makanan', name: 'Mie Instan',       price: 10000 },
    { categoryName: 'Makanan', name: 'Roti Bakar',       price: 12000 },
    { categoryName: 'Snack',   name: 'Chitato',          price: 5000  },
    { categoryName: 'Snack',   name: 'Oreo',             price: 5000  },
    { categoryName: 'Lainnya', name: 'Cas HP',           price: 3000  },
  ];

  for (const item of items) {
    await prisma.posItem.create({
      data: {
        name: item.name,
        price: item.price,
        categoryId: createdCategories[item.categoryName],
      },
    });
  }
  console.log(`✅ ${items.length} POS Items seeded`);

  console.log('\n🎉 Seeding selesai!');
  console.log('─────────────────────────────');
  console.log('Login Admin : admin / admin123');
  console.log('Login Kasir : kasir1 / kasir123');
  console.log('─────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
