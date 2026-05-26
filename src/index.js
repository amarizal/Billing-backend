require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initSocket } = require('./socket');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const unitRoutes = require('./routes/units');
const packageRoutes = require('./routes/packages');
const sessionRoutes = require('./routes/sessions');
const posRoutes = require('./routes/pos');
const receiptRoutes = require('./routes/receipts');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger (dev only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/reports', reportRoutes);

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 Handler ───────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
});

// ─── Global Error Handler ──────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Terjadi kesalahan pada server',
  });
});

// ─── Start Server ──────────────────────────────────────────
const server = http.createServer(app);
initSocket(server); // Biarkan initSocket mengelola internal state-nya di socket.js

const { getIo } = require('./socket'); // Ambil getIo untuk digunakan di ticker

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Health: http://localhost:${port}/health`);
});

// ─── Auto-Stop Expired Sessions Ticker ──────────────────────
const prisma = require('./lib/prisma');

async function autoStopSessions() {
  try {
    const now = new Date();
    // Cari sesi aktif yang waktunya sudah habis
    const expiredSessions = await prisma.session.findMany({
      where: {
        status: 'active',
        plannedEndTime: {
          not: null,
          lte: now,
        },
      },
      include: {
        unit: true,
        package: true,
      },
    });

    for (const session of expiredSessions) {
      const endTime = now;
      const latestDurationMs = endTime - (session.packageStartTime || session.startTime);
      const latestDurationMinutes = Math.ceil(latestDurationMs / 60000);

      const totalDurationMs = endTime - session.startTime;
      const totalDurationMinutes = Math.ceil(totalDurationMs / 60000);

      let currentBillingAmount = 0;
      if (session.package) {
        if (session.package.type === 'package') {
          currentBillingAmount = Number(session.package.price);
        } else if (session.package.type === 'hourly') {
          const pricePerMinute = Number(session.package.price) / 60;
          currentBillingAmount = Math.ceil(pricePerMinute * latestDurationMinutes);
        }
      }

      const finalBillingAmount = currentBillingAmount + Number(session.accumulatedBillingAmount || 0);

      // 1. Update status di Database menjadi completed
      await prisma.session.update({
        where: { id: session.id },
        data: { 
          status: 'completed',
          endTime: endTime,
          durationMinutes: totalDurationMinutes,
          billingAmount: finalBillingAmount
        }
      });

      // 2. Update status Unit menjadi available
      await prisma.unit.update({
        where: { id: session.unit.id },
        data: { status: 'available' }
      });

      // 3. Sinyal Kunci TV Launcher
      getIo().emit('tv_status_update', {
        unitId: session.unit.id,
        status: 'available'
      });

      // 4. Sinyal Matikan Colokan Tuya
      if (session.unit.tuyaDeviceId) {
        const tuyaService = require('./lib/tuyaService');
        tuyaService.controlDevice(session.unit.tuyaDeviceId, 'OFF');
      }
      
      console.log(`[AutoLock] Waktu habis untuk ${session.unit.name}. DB Updated, Sinyal kunci & Tuya dikirim. Total Biaya: Rp ${finalBillingAmount}`);
    }
  } catch (err) {
    console.error('[AutoLock] Error:', err);
  }
}

// Jalankan pengecekan setiap 30 detik
setInterval(autoStopSessions, 30000);
autoStopSessions(); // Jalankan langsung saat server start
