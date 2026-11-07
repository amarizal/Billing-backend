// Tes menu combo (Josu = Extrajoss + Susu, Indomie Telur = Indomie + Telur).
// Jalankan ke server LOKAL dengan database salinan, jangan ke produksi:
//   TEST_USER=... TEST_PASS=... node scratch/test_combo.js http://localhost:3999/api
const assert = require('assert');

const BASE = process.argv[2] || 'http://localhost:3000/api';
let token;

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) };
};

const findItem = async (id) => {
  const { data } = await api('GET', '/pos/categories');
  return data.flatMap((c) => c.items).find((i) => i.id === id);
};

(async () => {
  const login = await api('POST', '/auth/login', {
    username: process.env.TEST_USER || 'admin',
    password: process.env.TEST_PASS || 'admin123', // akun seed lokal
  });
  assert.strictEqual(login.status, 200, 'login gagal');
  token = login.data.accessToken;

  const cat = (await api('POST', '/pos/categories', { name: 'Tes Combo' })).data;
  const mk = async (name, price, stock, components) =>
    api('POST', '/pos/items', { categoryId: cat.id, name, price, stock, components });

  const ej = (await mk('Extrajoss', 5000, 10)).data;
  const susu = (await mk('Susu', 5000, 10)).data;
  const indomie = (await mk('Indomie', 8000, 5)).data;
  const telur = (await mk('Telur', 4000, null)).data; // stok tidak dikelola

  // 1. Buat combo; stok yang dikirim untuk combo diabaikan
  const josuRes = await mk('Josu', 8000, 99, [{ itemId: ej.id, quantity: 1 }, { itemId: susu.id, quantity: 1 }]);
  assert.strictEqual(josuRes.status, 201, josuRes.message);
  const josu = josuRes.data;
  assert.strictEqual(josu.components.length, 2);
  assert.strictEqual(josu.stock, 10, 'stok Josu = min(stok Extrajoss, stok Susu)');

  const it = (await mk('Indomie Telur', 11000, null, [{ itemId: indomie.id }, { itemId: telur.id, quantity: 2 }])).data;
  assert.strictEqual(it.stock, 5, 'telur tidak dikelola, jadi stok mengikuti indomie');

  // 2. Jual 2 Josu: harga 8rb/porsi, stok komponen berkurang 2
  let order = await api('POST', '/pos/orders', { items: [{ itemId: josu.id, quantity: 2 }] });
  assert.strictEqual(order.status, 201, order.message);
  assert.strictEqual(order.data.subtotal, 16000);
  assert.strictEqual(order.data.items[0].itemName, 'Josu');
  assert.strictEqual((await findItem(ej.id)).stock, 8);
  assert.strictEqual((await findItem(susu.id)).stock, 8);
  assert.strictEqual((await findItem(josu.id)).stock, 8);

  // 3. Struk combo tetap jalan seperti item biasa
  const receipt = await api('POST', '/receipts', { orderId: order.data.id, paymentMethod: 'cash' });
  assert.strictEqual(receipt.status, 201, receipt.message);
  assert.strictEqual(receipt.data.totalAmount, 16000);

  // 4. Extrajoss biasa + Josu dalam satu order dihitung bersama: 1 + 8 = 9 > 8 → ditolak, stok tidak berubah
  order = await api('POST', '/pos/orders', { items: [{ itemId: ej.id, quantity: 1 }, { itemId: josu.id, quantity: 8 }] });
  assert.strictEqual(order.status, 400);
  assert.match(order.message, /Extrajoss/);
  assert.strictEqual((await findItem(ej.id)).stock, 8);
  assert.strictEqual((await findItem(susu.id)).stock, 8);

  // 5. Indomie Telur: indomie berkurang, telur (tidak dikelola) tetap null
  order = await api('POST', '/pos/orders', { items: [{ itemId: it.id, quantity: 2 }] });
  assert.strictEqual(order.status, 201, order.message);
  assert.strictEqual((await findItem(indomie.id)).stock, 3);
  assert.strictEqual((await findItem(telur.id)).stock, null);

  // 6. Validasi
  assert.strictEqual((await api('POST', '/pos/orders', { items: [{ itemId: ej.id, quantity: -5 }] })).status, 400, 'qty negatif');
  assert.strictEqual((await api('POST', '/pos/orders', { items: [{ itemId: ej.id, quantity: 0 }] })).status, 400, 'qty nol');
  assert.strictEqual((await mk('Combo Isi Combo', 1, null, [{ itemId: josu.id }])).status, 400, 'combo dalam combo');
  assert.strictEqual((await api('PUT', `/pos/items/${josu.id}`, { components: [{ itemId: josu.id }] })).status, 400, 'isi dirinya sendiri');
  assert.strictEqual((await api('PUT', `/pos/items/${ej.id}`, { components: [{ itemId: susu.id }] })).status, 400, 'komponen dijadikan combo');
  assert.strictEqual((await mk('Dobel', 1, null, [{ itemId: ej.id }, { itemId: ej.id }])).status, 400, 'komponen dobel');

  // 7. Edit gaya APK lama (tanpa components) tidak menghapus isi combo
  let upd = await api('PUT', `/pos/items/${josu.id}`, { name: 'Josu', price: 8500, stock: 8 });
  assert.strictEqual(upd.status, 200, upd.message);
  assert.strictEqual(upd.data.components.length, 2);
  assert.strictEqual(upd.data.price, 8500);

  // 8. Combo dijadikan item biasa lagi (components = [])
  upd = await api('PUT', `/pos/items/${it.id}`, { stock: 7, components: [] });
  assert.strictEqual(upd.status, 200, upd.message);
  assert.strictEqual(upd.data.components.length, 0);
  assert.strictEqual(upd.data.stock, 7);

  // 9. Item biasa tanpa stok tetap jalan seperti sebelumnya
  order = await api('POST', '/pos/orders', { items: [{ itemId: telur.id, quantity: 3 }] });
  assert.strictEqual(order.status, 201, order.message);
  assert.strictEqual(order.data.subtotal, 12000);

  console.log('✅ Semua tes combo lolos');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
