# Vidcomp — Kompres Video, Atur Reso/FPS/Bitrate Sendiri

Website statis (HTML + CSS + JS murni, tanpa framework, tanpa build step) untuk
mengompres banyak video sekaligus menjadi **H.264 (mp4)** dengan resolusi, fps,
dan bitrate video yang bisa dipilih sendiri, langsung di browser pengguna
memakai [ffmpeg.wasm](https://ffmpegwasm.netlify.app/).

Video **tidak pernah diunggah ke server** — semua proses terjadi di perangkat
pengguna lewat WebAssembly. Karena itu tidak ada batas ukuran upload dan tidak
perlu backend/serverless function sama sekali, sehingga aman dari batas
payload/timeout milik Vercel.

## Struktur file

```
index.html   -> struktur halaman
styles.css   -> tampilan (tema "console/scope" gelap)
app.js       -> logika kompresi (memuat ffmpeg.wasm dari CDN, proses antrean)
```

Tidak ada `package.json`, dependency npm, atau langkah build. `@ffmpeg/ffmpeg`
dan `@ffmpeg/util` dimuat langsung sebagai ES module dari CDN (esm.sh) di
dalam `app.js`, dan file core ffmpeg (`ffmpeg-core.js` / `.wasm`) diambil dari
unpkg. Ini sengaja dibuat sesederhana mungkin supaya deploy ke Vercel tidak
mungkin gagal karena error build.

## Cara deploy ke Vercel

**Opsi A — lewat dashboard Vercel**
1. Push folder ini ke sebuah repo GitHub/GitLab/Bitbucket.
2. Di Vercel: *Add New Project* → import repo tersebut.
3. Saat diminta "Framework Preset", pilih **Other** (Vercel akan mendeteksi
   ini otomatis karena tidak ada `package.json`).
4. Kosongkan Build Command dan Output Directory (biarkan default) — klik **Deploy**.

**Opsi B — lewat Vercel CLI**
```bash
npm i -g vercel   # kalau belum ada
cd video-compressor
vercel --prod
```
Ikuti saja instruksi di terminal (pilih scope/project baru). Karena ini situs
statis murni, tidak akan ada langkah build yang bisa gagal.

## Cara pakai

1. Buka situsnya, tunggu status berubah jadi "Siap" (mesin kompresi ~25 MB
   dimuat sekali di awal).
2. Klik/drag beberapa file video sekaligus ke area drop. Klik pada dropzone
   membuka pemilih **file/berkas** (bukan galeri foto/video) lewat atribut
   `accept` yang sengaja dicampur dengan tipe generik — ini heuristik
   browser (Chrome/Safari), bukan jaminan 100% di semua perangkat.
3. Atur **Resolusi**, **Frame rate**, dan **Bitrate video** — nilai yang
   dipilih langsung terlihat di garis keterangan atas (mis. `1080p · 45fps ·
   6 Mbps`) dan ditempel di tiap baris file di daftar.
4. Klik **Kompres semua** — video diproses satu per satu sesuai spesifikasi
   yang terkunci saat tombol diklik, tiap video yang selesai langsung punya
   tombol **Unduh** (nama file memuat reso/fps/bitrate yang dipakai).

## Catatan teknis & batasan

- Perintah ffmpeg inti: `scale=-2:'min(ih,H)' -r FPS -c:v libx264 -b:v Bk
  -maxrate 1.5Bk -bufsize 2Bk -c:a aac`. Bitrate target dipakai langsung
  (bukan CRF) supaya angka bitrate yang ditampilkan ke pengguna akurat;
  `-maxrate`/`-bufsize` menahan lonjakan bitrate saat adegan kompleks.
  Opsi "Asli" pada reso/fps melewati filter `scale`/`-r` sama sekali.
  Video sumber yang sudah lebih kecil dari resolusi target tidak di-upscale.
- ffmpeg.wasm berjalan single-threaded di browser (tidak butuh header
  COOP/COEP khusus), jadi kompatibel dengan hosting statis Vercel apa adanya.
  Konsekuensinya: prosesnya berjalan di satu thread CPU, sehingga video yang
  besar/panjang akan memakan waktu — ini normal, bukan bug.
- Video diproses berurutan (satu per satu), bukan paralel, supaya memori
  browser tidak kehabisan saat menangani banyak file besar.
- Butuh browser modern dengan dukungan WebAssembly (Chrome/Edge/Firefox/Safari
  versi terbaru). Disarankan tidak memproses file berukuran belasan GB dalam
  satu tab karena batas memori browser.
- Membutuhkan koneksi internet saat pertama kali membuka halaman (untuk
  mengambil mesin ffmpeg.wasm dari CDN); setelah itu proses kompresi
  sepenuhnya offline/lokal di perangkat.
