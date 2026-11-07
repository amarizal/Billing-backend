// Tes penjaga colokan (src/lib/plugGuard.js) dengan colokan Tuya palsu.
// Jalankan ke SALINAN database, jangan ke produksi:
//   DATABASE_URL="file:/path/salinan.db" node scratch/test_plug_guard.js
const assert = require('assert');
const prisma = require('../src/lib/prisma');
const { ensurePlugsOff } = require('../src/lib/plugGuard');

// Colokan palsu: state per deviceId, catat perintah OFF yang dikirim
const fakeTuya = (states) => ({
  sent: [],
  async getSwitchState(id) { return states[id] ?? null; },
  async controlDevice(id, action) { this.sent.push(`${id}:${action}`); states[id] = { online: true, on: action === 'ON' }; return { success: true }; },
});

(async () => {
  const kasir = await prisma.user.findFirst();
  const pkg = await prisma.package.findFirst();
  const mkUnit = (name) => prisma.unit.create({ data: { name, type: 'PS4', tuyaDeviceId: `dev-${name}-${Date.now()}` } });
  const [a, b, c, d] = await Promise.all(['GuardA', 'GuardB', 'GuardC', 'GuardD'].map(mkUnit));
  const now = new Date();
  const ago = (s) => new Date(now - s * 1000);
  const done = (unit, endedSecAgo) => prisma.session.create({
    data: { unitId: unit.id, kasirId: kasir.id, packageId: pkg.id, startTime: ago(endedSecAgo + 3600), endTime: ago(endedSecAgo), status: 'completed', billingAmount: 10000 },
  });

  try {
    await done(a, 60);        // A: selesai 1 menit lalu, colokan MASIH ON (perintah OFF hilang)
    await done(b, 60);        // B: selesai 1 menit lalu, colokan sudah OFF
    await done(c, 5);         // C: baru selesai 5 detik lalu (masih masa tunggu)
    await done(d, 60);        // D: masih ON tapi colokan sedang offline

    const states = {
      [a.tuyaDeviceId]: { online: true, on: true },
      [b.tuyaDeviceId]: { online: true, on: false },
      [c.tuyaDeviceId]: { online: true, on: true },
      [d.tuyaDeviceId]: { online: false, on: true },
    };
    const tuya = fakeTuya(states);

    // Putaran 1: hanya A yang dikirimi OFF ulang
    let resent = await ensurePlugsOff(prisma, tuya, now);
    assert.deepStrictEqual(resent, ['GuardA']);
    assert.deepStrictEqual(tuya.sent, [`${a.tuyaDeviceId}:OFF`]);

    // Putaran 2: A sudah OFF, D tersambung lagi tapi masih ON -> D dikirimi OFF
    states[d.tuyaDeviceId].online = true;
    resent = await ensurePlugsOff(prisma, tuya, new Date(now.getTime() + 30000));
    // (C juga ikut: sudah lewat masa tunggu 20 detik dan masih ON; A tidak dikirimi lagi)
    assert.deepStrictEqual([...resent].sort(), ['GuardC', 'GuardD']);

    // Unit yang sudah dipakai sesi baru tidak boleh dimatikan
    const e = await mkUnit('GuardE');
    await done(e, 60);
    await prisma.session.create({ data: { unitId: e.id, kasirId: kasir.id, packageId: pkg.id, startTime: now, status: 'active' } });
    states[e.tuyaDeviceId] = { online: true, on: true };
    const tuya2 = fakeTuya(states);
    resent = await ensurePlugsOff(prisma, tuya2, new Date(now.getTime() + 60000));
    assert.ok(!resent.includes('GuardE'), 'unit dengan sesi aktif tidak dimatikan');

    // Sesi yang selesai lebih dari 15 menit lalu tidak dicek lagi
    states[a.tuyaDeviceId] = { online: true, on: true };
    const tuya3 = fakeTuya(states);
    resent = await ensurePlugsOff(prisma, tuya3, new Date(now.getTime() + 16 * 60000));
    assert.deepStrictEqual(resent, []);

    // Status tidak terbaca (Tuya error / smart plug dimatikan) -> tidak ada aksi
    const tuya4 = { sent: [], async getSwitchState() { return null; }, async controlDevice() { throw new Error('tidak boleh dipanggil'); } };
    assert.deepStrictEqual(await ensurePlugsOff(prisma, tuya4, now), []);

    console.log('✅ Semua tes penjaga colokan lolos');
  } finally {
    const ids = (await prisma.unit.findMany({ where: { name: { startsWith: 'Guard' } } })).map((u) => u.id);
    await prisma.session.deleteMany({ where: { unitId: { in: ids } } });
    await prisma.unit.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
