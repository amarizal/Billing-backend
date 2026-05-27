const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper: get YYYY-MM-DD string in Asia/Jakarta timezone from Date object
const getJakartaDateStrFromDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${year}-${month}-${day}`;
};

// Helper: parse tanggal range (GMT+7 Asia/Jakarta to UTC bounds)
const getDayRange = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Start of day in GMT+7 (WIB) converted to UTC (subtract 7 hours in ms)
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  // End of day in GMT+7 (WIB) converted to UTC
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
  
  return { start, end };
};

const getMonthRange = (year, month) => {
  // Start of month in GMT+7 (WIB) converted to UTC
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
  
  // Last day of month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // End of month in GMT+7 (WIB) converted to UTC
  const end = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
  
  return { start, end };
};

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', authenticate, async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const { start, end } = getDayRange(dateStr);

    const receipts = await prisma.receipt.findMany({
      where: { createdAt: { gte: start, lte: end } },
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
      orderBy: { createdAt: 'asc' },
    });

    const totalBilling = receipts.reduce((s, r) => s + Number(r.billingAmount), 0);
    const totalPos     = receipts.reduce((s, r) => s + Number(r.posAmount), 0);
    const totalAmount  = receipts.reduce((s, r) => s + Number(r.totalAmount), 0);

    res.json({
      success: true,
      data: {
        date: dateStr,
        summary: { totalTransactions: receipts.length, totalBilling, totalPos, totalAmount },
        receipts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/reports/monthly?year=YYYY&month=MM
router.get('/monthly', authenticate, async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const { start, end } = getMonthRange(year, month);

    const receipts = await prisma.receipt.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        session: { include: { unit: { select: { name: true, type: true } }, package: { select: { name: true } } } },
        order: { include: { items: true } },
        kasir: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Grup per hari
    const byDay = {};
    receipts.forEach((r) => {
      const day = getJakartaDateStrFromDate(r.createdAt);
      if (!byDay[day]) byDay[day] = { totalBilling: 0, totalPos: 0, totalAmount: 0, count: 0 };
      byDay[day].totalBilling += Number(r.billingAmount);
      byDay[day].totalPos     += Number(r.posAmount);
      byDay[day].totalAmount  += Number(r.totalAmount);
      byDay[day].count++;
    });

    const totalAmount = receipts.reduce((s, r) => s + Number(r.totalAmount), 0);
    const totalBilling = receipts.reduce((s, r) => s + Number(r.billingAmount), 0);
    const totalPos = receipts.reduce((s, r) => s + Number(r.posAmount), 0);

    res.json({
      success: true,
      data: {
        year, month,
        summary: { totalTransactions: receipts.length, totalBilling, totalPos, totalAmount },
        byDay,
        receipts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/reports/units?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/units', authenticate, async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(new Date().setDate(1));
    const to   = req.query.to   ? new Date(req.query.to + 'T23:59:59') : new Date();

    const sessions = await prisma.session.findMany({
      where: { status: 'completed', startTime: { gte: from, lte: to } },
      include: { unit: { select: { id: true, name: true, type: true } } },
    });

    const byUnit = {};
    sessions.forEach((s) => {
      const key = s.unit.id;
      if (!byUnit[key]) {
        byUnit[key] = { unit: s.unit, totalSessions: 0, totalMinutes: 0, totalRevenue: 0 };
      }
      byUnit[key].totalSessions++;
      byUnit[key].totalMinutes += s.durationMinutes || 0;
      byUnit[key].totalRevenue += Number(s.billingAmount || 0);
    });

    res.json({ success: true, data: Object.values(byUnit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
