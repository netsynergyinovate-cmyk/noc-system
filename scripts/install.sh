#!/usr/bin/env bash
# ==============================================================================
# NOC SYSTEM - One-Command Server Bootstrap & Installer for Ubuntu
# Penggunaan di Server Ubuntu:
#   curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash
# Atau jalankan langsung:
#   sudo bash scripts/install.sh
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "=========================================================="
echo "      NOC SYSTEM - SERVER NATIVE UBUNTU INSTALLER         "
echo "=========================================================="
echo -e "${NC}"

# 1. Pastikan dijalankan sebagai root / sudo
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}Error: Skrip ini wajib dijalankan sebagai root (gunakan: sudo bash install.sh)${NC}" >&2
  exit 1
fi

if [ -n "${SUDO_USER:-}" ] && id -u "${SUDO_USER}" &>/dev/null; then
  DEPLOY_USER="${SUDO_USER}"
else
  FIRST_REGULAR_USER="$(awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }' /etc/passwd 2>/dev/null || true)"
  if [ -n "${FIRST_REGULAR_USER}" ] && id -u "${FIRST_REGULAR_USER}" &>/dev/null; then
    DEPLOY_USER="${FIRST_REGULAR_USER}"
  else
    DEPLOY_USER="$(id -un)"
  fi
fi
DEPLOY_GROUP="$(id -gn "${DEPLOY_USER}" 2>/dev/null || echo "${DEPLOY_USER}")"
echo -e "${GREEN}✓ Menjalankan instalasi untuk user: ${BOLD}${DEPLOY_USER}:${DEPLOY_GROUP}${NC}"

# 2. Buat dedicated system user & group 'noc' untuk layanan systemd
if ! id -u noc &>/dev/null; then
  echo -e "${YELLOW}Membuat user sistem 'noc' untuk unit systemd...${NC}"
  useradd --system --no-create-home --home-dir /srv/noc --shell /usr/sbin/nologin noc
fi

# 2. Pemeriksaan Pra-Instalasi (Pre-flight System Check)
echo -e "\n${CYAN}Memeriksa kesiapan spesifikasi perangkat keras & sistem...${NC}"

# 2a. Periksa CPU Cores
N_CPU=$(nproc 2>/dev/null || echo "1")
if [ "${N_CPU}" -lt 2 ]; then
  echo -e "${YELLOW}⚠ Perhatian: Server memiliki ${N_CPU} CPU core. Rekomendasi minimal 2 cores agar Next.js dan Go kompilasi lancar.${NC}"
else
  echo -e "${GREEN}✓ CPU Cores: ${N_CPU} Cores${NC}"
fi

# 2b. Periksa RAM & Aktifkan Swap Darurat jika perlu
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "4096")
TOTAL_SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo "4096")
if [ "${TOTAL_RAM_MB}" -lt 2500 ] && [ "${TOTAL_SWAP_MB}" -lt 512 ]; then
  echo -e "${YELLOW}⚠ RAM server terbatas (${TOTAL_RAM_MB}MB) tanpa swap. Menyiapkan 2GB swapfile darurat (/swapfile) agar kompilasi bebas dari Linux OOM Killer...${NC}"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null || true
  if [ -f /swapfile ]; then
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1 || true
    swapon /swapfile >/dev/null 2>&1 || true
    if ! grep -q "/swapfile" /etc/fstab 2>/dev/null; then
      echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    echo -e "${GREEN}✓ Swap 2GB berhasil diaktifkan (/swapfile).${NC}"
  fi
else
  echo -e "${GREEN}✓ Memori RAM: ${TOTAL_RAM_MB}MB • Swap: ${TOTAL_SWAP_MB}MB${NC}"
fi

# 2c. Periksa Sisa Ruang Disk (Minimal 5GB)
FREE_DISK_MB=$(df -m / 2>/dev/null | awk 'NR==2{print $4}' || echo "10000")
if [ "${FREE_DISK_MB}" -lt 5000 ]; then
  echo -e "${YELLOW}⚠ Peringatan: Ruang disk bebas hanya tersisa ${FREE_DISK_MB}MB. Rekomendasi minimal 5000MB bebas.${NC}"
