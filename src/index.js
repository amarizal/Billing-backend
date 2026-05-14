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
    // Cari sesi aktif yang punya waktu selesai (plannedEndTime) dan sudah lewat
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

    if (expiredSessions.length > 0) {
      console.log(`[AutoStop] Menutup ${expiredSessions.length} sesi yang habis waktunya...`);
      
      for (const session of expiredSessions) {
        // Hitung billing akhir
        const durationMs = now - session.startTime;
        const durationMinutes = Math.ceil(durationMs / 60000);
        let billingAmount = 0;

        if (session.package.type === 'package') {
          billingAmount = Number(session.package.price);
        } else {
          const pricePerMinute = Number(session.package.price) / 60;
          billingAmount = Math.ceil(pricePerMinute * durationMinutes);
        }

        // Update database (Sesi & Unit)
        await prisma.$transaction([
          prisma.session.update({
            where: { id: session.id },
            data: { 
              status: 'completed',
              endTime: now,
              durationMinutes,
              billingAmount
            }
          }),
          prisma.unit.update({
            where: { id: session.unitId },
            data: { status: 'available' }
          })
        ]);

        // Broadcast ke TV agar langsung terkunci
        getIo().emit('tv_status_update', {
          unitId: session.unit.id,
          status: 'available'
        });
        
        console.log(`[AutoStop] Unit ${session.unit.name} otomatis terkunci.`);
      }
    }
  } catch (err) {
    console.error('[AutoStop] Error:', err);
  }
}

// Jalankan pengecekan setiap 1 menit
setInterval(autoStopSessions, 60000);
