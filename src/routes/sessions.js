const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { getIo } = require('../socket');

const router = express.Router();

// ─── Kalkulasi biaya sesi ──────────────────────────────────
const calculateBilling = (startTime, endTime, pkg) => {
  const durationMs = endTime - startTime;
  const durationMinutes = Math.ceil(durationMs / 60000); // bulatkan ke atas

  if (pkg.type === 'package') {
    // Paket: harga tetap berdasarkan paket yang dipilih
    return { durationMinutes, billingAmount: Number(pkg.price) };
  }

  if (pkg.type === 'hourly') {
    // Per jam: harga per jam, prorated per menit
    const pricePerMinute = Number(pkg.price) / 60;
    const billingAmount = Math.ceil(pricePerMinute * durationMinutes);
    return { durationMinutes, billingAmount };
  }

  return { durationMinutes, billingAmount: 0 };
};

// GET /api/sessions — semua sesi (admin: semua, kasir: aktif saja)
router.get('/', authenticate, async (req, res) => {
  const where = req.user.role === 'admin' ? {} : { status: 'active' };
  const sessions = await prisma.session.findMany({
    where,
    orderBy: { startTime: 'desc' },
    include: {
      unit: { select: { id: true, name: true, type: true } },
      package: { select: { id: true, name: true, type: true, price: true } },
      kasir: { select: { id: true, name: true } },
    },
    take: 100,
  });
  res.json({ success: true, data: sessions });
});

// GET /api/sessions/active — semua sesi aktif (untuk dashboard real-time)
router.get('/active', authenticate, async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { status: 'active' },
    include: {
      unit: { select: { id: true, name: true, type: true } },
      package: { select: { id: true, name: true, durationMinutes: true, price: true, type: true } },
      kasir: { select: { id: true, name: true } },
    },
  });
  res.json({ success: true, data: sessions });
});

// POST /api/sessions/start — mulai sesi baru
router.post('/start', authenticate, async (req, res) => {
  try {
    const { unitId, packageId } = req.body;
    if (!unitId || !packageId) {
      return res.status(400).json({ success: false, message: 'unitId dan packageId wajib diisi' });
    }

    // Cek unit tersedia
    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit tidak ditemukan' });
    }
    if (unit.status !== 'available') {
      return res.status(409).json({ success: false, message: `Unit sedang ${unit.status}` });
    }

    // Ambil paket
    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
    }

    const startTime = new Date();
    let plannedEndTime = null;
    if (pkg.type === 'package' && pkg.durationMinutes > 0) {
      plannedEndTime = new Date(startTime.getTime() + pkg.durationMinutes * 60000);
    }

    // Mulai sesi & update status unit
    const [session] = await prisma.$transaction([
      prisma.session.create({
        data: { 
          unitId, 
          kasirId: req.user.id, 
          packageId, 
          startTime, 
          plannedEndTime 
        },
        include: {
          unit: { select: { id: true, name: true, type: true } },
          package: true,
          kasir: { select: { id: true, name: true } },
        },
      }),
      prisma.unit.update({ where: { id: unitId }, data: { status: 'in_use' } }),
    ]);

    // Broadcast ke Smart TV via WebSocket
    try {
      getIo().emit('tv_status_update', {
        unitId: unit.name,
        status: 'active'
      });
    } catch (err) {
      console.error('[Socket] Failed to broadcast start session', err);
    }

    res.status(201).json({ success: true, data: session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/sessions/:id/stop — hentikan sesi
router.put('/:id/stop', authenticate, async (req, res) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: { package: true, unit: true },
    });

    if (!session) return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan' });
    if (session.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Sesi sudah tidak aktif' });
    }

    const endTime = new Date();
    const { durationMinutes, billingAmount } = calculateBilling(
      session.startTime,
      endTime,
      session.package
    );

    const [updatedSession] = await prisma.$transaction([
      prisma.session.update({
        where: { id: session.id },
        data: { 
          endTime, 
          durationMinutes, 
          billingAmount, 
          status: 'completed' 
        },
        include: {
          unit: { select: { id: true, name: true, type: true } },
          package: true,
          kasir: { select: { id: true, name: true } },
        },
      }),
      prisma.unit.update({ where: { id: session.unitId }, data: { status: 'available' } }),
    ]);

    // Broadcast ke Smart TV via WebSocket (status = expired/waktu habis)
    try {
      getIo().emit('tv_status_update', {
        unitId: updatedSession.unit.name,
        status: 'expired'
      });
    } catch (err) {
      console.error('[Socket] Failed to broadcast stop session', err);
    }

    res.json({ success: true, data: updatedSession });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/sessions/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        unit: true,
        package: true,
        kasir: { select: { id: true, name: true } },
        posOrders: { include: { items: true } },
        receipt: true,
      },
    });
    res.json({ success: true, data: session });
  } catch {
    res.status(404).json({ success: false, message: 'Sesi tidak ditemukan' });
  }
});

module.exports = router;
