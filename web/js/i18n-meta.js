// i18n-meta.js (29 Agu 2026) -- toggle bahasa ID/EN buat halaman metodologi/analis (web lama,
// project kaela-btc-sinyal, TERPISAH dari dashboard.html Kaela Access). Pola SAMA kayak T()/
// applyLanguage() di dashboard.html, versi ringan: tiap halaman isi I18N_META sendiri lewat
// <script> inline SETELAH file ini di-load, baru panggil applyMetaLang().
//
// Prioritas bahasa: ?lang=en di URL (biar Kaela Access bisa nge-drive iframe-nya lewat query
// string) > localStorage (inget pilihan manual pas dibuka langsung, bukan lewat iframe) > id.
var I18N_META = {};

function metaLangFromUrl() {
  try {
    var qs = new URLSearchParams(location.search);
    var q = qs.get('lang');
    if (q === 'en' || q === 'id') return q;
  } catch (e) {}
  return null;
}

var currentMetaLang = metaLangFromUrl() || (function () {
  try { return localStorage.getItem('kaela_meta_lang') === 'en' ? 'en' : 'id'; } catch (e) { return 'id'; }
})();

function T_META(key) {
  var entry = I18N_META[key];
  if (!entry) return key;
  return entry[currentMetaLang] || entry.id;
}

function applyMetaLang() {
  document.documentElement.lang = currentMetaLang;
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.innerHTML = T_META(el.getAttribute('data-i18n'));
  });
  var btn = document.getElementById('metaLangBtn');
  if (btn) btn.textContent = currentMetaLang === 'id' ? '🇬🇧 English' : '🇮🇩 Indonesia';
}

function toggleMetaLang() {
  currentMetaLang = currentMetaLang === 'id' ? 'en' : 'id';
  try { localStorage.setItem('kaela_meta_lang', currentMetaLang); } catch (e) {}
  applyMetaLang();
}
