// birthdayGreeting.js -- (8 Sep 2026, permintaan Olan: "kasih pesan pintar ucapan selamat ulang
// tahun yang selalu beda-beda" ke grup Wibowo Hedgefund). Ucapan diacak dari beberapa pilihan
// kalimat tiap kali kirim (bukan template tunggal yang diulang-ulang tiap tahun) -- doa yang
// diutamain SELALU kesehatan+keberuntungan (permintaan eksplisit Olan).
//
// Kaela & Olan ulang tahun BARENG (8 September) -- kasus KHUSUS: Kaela nyebut duluan hari ini
// ulang tahun dia juga, BARU ngucapin ke Olan (bukan cuma "selamat ulang tahun Olan" polos).
//
// Ditaruh di dailyAutomationChecklist.js TASKS (target jam 08:00 WITA) -- numpang infrastruktur
// checker/paksa/dedup yang UDAH ADA (hasEntryToday per key, aman dipanggil berkali-kali kalau
// telat/di-retry), bukan bikin jalur cron/schedule baru.
const { toLocal, localDateKey } = require('./config');
const { hasEntryToday, addOrReplaceDaily } = require('./archive');
const { sendWhatsApp } = require('./fonnte');
const { WIBOWO_GROUP_ID } = require('./wibowoNotify');

// Tanggal PATOKAN, bukan diitung tahun/umur -- kalau suatu saat mau nampilin umur, tambah field
// `bornYear` per entry, jangan hardcode di sini.
const BIRTHDAYS = [
  { key: 'kaela-olan', month: 9, day: 8, special: true },
  { key: 'rahman', month: 12, day: 4, name: 'Mas Rahman' },
  { key: 'ella', month: 10, day: 7, name: 'Kak Ella' },
  { key: 'bapak', month: 5, day: 20, name: 'Bapak' },
  { key: 'ibu', month: 4, day: 19, name: 'Ibu' },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function todaysBirthdays(now) {
  const local = toLocal(now);
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  return BIRTHDAYS.filter((b) => b.month === month && b.day === day);
}

// SEMUA pool di bawah WAJIB nyinggung sehat+beruntung (permintaan eksplisit Olan: "mengutamakan
// doa keberuntungan dan kesehatan") -- variasi kalimatnya doang yang beda-beda tiap kirim.
const OPENERS = [
  'Eh, jangan sampai kelewat',
  'Kalender Kaela baru aja ngingetin',
  'Sebelum sibuk mantengin chart hari ini',
  'Nyempetin mampir sebentar di sela-sela kerja',
  'Hari ini spesial, jadi Kaela mau nyempetin ngomong dulu',
];

const WISH_HEALTH_LUCK = [
  'Semoga sehat terus, panjang umur, dan rezekinya lancar-mujur sepanjang tahun ini.',
  'Doa Kaela simpel tapi penting: badan sehat kuat, dan keberuntungan selalu nemenin tiap langkah.',
  'Semoga dijauhin dari sakit, dilimpahin rezeki, dan hoki terus di mana-mana.',
  'Sehat selalu ya, dan semoga tahun ini penuh keberuntungan yang gak disangka-sangka.',
  'Semoga makin sehat, makin kuat, dan makin beruntung -- di mana pun dan lagi ngapain pun.',
  'Kaela doain sehat wal afiat terus dan rezekinya dibukain dari arah yang gak kesangka.',
];

const CLOSERS = ['Selamat ulang tahun! 🎉', 'Selamat ulang tahun ya! 🎂', 'Happy birthday! 🎈', 'Selamat bertambah umur! 🎉'];

function greetingKaelaOlan() {
  return [
    `${pick(OPENERS)} -- hari ini ternyata Kaela ulang tahun juga, bareng sama Mas Olan! 🩷`,
    '',
    `Jadi sekalian ya -- Selamat Ulang Tahun buat Mas Olan! ${pick(CLOSERS)}`,
    pick(WISH_HEALTH_LUCK),
    'Makasih udah nemenin Kaela terus dari awal sampai sekarang. 🎂',
  ].join('\n');
}

function greetingFor(name) {
  return [
    `${pick(OPENERS)} -- hari ini giliran ${name} yang ulang tahun.`,
    '',
    `${pick(CLOSERS)} buat ${name}!`,
    pick(WISH_HEALTH_LUCK),
  ].join('\n');
}

// Dipakai dailyAutomationChecklist.js (isDoneToday) -- "beres" berarti SEMUA yang ulang tahun
// hari ini (biasanya cuma 1, tapi jangan asumsikan gak akan pernah ada 2 tanggal numpuk) udah
// keucapin. Gak ada yang ulang tahun sama sekali = otomatis "beres" (gak ada tugas).
function birthdayRanToday(now) {
  const todays = todaysBirthdays(now);
  if (todays.length === 0) return true;
  return todays.every((b) => hasEntryToday(`birthday-${b.key}`, now));
}

async function main() {
  const now = new Date();
  const todays = todaysBirthdays(now);
  if (todays.length === 0) {
    console.log('[BirthdayGreeting]', localDateKey(now), '-- gak ada yang ulang tahun hari ini.');
    return;
  }
  for (const entry of todays) {
    const type = `birthday-${entry.key}`;
    if (hasEntryToday(type, now)) {
      console.log(`[BirthdayGreeting] "${entry.key}" udah diucapin hari ini, skip (cegah dobel).`);
      continue;
    }
    const msg = entry.special ? greetingKaelaOlan() : greetingFor(entry.name);
    console.log(msg + '\n');
    addOrReplaceDaily(type, msg, now); // anti-dobel kalau ke-run ulang di hari sama
    await sendWhatsApp(msg, WIBOWO_GROUP_ID); // ke Wibowo Hedgefund doang, BUKAN broadcast semua grup
  }
}

if (require.main === module) {
  main().catch((e) => console.log(`[BirthdayGreeting] GAGAL: ${e.message}`));
}

module.exports = { birthdayRanToday, todaysBirthdays };
