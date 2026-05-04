const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// ─── Verifikasi Access Token ────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, username: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Akun tidak aktif atau tidak ditemukan' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token sudah kadaluarsa' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

// ─── Cek Role Admin ────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin yang diizinkan.' });
  }
  next();
};

// ─── Cek Role Kasir atau Admin ─────────────────────────────
const requireKasirOrAdmin = (req, res, next) => {
  if (!['kasir', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak.' });
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireKasirOrAdmin };
