const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── CATEGORIES ────────────────────────────────────────────

// GET /api/pos/categories
router.get('/categories', authenticate, async (_req, res) => {
  const categories = await prisma.posCategory.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: {
      items: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } },
    },
  });
  res.json({ success: true, data: categories });
});

// POST /api/pos/categories — admin only
router.post('/categories', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, displayOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name wajib diisi' });
    const cat = await prisma.posCategory.create({ data: { name, displayOrder } });
    res.status(201).json({ success: true, data: cat });
  } catch {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/pos/categories/:id — admin only
router.put('/categories/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, displayOrder, isActive } = req.body;
    const cat = await prisma.posCategory.update({
      where: { id: req.params.id },
      data: { name, displayOrder, isActive },
    });
    res.json({ success: true, data: cat });
  } catch {
    res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
  }
});

// DELETE /api/pos/categories/:id — admin only
router.delete('/categories/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.posCategory.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Kategori dinonaktifkan' });
  } catch {
    res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
  }
});

// ─── ITEMS ─────────────────────────────────────────────────

// GET /api/pos/items
router.get('/items', authenticate, async (req, res) => {
  const { categoryId } = req.query;
  const where = { isActive: true };
  if (categoryId) where.categoryId = categoryId;

  const items = await prisma.posItem.findMany({
    where,
    orderBy: [{ categoryId: 'asc' }, { displayOrder: 'asc' }],
    include: { category: { select: { id: true, name: true } } },
  });
  res.json({ success: true, data: items });
});

// POST /api/pos/items — admin only
router.post('/items', authenticate, requireAdmin, async (req, res) => {
  try {
    const { categoryId, name, price, stock, displayOrder } = req.body;
    if (!categoryId || !name || !price) {
      return res.status(400).json({ success: false, message: 'categoryId, name, price wajib diisi' });
    }
    const item = await prisma.posItem.create({
      data: { 
        categoryId, 
        name, 
        price: parseFloat(price.toString()), 
        stock: stock !== null ? parseInt(stock.toString()) : null, 
        displayOrder: displayOrder ? parseInt(displayOrder.toString()) : 0 
      },
      include: { category: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/pos/items/:id — admin only
router.put('/items/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { categoryId, name, price, stock, displayOrder, isActive } = req.body;
    const item = await prisma.posItem.update({
      where: { id: req.params.id },
      data: { 
        categoryId, 
        name, 
        price: price !== undefined ? parseFloat(price.toString()) : undefined, 
        stock: stock !== undefined ? (stock !== null ? parseInt(stock.toString()) : null) : undefined, 
        displayOrder: displayOrder !== undefined ? parseInt(displayOrder.toString()) : undefined, 
        isActive 
      },
      include: { category: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: item });
  } catch (err) {
    console.error(err);
    res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
  }
});

// DELETE /api/pos/items/:id — admin only
router.delete('/items/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.posItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Item dinonaktifkan' });
  } catch {
    res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
  }
});

// ─── ORDERS ────────────────────────────────────────────────

// POST /api/pos/orders — kasir: buat order POS
router.post('/orders', authenticate, async (req, res) => {
  try {
    const { sessionId, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items tidak boleh kosong' });
    }

    // Validasi & ambil data item
    const itemIds = items.map((i) => i.itemId);
    const dbItems = await prisma.posItem.findMany({
      where: { id: { in: itemIds }, isActive: true },
    });

    if (dbItems.length !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'Beberapa item tidak ditemukan atau tidak aktif' });
    }

    // Hitung subtotal & Validasi Stok
    const orderItems = [];

    for (const i of items) {
      const dbItem = dbItems.find((d) => d.id === i.itemId);
      const unitPrice = Number(dbItem.price);
      const quantity = parseInt(i.quantity.toString());

      // Validasi Stok
      if (dbItem.stock !== null) {
        if (dbItem.stock < quantity) {
          return res.status(400).json({ 
            success: false, 
            message: `Stok tidak mencukupi untuk ${dbItem.name}. Sisa: ${dbItem.stock}` 
          });
        }
        stockUpdates.push(
          prisma.posItem.update({
            where: { id: dbItem.id },
            data: { stock: { decrement: quantity } }
          })
        );
      }

      orderItems.push({
        itemId: dbItem.id,
        itemName: dbItem.name,
        quantity,
        unitPrice,
        subtotal: unitPrice * quantity,
      });
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.subtotal, 0);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Kurangi stok untuk item yang dikelola stoknya
      for (const i of items) {
        const dbItem = dbItems.find((d) => d.id === i.itemId);
        if (dbItem && dbItem.stock !== null) {
          await tx.posItem.update({
            where: { id: dbItem.id },
            data: { stock: { decrement: parseInt(i.quantity.toString()) } }
          });
        }
      }

      // 2. Buat Order POS
      return await tx.posOrder.create({
        data: {
          sessionId: sessionId || null,
          kasirId: req.user.id,
          subtotal,
          items: { create: orderItems },
        },
        include: { items: true },
      });
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('❌ POS Order Error:', err);
    res.status(500).json({ 
      success: false, 
      message: `Error Server: ${err.message}` 
    });
  }
});

// GET /api/pos/orders/:id
router.get('/orders/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.posOrder.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { items: true, kasir: { select: { name: true } } },
    });
    res.json({ success: true, data: order });
  } catch {
    res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
  }
});

module.exports = router;