else
  echo -e "${GREEN}✓ Ruang Disk Bebas: $((FREE_DISK_MB / 1024)) GB (${FREE_DISK_MB} MB)${NC}"
fi

# 2d. Periksa Bentrok Port Penting (3000, 8080, 5432)
for P in 3000 8080 5432; do
  if ss -tulpn 2>/dev/null | grep -q ":${P} "; then
    echo -e "${YELLOW}⚠ Catatan: Port ${P} terdeteksi sedang digunakan proses lain. Pastikan tidak bentrok dengan daemon non-NOC.${NC}"
  fi
done

# 2e. Tangani Kunci apt/dpkg jika Sedang Terkunci Proses Sistem (mis. unattended-upgrades)
for i in $(seq 1 10); do
  if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
    echo -e "${YELLOW}apt/dpkg sedang terkunci oleh proses sistem latar belakang. Menunggu kunci dilepas (detik ke-$((i*3)))...${NC}"
    sleep 3
  else
    break
  fi
done

# 3. Update apt dan paket dasar
echo -e "\n${CYAN}1/6 Memperbarui paket sistem dan memasang dependensi dasar (estimasi 30–60 detik)...${NC}"
apt-get update -y
apt-get install -y curl wget git jq ca-certificates gnupg lsb-release build-essential openssl sudo

# 4. Pasang Docker jika belum ada
echo -e "\n${CYAN}2/6 Memeriksa Docker Engine & Docker Compose (estimasi 1–2 menit)...${NC}"
if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}Docker belum terpasang. Memasang Docker CE resmi...${NC}"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  chmod a+r /etc/apt/keyrings/docker.gpg

  UBUNTU_CODENAME="$(lsb_release -cs)"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  usermod -aG docker noc || true
  usermod -aG docker,systemd-journal,noc "${DEPLOY_USER}" || true
  echo -e "${GREEN}✓ Docker CE berhasil dipasang.${NC}"
else
  systemctl enable --now docker || true
  usermod -aG docker noc || true
  usermod -aG docker,systemd-journal,noc "${DEPLOY_USER}" || true
  echo -e "${GREEN}✓ Docker sudah terpasang: $(docker --version)${NC}"
fi

# Konfigurasi NOPASSWD sudo untuk systemctl agar restart layanan over SSH / CLI tidak menuntut interaksi
SUDOERS_FILE="/etc/sudoers.d/noc-systemd"
TMP_SUDO="$(mktemp)"
cat <<EOF > "${TMP_SUDO}"
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart noc-web noc-backend, /bin/systemctl restart noc-backend noc-web, /bin/systemctl restart noc-web, /bin/systemctl restart noc-backend, /bin/systemctl is-enabled noc-web noc-backend, /bin/systemctl is-active noc-web noc-backend, /bin/systemctl status noc-web noc-backend, /usr/bin/systemctl restart noc-web noc-backend, /usr/bin/systemctl restart noc-backend noc-web, /usr/bin/systemctl restart noc-web, /usr/bin/systemctl restart noc-backend, /usr/bin/systemctl is-enabled noc-web noc-backend, /usr/bin/systemctl is-active noc-web noc-backend, /usr/bin/systemctl status noc-web noc-backend
EOF
if command -v visudo &>/dev/null; then
  if visudo -cf "${TMP_SUDO}" &>/dev/null; then
    install -m 0440 "${TMP_SUDO}" "${SUDOERS_FILE}"
  else
    echo -e "${RED}Peringatan: Validasi visudo gagal, aturan sudoers dilewati.${NC}" >&2
  fi
else
  install -m 0440 "${TMP_SUDO}" "${SUDOERS_FILE}"
fi
rm -f "${TMP_SUDO}"

