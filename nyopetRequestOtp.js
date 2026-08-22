// Runner buat workflow nyopet-request-otp.yml -- generate + kirim OTP ke WA Olan.
const { requestOtp } = require('./nyopetOtp');

requestOtp()
  .then(() => console.log('[NyopetRequestOtp] OTP dikirim.'))
  .catch((e) => { console.error('ERROR nyopetRequestOtp.js:', e.message); process.exit(1); });
