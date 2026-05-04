const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — admin only
router.get('/', authenticate, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, username: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: users });
});

// POST /api/users — admin only
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password) {
      return res.status(400).json({ success: false, message: 'name, username, password wajib diisi' });
    }

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Username sudah digunakan' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, username, passwordHash, role: role || 'kasir' },
      select: { id: true, name: true, username: true, role: true, isActive: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// PUT /api/users/:id — admin only
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, username, password, role, isActive } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (username) updateData.username = username;
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: { id: true, name: true, username: true, role: true, isActive: true },
    });

    res.json({ success: true, data: user });
  } catch {
    res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  }
});

// DELETE /api/users/:id — admin only (soft delete via isActive)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    // Jangan bisa hapus diri sendiri
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Tidak bisa menonaktifkan akun sendiri' });
    }
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, message: 'User dinonaktifkan' });
  } catch {
    res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  }
});

module.exports = router;
