// Memaksa objek browser yang hilang agar terdefinisi di Node.js global scope
// Ini harus dieksekusi sebelum modul yang membutuhkan objek DOM dimuat.
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class {};
  global.DOMRect = class {};
  global.DOMPoint = class {};
  global.HTMLElement = class {};
}
if (typeof global.self === 'undefined') {
  global.self = global;
}
if (typeof global.window === 'undefined') {
  global.window = global;
}

import('./app.js').catch(err => {
    console.error("Gagal memuat aplikasi utama:", err);
    process.exit(0);
});