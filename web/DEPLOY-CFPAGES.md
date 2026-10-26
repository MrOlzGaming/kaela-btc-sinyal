# Deploy Web Sniper ke Cloudflare Pages (26 Okt 2026)

> Menggantikan Netlify yang BLACKLISTED. Nama proyek CF: `kaela-trader-web`
> URL target: **https://kaela-trader-web.pages.dev**

## Langkah sekali (setup awal, ~10 menit)

### A. Buat proyek di Cloudflare Dashboard

1. Buka https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Upload assets**
2. Nama proyek: `kaela-trader-web`
3. Seret **isi folder `web/`** (yang berisi `index.html`, `jurnal.html`, dll) → Deploy
4. URL langsung jadi: `https://kaela-trader-web.pages.dev`

### B. Buat API Token untuk GitHub Actions

1. Di Cloudflare Dashboard → My Profile → **API Tokens → Create Token**
2. Template: **Edit Cloudflare Workers** (atau Custom Token dengan permission *Cloudflare Pages: Edit*)
3. Salin token (tampil sekali saja)
4. Catat juga **Account ID**: sidebar Cloudflare kanan bawah → "Account ID"

### C. Tambah secrets ke GitHub repo

Buka: https://github.com/MrOlzGaming/kaela-btc-sinyal → Settings → Secrets and variables → Actions

Tambah 2 secret:
| Nama | Nilai |
|---|---|
| `CF_API_TOKEN` | token dari langkah B |
| `CF_ACCOUNT_ID` | account ID dari langkah B |

### D. Jalankan workflow deploy

GitHub repo → **Actions → Deploy web/ ke Cloudflare Pages → Run workflow** → Run

Setelah selesai: buka https://kaela-trader-web.pages.dev — web Sniper live!

## Update berikutnya (kalau ada perubahan shell HTML/CSS)

Sama: Actions → Deploy web/ ke Cloudflare Pages → Run workflow.
Data JSON (sinyal/posisi) di-fetch langsung dari repo publik di browser — gak perlu deploy ulang.

## Alternatif: Direct Upload (tanpa GitHub Actions)

Kalau tidak mau setup token: ulangi langkah A (seret folder `web/` ke dashboard) setiap kali ada update.
