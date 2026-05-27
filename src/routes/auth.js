const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper buat token
const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  const refreshToken = jwt.sign(
    { userId, role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Simpan refresh token (hash)
    const bcryptHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: bcryptHash, expiresAt },
    });

    res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, username: user.username, role: user.role },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token wajib diisi' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Token tidak valid' });
    }

    // --- FIX SECURITY & REDUNDANCY ---
    // 1. Verifikasi apakah token refresh ini ada di database dan belum expired
    const storedTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id }
    });

    let isValidStoredToken = false;
    let matchingTokenId = null;

    for (const t of storedTokens) {
      const match = await bcrypt.compare(refreshToken, t.tokenHash);
      if (match && t.expiresAt > new Date()) {
        isValidStoredToken = true;
        matchingTokenId = t.id;
        break;
      }
    }

    if (!isValidStoredToken) {
      return res.status(401).json({ success: false, message: 'Refresh token tidak valid atau telah dicabut' });
    }

    // 2. Generate token baru
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role);

    // 3. Ganti token lama dengan yang baru di database (rotasi token)
    const bcryptHash = await bcrypt.hash(newRefreshToken, 8);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: matchingTokenId } }),
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: bcryptHash, expiresAt }
      })
    ]);

    res.json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ success: false, message: 'Refresh token tidak valid atau kadaluarsa' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Hapus semua refresh token milik user ini
    await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    res.json({ success: true, message: 'Logout berhasil' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, data: req.user });
});

module.exports = router;
