// Runner buat workflow nyopet-request-otp.yml -- generate + kirim OTP ke WA Olan.
const { requestOtp } = require('./rangerOtp');

requestOtp()
  .then(() => console.log('[RangerRequestOtp] OTP dikirim.'))
  .catch((e) => { console.error('ERROR rangerRequestOtp.js:', e.message); process.exit(1); });
