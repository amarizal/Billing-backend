// Penjaga colokan Tuya.
//
// Colokan dengan WiFi lemah sering putus beberapa detik (log Tuya: unit 05 putus 10-20x/hari).
// Kalau perintah OFF dikirim tepat saat itu, Tuya Cloud tetap membalas "sukses" tapi perintahnya
// tidak pernah sampai, jadi waktu habis tetapi TV tetap menyala.
// Penjaga ini membaca status colokan yang sebenarnya setelah sesi selesai, dan mengirim OFF lagi
// sampai colokan benar-benar melapor OFF.

const CHECK_WINDOW_MS = 15 * 60 * 1000; // berhenti mengecek 15 menit setelah sesi selesai
const SETTLE_MS = 20 * 1000;            // beri waktu perintah OFF pertama sampai dulu

const confirmedOff = new Map(); // sessionId -> waktu colokan terkonfirmasi OFF

async function ensurePlugsOff(prisma, tuya, now = new Date()) {
  for (const [id, at] of confirmedOff) {
    if (now - at > CHECK_WINDOW_MS) confirmedOff.delete(id);
  }

  const sessions = await prisma.session.findMany({
    where: {
      status: 'completed',
      endTime: { gte: new Date(now - CHECK_WINDOW_MS), lte: new Date(now - SETTLE_MS) },
      unit: { tuyaDeviceId: { not: null }, status: 'available' },
    },
    include: { unit: true },
    orderBy: { endTime: 'desc' },
  });

  const checkedUnits = new Set();
  const resent = [];
  for (const s of sessions) {
    if (checkedUnits.has(s.unitId)) continue; // cukup sesi terakhir tiap unit
    checkedUnits.add(s.unitId);
    if (confirmedOff.has(s.id)) continue;

    const state = await tuya.getSwitchState(s.unit.tuyaDeviceId);
    if (!state || state.on === null) continue; // gagal dibaca: coba lagi di putaran berikutnya
    if (!state.on) {
      confirmedOff.set(s.id, now);
      continue;
    }
    if (!state.online) continue; // colokan masih putus: tunggu sampai tersambung lagi

    // Unit bisa saja baru dipakai sesi baru di antara query dan sekarang
    const active = await prisma.session.count({ where: { unitId: s.unitId, status: 'active' } });
    if (active) continue;

    console.warn(`[Tuya Guard] ⚠️ ${s.unit.name} masih ON setelah sesi selesai, kirim OFF ulang`);
    await tuya.controlDevice(s.unit.tuyaDeviceId, 'OFF');
    resent.push(s.unit.name);
  }
  return resent;
}

module.exports = { ensurePlugsOff, CHECK_WINDOW_MS, SETTLE_MS };
