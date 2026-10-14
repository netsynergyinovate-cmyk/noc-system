#!/bin/sh
set -e

echo "[GenieACS] Menyiapkan layanan GenieACS TR-069..."
echo "[GenieACS] Terhubung ke MongoDB: $GENIEACS_MONGODB_CONNECTION_URL"

# Jalankan 4 modul GenieACS secara paralel di latar belakang
echo "[GenieACS] Menjalankan genieacs-cwmp (Port 7547)..."
genieacs-cwmp &
PID_CWMP=$!

echo "[GenieACS] Menjalankan genieacs-nbi (Port 7557)..."
genieacs-nbi &
PID_NBI=$!

echo "[GenieACS] Menjalankan genieacs-fs (Port 7567)..."
genieacs-fs &
PID_FS=$!

echo "[GenieACS] Menjalankan genieacs-ui (Port 7558)..."
genieacs-ui &
PID_UI=$!

# Tangani sinyal shutdown graceful
trap 'kill $PID_CWMP $PID_NBI $PID_FS $PID_UI; exit 0' SIGTERM SIGINT

echo "[GenieACS] Seluruh layanan GenieACS aktif dan siap menerima koneksi!"

# Jaga container tetap berjalan selama proses anak aktif
wait -n $PID_CWMP $PID_NBI $PID_FS $PID_UI

