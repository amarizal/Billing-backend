const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/units/public — Akses publik (tanpa token) KHUSUS untuk TV Launcher
router.get('/public', async (_req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
      }
    });
    res.json({ success: true, data: units });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/units — semua role (untuk dashboard)
router.get('/', authenticate, async (_req, res) => {
  const units = await prisma.unit.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: {
      sessions: {
        where: { status: 'active' },
        include: { package: true, kasir: { select: { name: true } } },
        take: 1,
      },
    },
  });
  res.json({ success: true, data: units });
});

// GET /api/units/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const unit = await prisma.unit.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        sessions: {
          where: { status: 'active' },
          include: { package: true },
          take: 1,
        },
      },
    });
    res.json({ success: true, data: unit });
  } catch {
    res.status(404).json({ success: false, message: 'Unit tidak ditemukan' });
  }
});

// POST /api/units — admin only
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, type, displayOrder, ipAddress, smartPlugIp, smartPlugBrand, smartPlugDeviceId } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'name dan type wajib diisi' });
    }

    const unit = await prisma.unit.create({
      data: { name, type, displayOrder, ipAddress, smartPlugIp, smartPlugBrand, smartPlugDeviceId },
    });
    res.status(201).json({ success: true, data: unit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/units/:id — admin only
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, type, status, displayOrder, isActive, ipAddress, smartPlugIp, smartPlugBrand, smartPlugDeviceId } = req.body;
    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data: { name, type, status, displayOrder, isActive, ipAddress, smartPlugIp, smartPlugBrand, smartPlugDeviceId },
    });
    res.json({ success: true, data: unit });
  } catch {
    res.status(404).json({ success: false, message: 'Unit tidak ditemukan' });
  }
});

// POST /api/units/reorder — admin only
router.post('/reorder', authenticate, requireAdmin, async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: 'orders harus berupa array' });
    }

    // Melakukan update dalam satu transaksi
    const updates = orders.map((o) => {
      return prisma.unit.update({
        where: { id: o.id },
        data: { displayOrder: parseInt(o.displayOrder.toString()) }
      });
    });

    await prisma.$transaction(updates);

    res.json({ success: true, message: 'Urutan unit berhasil diperbarui' });
  } catch (err) {
    console.error('❌ Reorder Error:', err);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui urutan',
      error: err.message
    });
  }
});

// DELETE /api/units/:id — admin only (soft delete)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.unit.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Unit dinonaktifkan' });
  } catch {
    res.status(404).json({ success: false, message: 'Unit tidak ditemukan' });
  }
});

module.exports = router;
