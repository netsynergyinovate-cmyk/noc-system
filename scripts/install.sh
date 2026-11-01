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

# 3. Update apt dan paket dasar
echo -e "\n${CYAN}1/6 Memperbarui paket sistem dan memasang dependensi dasar...${NC}"
apt-get update -y
apt-get install -y curl wget git jq ca-certificates gnupg lsb-release build-essential openssl sudo
# 3. Pasang Docker jika belum ada
echo -e "\n${CYAN}2/6 Memeriksa Docker Engine & Docker Compose...${NC}"
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

# 5. Pasang Go Compiler (Golang) jika belum ada
echo -e "\n${CYAN}4/6 Memeriksa Go Compiler untuk backend Go...${NC}"
if ! command -v go &>/dev/null; then
  ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "${ARCH}" in
    arm64|aarch64) GO_ARCH="arm64" ;;
    *) GO_ARCH="amd64" ;;
  esac
  GO_TAR="go1.23.6.linux-${GO_ARCH}.tar.gz"
  echo -e "${YELLOW}Compiler Go belum terpasang. Memasang Go 1.23 (${GO_ARCH}) via tarball...${NC}"
  wget -q "https://go.dev/dl/${GO_TAR}" -O "/tmp/${GO_TAR}"
  rm -rf /usr/local/go && tar -C /usr/local -xzf "/tmp/${GO_TAR}"
  rm -f "/tmp/${GO_TAR}"
  ln -sfn /usr/local/go/bin/go /usr/local/bin/go
  ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  echo -e "${GREEN}✓ Go compiler berhasil dipasang: $(go version)${NC}"
else
  echo -e "${GREEN}✓ Go compiler sudah ada: $(go version)${NC}"
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
chown -R "${DEPLOY_USER}:${DEPLOY_GROUP}" "${SRC_DIR}"
if [ "${DEPLOY_USER}" = "root" ]; then
  npm ci
else
  sudo -u "${DEPLOY_USER}" npm ci
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
  sudo -u "${DEPLOY_USER}" --preserve-env=NOC_DEVICE_SECRET,NOC_PUBLIC_URL,NOC_ROUTER_SECRET_KEY,GITHUB_TOKEN sg docker -c "node bin/noc-system.mjs install"
fi

# Pastikan user 'noc' dan group dapat mengakses shared, releases, backups dengan aman
chown -R noc:noc /srv/noc/releases /srv/noc/shared /srv/noc/backups 2>/dev/null || true
find /srv/noc -type d -exec chmod 2775 {} + 2>/dev/null || true
if [ -f "${SHARED_ENV}" ]; then
  chmod 0640 "${SHARED_ENV}"
  chown "${DEPLOY_USER}:noc" "${SHARED_ENV}" 2>/dev/null || true
fi


CURRENT_TOKEN=$(grep -E "^MONITOR_TOKEN=" "${SHARED_ENV}" 2>/dev/null | cut -d= -f2- || echo "")

echo -e "\n${GREEN}${BOLD}==========================================================${NC}"
echo -e "${GREEN}${BOLD}✓ INSTALASI BOOTSTRAP NOC SYSTEM BERHASIL!${NC}"
echo -e "${GREEN}${BOLD}==========================================================${NC}"
echo -e "Perintah ${CYAN}noc-system${NC} kini siap digunakan dari direktori mana saja:"
echo -e "  - ${BOLD}noc-system update${NC}    : Ambil kode terbaru dari git, build & rilis otomatis"
echo -e "  - ${BOLD}noc-system deploy${NC}    : Rilis versi saat ini (build + migrasi + restart)"
echo -e "  - ${BOLD}noc-system status${NC}    : Cek status versi, systemd, dan docker"
echo -e "  - ${BOLD}noc-system rollback${NC}  : Kembali ke rilis sebelumnya jika ada bug"
echo -e "  - ${BOLD}noc-system logs${NC}      : Pantau live log journalctl"
if [ -n "${CURRENT_TOKEN}" ]; then
  echo -e "\n${YELLOW}${BOLD}KUNCI PEMANTAU (MONITOR TOKEN):${NC}"
  echo -e "${CYAN}${CURRENT_TOKEN}${NC}"
  echo -e "${NC}Salin token di atas ke kolom 'Token Monitor' pada halaman /app/deploy untuk memantau server."
fi
echo ""