# 4. Pasang Node.js 22 LTS jika belum ada / versi < 22
echo -e "\n${CYAN}3/6 Memeriksa Node.js runtime...${NC}"
NODE_OK=0
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 22 ]; then
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -eq 0 ]; then
  echo -e "${YELLOW}Memasang Node.js 22.x LTS dari NodeSource...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  echo -e "${GREEN}✓ Node.js $(node -v) dan npm $(npm -v) berhasil dipasang.${NC}"
else
  echo -e "${GREEN}✓ Node.js sudah sesuai: $(node -v)${NC}"
fi

# 5. Pasang Go Compiler (Golang) jika belum ada atau versi < 1.25
echo -e "\n${CYAN}4/6 Memeriksa Go Compiler untuk backend Go...${NC}"
GO_OK=0
if command -v go &>/dev/null; then
  RAW_VER=$(go version 2>/dev/null || true)
  GO_MAJOR=$(echo "$RAW_VER" | grep -oE "go[0-9]+\.[0-9]+" | sed 's/go//' | cut -d. -f1)
  GO_MINOR=$(echo "$RAW_VER" | grep -oE "go[0-9]+\.[0-9]+" | sed 's/go//' | cut -d. -f2)
  if [ "${GO_MAJOR:-0}" -gt 1 ] 2>/dev/null || { [ "${GO_MAJOR:-0}" -eq 1 ] && [ "${GO_MINOR:-0}" -ge 25 ]; } 2>/dev/null; then
    GO_OK=1
  fi
fi

if [ "$GO_OK" -eq 0 ]; then
  ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "${ARCH}" in
    arm64|aarch64) GO_ARCH="arm64" ;;
    *) GO_ARCH="amd64" ;;
  esac
  GO_TAR="go1.25.0.linux-${GO_ARCH}.tar.gz"
  echo -e "${YELLOW}Memasang Go 1.25 (${GO_ARCH}) via tarball resmi...${NC}"
  wget -q "https://go.dev/dl/${GO_TAR}" -O "/tmp/${GO_TAR}"
  rm -rf /usr/local/go && tar -C /usr/local -xzf "/tmp/${GO_TAR}"
  rm -f "/tmp/${GO_TAR}"
  ln -sfn /usr/local/go/bin/go /usr/local/bin/go
  ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  echo -e "${GREEN}✓ Go compiler berhasil disiapkan: $(go version)${NC}"
else
  echo -e "${GREEN}✓ Go compiler sudah sesuai: $(go version)${NC}"
fi

# 6. Siapkan direktori /srv/noc dan clone/update source code
echo -e "\n${CYAN}5/6 Menyiapkan hierarki /srv/noc dan repositori...${NC}"
mkdir -p /srv/noc/releases /srv/noc/shared /srv/noc/backups /srv/noc/src
chown -R "${DEPLOY_USER}:noc" /srv/noc
find /srv/noc -type d -exec chmod 2775 {} + 2>/dev/null || true

SRC_DIR="/srv/noc/src"
if [ ! -d "${SRC_DIR}/.git" ]; then
  echo -e "${YELLOW}Meng-clone repositori NOC System ke ${SRC_DIR}...${NC}"
  CLONE_URL="https://github.com/netsynergyinovate-cmyk/noc-system.git"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/netsynergyinovate-cmyk/noc-system.git"
  fi
  if ! git clone "${CLONE_URL}" "${SRC_DIR}"; then
    echo -e "${RED}Gagal meng-clone repositori.${NC}"
    echo -e "${YELLOW}Jika repositori privat di GitHub, jalankan instalasi dengan menyertakan GITHUB_TOKEN:${NC}"
    echo -e "${CYAN}  GITHUB_TOKEN=ghp_xxx curl -fsSL <url-install.sh> | sudo GITHUB_TOKEN=ghp_xxx bash${NC}"
    echo -e "${YELLOW}Atau gunakan tautan unduh langsung dari dashboard web lokal /app/deploy.${NC}"
    exit 1
  fi
  cd "${SRC_DIR}"
  git checkout noc-system-main 2>/dev/null || git checkout main 2>/dev/null || true
