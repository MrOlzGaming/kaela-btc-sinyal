// OTP buat gerbang input Nyopet lewat web (22 Agu 2026, ganti dari PIN statis -- permintaan
// Olan: "permudah cara input, pake OTP japri aja, ga password-password an"). Kode 6 digit acak,
// dikirim WA LANGSUNG (DM, bukan grup) ke nomor Olan doang, sekali pakai, expire 10 menit.
//
// Kenapa lebih aman dari PIN statis: PIN yang sama dipakai berkali-kali bisa lupa dimatiin/ke-share
// gak sengaja. OTP baru tiap kali diminta, dan CUMA nyampe ke WhatsApp Olan sendiri -- orang lain
// walau tau ada halaman ini + token GitHub-nya, tetap gak bisa submit tanpa akses fisik ke HP Olan.

const fs = require('fs');
const path = require('path');
const { sendWhatsApp } = require('./fonnte');

const STATE_PATH = path.join(__dirname, 'nyopet-otp-state.json');
const OTP_TTL_MS = 10 * 60 * 1000; // 10 menit
const OLAN_NUMBER = '6281299303888'; // format internasional Fonnte (0 depan -> 62)

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { code: null, expiresAt: null, used: false };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digit, 100000-999999
}

// Generate OTP baru, simpan, kirim ke WA Olan (DM langsung, BUKAN grup -- override target
// default sendWhatsApp yang biasanya ngirim ke grup).
async function requestOtp() {
  const code = generateCode();
  const now = Date.now();
  saveState({ code, expiresAt: now + OTP_TTL_MS, used: false, requestedAt: new Date(now).toISOString() });
  const msg = [
    '🔐 *Kode OTP Input Nyopet*',
    '',
    `Kode kamu: *${code}*`,
    '',
    'Berlaku 10 menit, sekali pakai. Kalau bukan kamu yang minta, abaikan aja -- tanpa kode ini gak ada yang bisa keubah.',
  ].join('\n');
  await sendWhatsApp(msg, OLAN_NUMBER);
  return code;
}

// Verifikasi kode yang disubmit -- valid kalau: ada, belum expired, belum pernah dipakai, DAN cocok.
// Begitu valid, LANGSUNG ditandain used (one-time) -- caller WAJIB commit perubahan ini biar
// gak bisa di-replay pakai kode yang sama.
function verifyOtp(submittedCode) {
  const state = loadState();
  if (!state.code) return { valid: false, reason: 'Belum ada OTP yang diminta.' };
  if (state.used) return { valid: false, reason: 'OTP ini udah pernah dipakai.' };
  if (Date.now() > state.expiresAt) return { valid: false, reason: 'OTP udah expired (lebih dari 10 menit).' };
  if (String(submittedCode).trim() !== state.code) return { valid: false, reason: 'OTP salah.' };
  state.used = true;
  saveState(state);
  return { valid: true };
}

module.exports = { requestOtp, verifyOtp };
