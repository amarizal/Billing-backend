const axios = require('axios');
const crypto = require('crypto');

/**
 * Tuya Smart Plug Service
 * Mengontrol colokan pintar via Tuya Cloud API
 */
class TuyaService {
  constructor() {
    this.accessId = process.env.TUYA_ACCESS_ID;
    this.accessSecret = process.env.TUYA_ACCESS_SECRET;
    // Default ke domain terbaru Tuya untuk Singapore
    this.baseUrl = process.env.TUYA_BASE_URL || 'https://openapi-sg.iotbing.com';
    this.enabled = process.env.SMART_PLUG_ENABLED === 'true';
  }

  // Menghitung Signature sesuai standar Tuya v1.0 yang paling ketat
  calcSign(body, method, url, timestamp, token = '') {
    const strBody = body ? crypto.createHash('sha256').update(body).digest('hex') : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // StringToSign = Method + "\n" + Content-SHA256 + "\n" + Headers + "\n" + URL
    const stringToSign = [method, strBody, '', url].join('\n');

    // sign = HMAC_SHA256(client_id + access_token + t + stringToSign, secret)
    const signStr = this.accessId + token + timestamp + stringToSign;
    return crypto.createHmac('sha256', this.accessSecret).update(signStr).digest('hex').toUpperCase();
  }

  // Mengambil Access Token dari Tuya (disimpan sampai hampir kedaluwarsa agar tidak minta token tiap perintah)
  async getToken() {
    if (!this.accessId || !this.accessSecret) return null;
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const timestamp = Date.now();
    const url = '/v1.0/token?grant_type=1';
    const sign = this.calcSign('', 'GET', url, timestamp);

    try {
      const fullUrl = this.baseUrl.replace(/\/$/, '') + url;
      const res = await axios.get(fullUrl, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign
        },
        timeout: 5000 // Batas waktu 5 detik
      });
      if (res.data.success) {
        this.token = res.data.result.access_token;
        this.tokenExpiresAt = Date.now() + ((res.data.result.expire_time || 3600) - 60) * 1000;
        return this.token;
      }
      console.error(`[Tuya] Token Error: ${res.data.msg} (Code: ${res.data.code})`);
      return null;
    } catch (err) {
      console.error('[Tuya] Token Network Error:', err.message);
      return null;
    }
  }

  // Mengirim perintah ke Colokan (ON / OFF)
  async controlDevice(deviceId, action) {
    if (!this.enabled || !deviceId) {
      return { success: true };
    }

    const token = await this.getToken();
    if (!token) {
      return { success: false, code: 401, msg: 'Gagal autentikasi token Tuya' };
    }

    const timestamp = Date.now();
    const value = action === 'ON';

    // Kirim ke switch dan switch_1 agar universal untuk semua merk colokan
    const body = {
      commands: [
        { code: 'switch', value: value },
        { code: 'switch_1', value: value }
      ]
    };

    const strBody = JSON.stringify(body);
    const url = `/v1.0/devices/${deviceId}/commands`;
    const sign = this.calcSign(strBody, 'POST', url, timestamp, token);

    try {
      const fullUrl = this.baseUrl.replace(/\/$/, '') + url;
      console.log(`[Tuya] Memanggil API: ${fullUrl} untuk ${deviceId}`);

      const res = await axios.post(fullUrl, body, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign,
          'access_token': token,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // Batas waktu 5 detik
      });

      if (res.data.success) {
        console.log(`[Tuya] ✅ BERHASIL: Perangkat ${deviceId} sudah ${action}`);
        return { success: true };
      } else {
        console.error(`[Tuya] ❌ GAGAL: ${res.data.msg} (Code: ${res.data.code})`);
        this.dropInvalidToken(res.data.code);
        // Jika 28841107 muncul lagi, kita beri saran otomatis
        if (res.data.code === 28841107) {
          console.warn('[Tuya] Saran: Coba ganti TUYA_BASE_URL di Railway ke https://openapi.tuyain.com atau https://openapi.tuyaus.com');
        }
        return { success: false, code: res.data.code, msg: res.data.msg };
      }
    } catch (err) {
      const errorMsg = err.response?.data?.msg || err.message;
      const errorCode = err.response?.data?.code || 500;
      console.error(`[Tuya] 🚨 ERROR:`, err.response?.data || err.message);
      return { success: false, code: errorCode, msg: errorMsg };
    }
  }

  // Token ditolak Tuya (1010 token invalid, 1011 token expired): minta baru di panggilan berikutnya
  dropInvalidToken(code) {
    if (code === 1010 || code === 1011) this.token = null;
  }

  // Membaca status colokan yang sebenarnya: { online, on } atau null jika gagal dibaca
  async getSwitchState(deviceId) {
    if (!this.enabled || !deviceId) return null;

    const token = await this.getToken();
    if (!token) return null;

    const timestamp = Date.now();
    const url = `/v1.0/devices/${deviceId}`;
    const sign = this.calcSign('', 'GET', url, timestamp, token);

    try {
      const res = await axios.get(this.baseUrl.replace(/\/$/, '') + url, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign,
          'access_token': token,
        },
        timeout: 5000,
      });
      if (!res.data.success) {
        console.error(`[Tuya] Gagal membaca status ${deviceId}: ${res.data.msg} (Code: ${res.data.code})`);
        this.dropInvalidToken(res.data.code);
        return null;
      }
      const sw = (res.data.result.status || []).find((s) => s.code === 'switch_1' || s.code === 'switch');
      return { online: res.data.result.online === true, on: sw ? sw.value === true : null };
    } catch (err) {
      console.error(`[Tuya] Gagal membaca status ${deviceId}:`, err.response?.data || err.message);
      return null;
    }
  }
}

module.exports = new TuyaService();
