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
    // Menggunakan base URL dari Railway atau default ke US
    this.baseUrl = process.env.TUYA_BASE_URL || 'https://openapi.tuyaus.com';
    this.enabled = process.env.SMART_PLUG_ENABLED === 'true';
  }

  // Mendapatkan token akses dari Tuya (Valid 2 jam)
  async getToken() {
    const timestamp = Date.now();
    const sign = this.calcSign('', 'GET', '/v1.0/token?grant_type=1', timestamp);
    
    try {
      const response = await axios.get(`${this.baseUrl}/v1.0/token?grant_type=1`, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign,
        }
      });
      return response.data.result.access_token;
    } catch (err) {
      console.error('[Tuya] Gagal ambil token:', err.response?.data || err.message);
      return null;
    }
  }

  // Mengirim perintah ke Colokan (ON / OFF)
  async controlDevice(deviceId, action) {
    if (!this.enabled) {
      console.log('[Tuya] Fitur Smart Plug sedang dinonaktifkan (SMART_PLUG_ENABLED=false).');
      return;
    }

    if (!this.accessId || !this.accessSecret || !deviceId) {
      console.warn('[Tuya] Konfigurasi belum lengkap, perintah diabaikan.');
      return;
    }

    const token = await this.getToken();
    if (!token) return;

    const timestamp = Date.now();
    const value = action === 'ON';
    
    // Payload standar untuk Smart Plug Tuya
    const body = {
      commands: [
        {
          code: 'switch_1', // Kode umum untuk colokan 1 lubang
          value: value
        }
      ]
    };

    const strBody = JSON.stringify(body);
    const sign = this.calcSign(strBody, 'POST', `/v1.0/devices/${deviceId}/commands`, timestamp, token);

    try {
      await axios.post(`${this.baseUrl}/v1.0/devices/${deviceId}/commands`, body, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign,
          'access_token': token,
          'Content-Type': 'application/json'
        }
      });
      console.log(`[Tuya] Perangkat ${deviceId} berhasil diubah ke ${action}`);
    } catch (err) {
      console.error(`[Tuya] Gagal kontrol perangkat ${deviceId}:`, err.response?.data || err.message);
    }
  }

  // Helper untuk menghitung Signature Tuya (Keamanan)
  calcSign(body, method, url, timestamp, token = '') {
    const strBody = body ? crypto.createHash('sha256').update(body).digest('hex') : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const stringToSign = [method, strBody, '', url].join('\n');
    const signStr = this.accessId + token + timestamp + stringToSign;
    return crypto.createHmac('sha256', this.accessSecret).update(signStr).digest('hex').toUpperCase();
  }
}

module.exports = new TuyaService();
