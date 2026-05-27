const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper: get current date string in Asia/Jakarta (GMT+7) timezone → YYYYMMDD
const getJakartaDateString = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${year}${month}${day}`;
};

// Helper: generate receipt number → RCP-YYYYMMDD-NNN
const generateReceiptNumber = async () => {
  const dateStr = getJakartaDateString();
  const prefix = `RCP-${dateStr}-`;

  const lastReceipt = await prisma.receipt.findFirst({
    where: { receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: 'desc' },
  });

  const lastNum = lastReceipt
    ? parseInt(lastReceipt.receiptNumber.split('-')[2], 10)
    : 0;

  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
};

// POST /api/receipts — checkout & buat struk
router.post('/', authenticate, async (req, res) => {
  try {
    const { sessionId, orderId, paymentMethod, printStatus } = req.body;

    if (!sessionId && !orderId) {
      return res.status(400).json({ success: false, message: 'sessionId atau orderId wajib ada' });
    }

    let billingAmount = 0;
    let posAmount = 0;

    if (sessionId) {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== 'completed') {
        return res.status(400).json({ success: false, message: 'Sesi belum selesai atau tidak ditemukan' });
      }
      billingAmount = Number(session.billingAmount || 0);
    }

    if (orderId) {
      const order = await prisma.posOrder.findUnique({ where: { id: orderId } });
      if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
      posAmount = Number(order.subtotal);
    }

    const totalAmount = billingAmount + posAmount;
    const receiptNumber = await generateReceiptNumber();

    const receipt = await prisma.receipt.create({
      data: {
        receiptNumber,
        sessionId: sessionId || null,
        orderId: orderId || null,
        kasirId: req.user.id,
        billingAmount,
        posAmount,
        totalAmount,
        paymentMethod: paymentMethod || 'cash',
        printStatus: printStatus || 'pending',
      },
      include: {
        session: {
          include: {
            unit: { select: { name: true, type: true } },
            package: { select: { name: true, type: true } },
          },
        },
        order: { include: { items: true } },
        kasir: { select: { name: true } },
      },
    });

    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/receipts/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        session: {
          include: {
            unit: { select: { name: true, type: true } },
            package: { select: { name: true } },
          },
        },
        order: { include: { items: true } },
        kasir: { select: { name: true } },
      },
    });
    res.json({ success: true, data: receipt });
  } catch {
    res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });
  }
});

// PATCH /api/receipts/:id/print — update status cetak
router.patch('/:id/print', authenticate, async (req, res) => {
  try {
    const receipt = await prisma.receipt.update({
      where: { id: req.params.id },
      data: { printStatus: 'printed' },
    });
    res.json({ success: true, data: receipt });
  } catch {
    res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });
  }
});

// DELETE /api/receipts/:id — hapus transaksi (khusus admin)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const receipt = await prisma.receipt.findUnique({ where: { id } });
    if (!receipt) return res.status(404).json({ success: false, message: 'Struk tidak ditemukan' });

    const sessionId = receipt.sessionId;
    const orderId = receipt.orderId;

    // Hapus Receipt DULU untuk menghindari foreign key constraint
    await prisma.receipt.delete({ where: { id } });

    // Baru hapus Session dan PosOrder jika ada
    if (orderId) {
      await prisma.posOrder.delete({ where: { id: orderId } });
    }
    if (sessionId) {
      await prisma.session.delete({ where: { id: sessionId } });
    }

    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal menghapus transaksi' });
  }
});

module.exports = router;