else
  echo -e "${GREEN}✓ Repositori sudah ada di ${SRC_DIR}, memperbarui branch...${NC}"
  cd "${SRC_DIR}"
  git fetch --all --prune
  git checkout -B noc-system-main origin/noc-system-main 2>/dev/null || true
  git reset --hard origin/noc-system-main 2>/dev/null || true
fi

# Pasang dependensi npm di source (wajib npm ci agar paket native linux tidak terpotong)
echo -e "${CYAN}Memasang dependensi project (npm ci)...${NC}"
echo -e "${YELLOW}Mengunduh & mengekstrak dependensi (~500MB). Proses ini butuh 1–3 menit (tanpa progress bar interaktif di pipa curl). Harap tunggu...${NC}"
chown -R "${DEPLOY_USER}:${DEPLOY_GROUP}" "${SRC_DIR}"
if [ "${DEPLOY_USER}" = "root" ]; then
  npm ci --no-audit
else
  sudo -u "${DEPLOY_USER}" npm ci --no-audit
fi

SHARED_ENV="/srv/noc/shared/.env"
mkdir -p /srv/noc/shared
# Pasang unit systemd langsung sebagai root
if [ -f "${SRC_DIR}/systemd/noc-web.service" ] && [ -f "${SRC_DIR}/systemd/noc-backend.service" ]; then
  install -m 0644 "${SRC_DIR}/systemd/noc-web.service" /etc/systemd/system/noc-web.service
  install -m 0644 "${SRC_DIR}/systemd/noc-backend.service" /etc/systemd/system/noc-backend.service
  systemctl daemon-reload
  systemctl enable noc-web noc-backend 2>/dev/null || true
fi

# Pasang CLI global noc-system ke /usr/local/bin
chmod +x "${SRC_DIR}/bin/noc-system.mjs"
ln -sfn "${SRC_DIR}/bin/noc-system.mjs" /usr/local/bin/noc-system
echo -e "${GREEN}✓ Perintah CLI 'noc-system' terhubung secara global di /usr/local/bin/noc-system${NC}"
# 7. Jalankan instalasi awal noc-system dengan grup docker yang langsung aktif
echo -e "\n${CYAN}6/6 Menjalankan instalasi awal layanan via noc-system...${NC}"
cd "${SRC_DIR}"
if [ "${DEPLOY_USER}" = "root" ]; then
  NOC_DEVICE_SECRET="${NOC_DEVICE_SECRET:-}" NOC_PUBLIC_URL="${NOC_PUBLIC_URL:-}" node bin/noc-system.mjs install
else
  sudo -u "${DEPLOY_USER}" --preserve-env=NOC_DEVICE_SECRET,NOC_PUBLIC_URL,NOC_ROUTER_SECRET_KEY,NOC_ADMIN_EMAIL,NOC_ADMIN_NAME,NOC_ADMIN_PASSWORD,GITHUB_TOKEN sg docker -c "node bin/noc-system.mjs install"
fi

# 8. Helper untuk memastikan nilai .env terpasang (mengganti jika sudah ada, menambahkan jika belum)
set_env_val() {
  local k="$1"
  local v="$2"
  local f="$3"
  if grep -q "^${k}=" "${f}" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "${f}"
  else
    echo "${k}=${v}" >> "${f}"
  fi
}

# 9. Pastikan konfigurasi Live Dashboard, GenieACS, dan OSRM di shared .env
if [ -f "${SHARED_ENV}" ]; then
  set_env_val "DASHBOARD_DATA" "live" "${SHARED_ENV}"
  set_env_val "DATA_MODE" "nyata" "${SHARED_ENV}"
  set_env_val "GENIEACS_MODE" "real" "${SHARED_ENV}"
  set_env_val "GENIEACS_NBI_URL" "http://127.0.0.1:7557" "${SHARED_ENV}"
  set_env_val "GENIEACS_URL" "http://127.0.0.1:7557" "${SHARED_ENV}"
  set_env_val "OSRM_BASE_URL" "http://127.0.0.1:5000" "${SHARED_ENV}"

  if ! grep -q "^GENIEACS_JWT_SECRET=\S\+" "${SHARED_ENV}" 2>/dev/null; then
    RAND_JWT=$(openssl rand -hex 32 2>/dev/null || date +%s | sha256sum | head -c 64)
    set_env_val "GENIEACS_JWT_SECRET" "${RAND_JWT}" "${SHARED_ENV}"
  fi
  if ! grep -E -q 'avx|avx2' /proc/cpuinfo 2>/dev/null; then
    set_env_val "GENIEACS_MONGO_IMAGE" "mongo:4.4" "${SHARED_ENV}"
  fi
