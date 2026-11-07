const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });

// ─── COMBO ─────────────────────────────────────────────────
// Combo (mis. Josu = Extrajoss + Susu) adalah item biasa yang punya daftar
// komponen. Combo tidak punya stok sendiri; menjualnya mengurangi stok komponen.

const componentsInclude = {
  components: {
    select: {
      componentId: true,
      quantity: true,
      component: { select: { name: true, stock: true } },
    },
  },
};

// Stok combo = jumlah porsi yang bisa dibuat dari komponen yang stoknya dikelola.
// Dikirim di field `stock` agar APK lama pun menampilkan "Stok: N" dan "Habis".
const withBundleStock = (item) => {
  if (!item.components?.length) return item;
  const limits = item.components
    .filter((c) => c.component.stock !== null)
    .map((c) => Math.floor(c.component.stock / c.quantity));
  return { ...item, stock: limits.length ? Math.max(0, Math.min(...limits)) : null };
};

// Validasi isi combo dari body: [{ itemId, quantity }]. null = tidak dikirim (jangan diubah).
const parseComponents = async (components, selfId) => {
  if (components === undefined || components === null) return null;
  if (!Array.isArray(components)) throw httpError('components harus berupa array');

  const parsed = components.map((c) => ({
    componentId: c.itemId,
    quantity: Number(c.quantity ?? 1),
  }));
  for (const p of parsed) {
    if (!p.componentId) throw httpError('itemId komponen wajib diisi');
    if (!Number.isInteger(p.quantity) || p.quantity < 1) throw httpError('Jumlah komponen minimal 1');
    if (p.componentId === selfId) throw httpError('Combo tidak boleh berisi dirinya sendiri');
  }

  const ids = parsed.map((p) => p.componentId);
  if (new Set(ids).size !== ids.length) throw httpError('Komponen combo tidak boleh dobel');

  const found = await prisma.posItem.findMany({
    where: { id: { in: ids } },
    include: { components: true },
  });
  if (found.length !== ids.length) throw httpError('Komponen combo tidak ditemukan');
  if (found.some((f) => f.components.length)) throw httpError('Isi combo tidak boleh berupa combo lain');

  if (parsed.length && selfId) {
    const usedAsComponent = await prisma.posItemComponent.count({ where: { componentId: selfId } });
    if (usedAsComponent) throw httpError('Item ini dipakai sebagai isi combo lain, tidak bisa dijadikan combo');
  }
  return parsed;
};

// ─── CATEGORIES ────────────────────────────────────────────

// GET /api/pos/categories
router.get('/categories', authenticate, async (_req, res) => {
  const categories = await prisma.posCategory.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: {
      items: { where: { isActive: true }, orderBy: { displayOrder: 'asc' }, include: componentsInclude },
    },
  });
  const data = categories.map((c) => ({ ...c, items: c.items.map(withBundleStock) }));
  res.json({ success: true, data });
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
    include: { category: { select: { id: true, name: true } }, ...componentsInclude },
  });
  res.json({ success: true, data: items.map(withBundleStock) });
});

// POST /api/pos/items — admin only
router.post('/items', authenticate, requireAdmin, async (req, res) => {
  try {
    const { categoryId, name, price, stock, displayOrder } = req.body;
    if (!categoryId || !name || !price) {
      return res.status(400).json({ success: false, message: 'categoryId, name, price wajib diisi' });
    }
    const components = await parseComponents(req.body.components);
    const isBundle = components?.length > 0;

    const item = await prisma.posItem.create({
      data: {
        categoryId,
        name,
        price: parseFloat(price.toString()),
        stock: !isBundle && stock !== null ? parseInt(stock.toString()) : null,
        displayOrder: displayOrder ? parseInt(displayOrder.toString()) : 0,
        components: isBundle ? { create: components } : undefined,
      },
      include: { category: { select: { id: true, name: true } }, ...componentsInclude },
    });
    res.status(201).json({ success: true, data: withBundleStock(item) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Terjadi kesalahan server' });
  }
});

// PUT /api/pos/items/:id — admin only
router.put('/items/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId, name, price, stock, displayOrder, isActive } = req.body;
    const components = await parseComponents(req.body.components, id);
    // APK lama tidak mengirim components: pertahankan status combo yang ada
    const isBundle = components
      ? components.length > 0
      : (await prisma.posItemComponent.count({ where: { bundleId: id } })) > 0;

    const item = await prisma.$transaction(async (tx) => {
      if (components) await tx.posItemComponent.deleteMany({ where: { bundleId: id } });
      return tx.posItem.update({
        where: { id },
        data: {
          categoryId,
          name,
          price: price !== undefined ? parseFloat(price.toString()) : undefined,
          stock: isBundle ? null : stock !== undefined ? (stock !== null ? parseInt(stock.toString()) : null) : undefined,
          displayOrder: displayOrder !== undefined ? parseInt(displayOrder.toString()) : undefined,
          isActive,
          components: components?.length ? { create: components } : undefined,
        },
        include: { category: { select: { id: true, name: true } }, ...componentsInclude },
      });
    });
    res.json({ success: true, data: withBundleStock(item) });
  } catch (err) {
    console.error(err);
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
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

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items tidak boleh kosong' });
    }
    if (items.some((i) => !Number.isInteger(Number(i.quantity)) || Number(i.quantity) < 1)) {
      return res.status(400).json({ success: false, message: 'Jumlah item tidak valid' });
    }

    // Validasi & ambil data item
    const itemIds = [...new Set(items.map((i) => i.itemId))];
    const dbItems = await prisma.posItem.findMany({
      where: { id: { in: itemIds }, isActive: true },
      include: { components: { include: { component: true } } },
    });

    if (dbItems.length !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'Beberapa item tidak ditemukan atau tidak aktif' });
    }

    // Hitung subtotal & kebutuhan stok per barang (combo memakai stok komponennya)
    const orderItems = [];
    const stockNeed = new Map(); // itemId -> { item, qty }
    const addNeed = (item, qty) => {
      if (item.stock === null) return; // stok tidak dikelola
      stockNeed.set(item.id, { item, qty: (stockNeed.get(item.id)?.qty || 0) + qty });
    };

    for (const i of items) {
      const dbItem = dbItems.find((d) => d.id === i.itemId);
      const unitPrice = Number(dbItem.price);
      const quantity = Number(i.quantity);

      if (dbItem.components.length) {
        dbItem.components.forEach((c) => addNeed(c.component, c.quantity * quantity));
      } else {
        addNeed(dbItem, quantity);
      }

      orderItems.push({
        itemId: dbItem.id,
        itemName: dbItem.name,
        quantity,
        unitPrice,
        subtotal: unitPrice * quantity,
      });
    }

    // Validasi Stok
    for (const { item, qty } of stockNeed.values()) {
      if (item.stock < qty) {
        return res.status(400).json({
          success: false,
          message: `Stok tidak mencukupi untuk ${item.name}. Sisa: ${item.stock}`
        });
      }
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.subtotal, 0);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Kurangi stok; syarat stock >= qty mencegah stok minus jika ada order bersamaan
      for (const { item, qty } of stockNeed.values()) {
        const { count } = await tx.posItem.updateMany({
          where: { id: item.id, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });
        if (count === 0) throw httpError(`Stok tidak mencukupi untuk ${item.name}`);
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
    res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : `Error Server: ${err.message}`
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
