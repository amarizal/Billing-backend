const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/packages — semua role
router.get('/', authenticate, async (req, res) => {
  const { type, applicableTo } = req.query;
  const where = { isActive: true };
  if (type) where.type = type;
  if (applicableTo) where.OR = [{ applicableTo }, { applicableTo: null }];

  const packages = await prisma.package.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ success: true, data: packages });
});

// POST /api/packages — admin only
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, description, type, durationMinutes, price, applicableTo, displayOrder } = req.body;
    if (!name || !type || !price) {
      return res.status(400).json({ success: false, message: 'name, type, price wajib diisi' });
    }

    const pkg = await prisma.package.create({
      data: { name, description, type, durationMinutes: durationMinutes || 0, price, applicableTo, displayOrder },
    });
    res.status(201).json({ success: true, data: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/packages/:id — admin only
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, description, type, durationMinutes, price, applicableTo, displayOrder, isActive } = req.body;
    const pkg = await prisma.package.update({
      where: { id: req.params.id },
      data: { name, description, type, durationMinutes, price, applicableTo, displayOrder, isActive },
    });
    res.json({ success: true, data: pkg });
  } catch {
    res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
  }
});

// DELETE /api/packages/:id — admin only (soft delete)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.package.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Paket dinonaktifkan' });
  } catch {
    res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
  }
});

module.exports = router;