fi

# 10. Jalankan kontainer GenieACS TR-069 via fitur standar noc-system
echo -e "\n${CYAN}Menyalakan kontainer Docker GenieACS TR-069 (CWMP:7547 & NBI:7557)...${NC}"
cd "${SRC_DIR}"
node bin/noc-system.mjs features up genieacs || echo -e "${YELLOW}Peringatan: Gagal menyalakan GenieACS otomatis.${NC}"


# 11. Penanganan OSRM Routing Engine (Opsional via NOC_ENABLE_OSRM=1)
if [ "${NOC_ENABLE_OSRM:-0}" = "1" ]; then
  echo -e "\n${CYAN}Menyiapkan kontainer Docker OSRM Routing Engine...${NC}"
  node bin/noc-system.mjs features up osrm || echo -e "${YELLOW}Peringatan: Gagal menyalakan OSRM.${NC}"
else
  echo -e "\n${CYAN}Catatan OSRM (Peta Snapping):${NC} Dilewati saat instalasi awal untuk menghemat RAM dan bandwidth."
  echo -e "Jalankan kapan saja via terminal: ${BOLD}noc-system features up osrm${NC}"
fi

# 12. Integrasi Domain Coolify Traefik (hanya jika NOC_DOMAIN diisi dan Coolify terpasang)
COOLIFY_DYNAMIC_DIR="/data/coolify/proxy/dynamic"
if [ -n "${NOC_DOMAIN:-}" ] && [ -d "${COOLIFY_DYNAMIC_DIR}" ]; then
  echo -e "\n${GREEN}✓ Coolify terdeteksi! Mengonfigurasi domain ${NOC_DOMAIN} pada Traefik Coolify...${NC}"
  COOLIFY_CFG="${COOLIFY_DYNAMIC_DIR}/noc-${NOC_DOMAIN}.yaml"
  cat <<EOF > "${COOLIFY_CFG}"
http:
  routers:
    noc-web-http:
      rule: "Host(\`${NOC_DOMAIN}\`)"
      service: noc-web-service
      entryPoints: ["web"]
    noc-web-https:
      rule: "Host(\`${NOC_DOMAIN}\`)"
      service: noc-web-service
      entryPoints: ["websecure"]
      tls:
        certResolver: "letsencrypt"
  services:
    noc-web-service:
      loadBalancer:
        servers:
          - url: "http://172.17.0.1:3000"
EOF
  echo -e "${GREEN}✓ Konfigurasi Traefik Coolify disimpan di ${COOLIFY_CFG}${NC}"
fi

# Pastikan user 'noc' dan group dapat mengakses shared, releases, backups dengan aman
chown -R noc:noc /srv/noc/releases /srv/noc/shared /srv/noc/backups 2>/dev/null || true
find /srv/noc -type d -exec chmod 2775 {} + 2>/dev/null || true
if [ -f "${SHARED_ENV}" ]; then
  chmod 0640 "${SHARED_ENV}"
  chown "${DEPLOY_USER}:noc" "${SHARED_ENV}" 2>/dev/null || true
fi


CURRENT_TOKEN=$(grep -E "^MONITOR_TOKEN=" "${SHARED_ENV}" 2>/dev/null | cut -d= -f2- || echo "")

