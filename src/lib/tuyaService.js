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

  // Menghitung Signature sesuai standar Tuya v1.0
  calcSign(body, method, url, timestamp, token = '') {
    const strBody = body ? crypto.createHash('sha256').update(body).digest('hex') : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const stringToSign = [method, strBody, '', url].join('\n');
    const signStr = this.accessId + token + timestamp + stringToSign;
    return crypto.createHmac('sha256', this.accessSecret).update(signStr).digest('hex').toUpperCase();
  }

  // Mengambil Access Token dari Tuya
  async getToken() {
    const timestamp = Date.now();
    const url = '/v1.0/token?grant_type=1';
    const sign = this.calcSign('', 'GET', url, timestamp);

    try {
      const res = await axios.get(`${this.baseUrl}${url}`, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign
        }
      });
      if (res.data.success) {
        return res.data.result.access_token;
      }
      console.error(`[Tuya] Gagal ambil Token: ${res.data.msg} (Code: ${res.data.code})`);
      return null;
    } catch (err) {
      console.error('[Tuya] Error Auth (Check Network/URL):', err.message);
      return null;
    }
  }

  // Mengirim perintah ke Colokan (ON / OFF)
  async controlDevice(deviceId, action) {
    if (!this.enabled || !deviceId) return;

    const token = await this.getToken();
    if (!token) {
      console.error('[Tuya] Perintah dibatalkan karena Token gagal didapat.');
      return;
    }

    const timestamp = Date.now();
    const value = action === 'ON';
    
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
      const res = await axios.post(`${this.baseUrl}${url}`, body, {
        headers: {
          't': timestamp,
          'sign_method': 'HMAC-SHA256',
          'client_id': this.accessId,
          'sign': sign,
          'access_token': token,
          'Content-Type': 'application/json'
        }
      });
      
      if (res.data.success) {
        console.log(`[Tuya] SUCCESS! Device ${deviceId} is now ${action}`);
      } else {
        console.error(`[Tuya] FAILED: ${res.data.msg} (Code: ${res.data.code})`);
        if (res.data.code === 1106) console.warn('[Tuya] TIP: Pastikan "IoT Core" sudah Authorized di Service API portal Tuya.');
      }
    } catch (err) {
      console.error(`[Tuya] NETWORK ERROR on ${deviceId}:`, err.response?.data || err.message);
    }
  }
}

module.exports = new TuyaService();