# Deteksi IP Server untuk kemudahan input di /app/deploy
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PUBLIC_IP=$(curl -s -m 2 https://api.ipify.org 2>/dev/null || echo "")
# Jaringan lokal lebih dulu: IP publik (NAT) tidak meneruskan port 3000 ke server.
DISPLAY_IP="${SERVER_IP:-${PUBLIC_IP:-127.0.0.1}}"

echo -e "\n${GREEN}${BOLD}==========================================================${NC}"
echo -e "${GREEN}${BOLD}✓ INSTALASI BOOTSTRAP NOC SYSTEM BERHASIL!${NC}"
echo -e "${GREEN}${BOLD}==========================================================${NC}"
echo -e "${YELLOW}${BOLD}LANGKAH BERIKUTNYA DI SERVER:${NC}"
echo -e "Jalankan rilis dan build awal agar layanan web di port 3000 aktif:"
echo -e "  ${CYAN}${BOLD}sudo noc-system deploy${NC}\n"
echo -e "Perintah ${CYAN}noc-system${NC} siap digunakan kapan saja:"
echo -e "  - ${BOLD}noc-system deploy${NC}    : Rilis versi saat ini (build + migrasi + restart)"
echo -e "  - ${BOLD}noc-system update${NC}    : Ambil kode terbaru dari git, build & rilis otomatis"
echo -e "  - ${BOLD}noc-system doctor${NC}    : Periksa kesiapan spesifikasi (CPU, RAM, Swap, Disk, Port, Docker)"
echo -e "  - ${BOLD}noc-system features${NC}  : Ringkasan status 7 fitur ekosistem aplikasi & perintah Docker"
echo -e "  - ${BOLD}noc-system status${NC}    : Cek status versi, systemd, dan docker"
echo -e "  - ${BOLD}noc-system logs${NC}      : Pantau live log journalctl"
echo -e "  - ${BOLD}noc-system rollback${NC}  : Kembali ke rilis sebelumnya jika ada bug"
if [ -n "${CURRENT_TOKEN}" ]; then
  echo -e "\n${YELLOW}${BOLD}KREDENSIAL PEMANTAU REAL-TIME (DASHBOARD /app/deploy):${NC}"
  echo -e "  ${BOLD}1. Alamat Server :${NC} ${GREEN}http://${DISPLAY_IP}:3000${NC} (gunakan ini jika belum ada domain)"
  [ -n "${PUBLIC_IP}" ] && [ "${PUBLIC_IP}" != "${DISPLAY_IP}" ] && echo -e "     IP publik ${PUBLIC_IP} hanya bisa dipakai jika port 3000 diteruskan (port forward) di router."
  echo -e "  ${BOLD}2. Token Monitor :${NC} ${CYAN}${CURRENT_TOKEN}${NC}"
  echo -e "\n${NC}Salin kedua nilai di atas ke tab 'CLI noc-system' pada halaman ${BOLD}/app/deploy${NC} setelah 'sudo noc-system deploy' selesai."
fi
if [ -d "/data/coolify" ]; then
  echo -e "\n${CYAN}${BOLD}PEMANTAUAN DI DASHBOARD COOLIFY:${NC}"
  echo -e "  - Kontainer Docker NOC terpantau di menu: ${GREEN}Coolify -> Servers -> [Pilih Server] -> Docker Containers${NC}."
  if [ -n "${NOC_DOMAIN:-}" ]; then
    echo -e "  - Domain ${BOLD}${NOC_DOMAIN}${NC} telah otomatis diarahkan lewat Traefik Coolify ke port 3000."
  else
    echo -e "  - Untuk menghubungkan domain Coolify ke aplikasi, jalankan dengan variabel domain:"
    echo -e "      ${CYAN}NOC_DOMAIN=noc.domainanda.com sudo bash scripts/install.sh${NC}"
  fi
fi
echo -e "\n${YELLOW}${BOLD}LOGIN SUPERADMIN:${NC} ${GREEN}${NOC_ADMIN_EMAIL:-admin@noc.local}${NC}"
echo -e "Kata sandi dicetak SEKALI di bagian 'Akun NOC' di atas (jika tidak terlihat, buat ulang: ${CYAN}noc-system admin create --reset-password${NC})."
echo ""
