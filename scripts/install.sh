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

SUDO_USER_NAME="${SUDO_USER:-$(logname 2>/dev/null || echo 'ubuntu')}"
echo -e "${GREEN}✓ Menjalankan instalasi untuk user: ${BOLD}${SUDO_USER_NAME}${NC}"

# 2. Update apt dan paket dasar
echo -e "\n${CYAN}1/6 Memperbarui paket sistem dan memasang dependensi dasar...${NC}"
apt-get update -y
apt-get install -y curl wget git jq ca-certificates gnupg lsb-release

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
  usermod -aG docker,systemd-journal "${SUDO_USER_NAME}" || true
  echo -e "${GREEN}✓ Docker CE berhasil dipasang.${NC}"
else
  usermod -aG docker,systemd-journal "${SUDO_USER_NAME}" || true
  echo -e "${GREEN}✓ Docker sudah terpasang: $(docker --version)${NC}"
fi

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
  echo -e "${YELLOW}Compiler Go belum terpasang. Memasang Go 1.23 via tarball...${NC}"
  GO_TAR="go1.23.6.linux-amd64.tar.gz"
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
chown -R "${SUDO_USER_NAME}:${SUDO_USER_NAME}" /srv/noc

SRC_DIR="/srv/noc/src"
if [ ! -d "${SRC_DIR}/.git" ]; then
  echo -e "${YELLOW}Meng-clone repositori NOC System ke ${SRC_DIR}...${NC}"
  git clone https://github.com/netsynergyinovate-cmyk/noc-system.git "${SRC_DIR}"
  cd "${SRC_DIR}"
  git checkout noc-system-main 2>/dev/null || git checkout main 2>/dev/null || true
else
  echo -e "${GREEN}✓ Repositori sudah ada di ${SRC_DIR}, memperbarui branch...${NC}"
  cd "${SRC_DIR}"
  git fetch --all --prune
fi

# Pasang dependensi npm di source (wajib npm ci agar paket native linux tidak terpotong)
echo -e "${CYAN}Memasang dependensi project (npm ci)...${NC}"
chown -R "${SUDO_USER_NAME}:${SUDO_USER_NAME}" "${SRC_DIR}"
sudo -u "${SUDO_USER_NAME}" npm ci

# Buat MONITOR_TOKEN acak jika belum ada di /srv/noc/shared/.env
SHARED_ENV="/srv/noc/shared/.env"
if [ -f "${SHARED_ENV}" ]; then
  if ! grep -qE "^MONITOR_TOKEN=[^<[:space:]]+" "${SHARED_ENV}"; then
    GENERATED_TOKEN=$(openssl rand -hex 24)
    if grep -q "^MONITOR_TOKEN=" "${SHARED_ENV}"; then
      sed -i -E "s|^MONITOR_TOKEN=.*|MONITOR_TOKEN=${GENERATED_TOKEN}|" "${SHARED_ENV}"
    else
      echo "MONITOR_TOKEN=${GENERATED_TOKEN}" >> "${SHARED_ENV}"
    fi
  fi
fi

# Pasang CLI global noc-system ke /usr/local/bin
chmod +x "${SRC_DIR}/bin/noc-system.mjs"
ln -sfn "${SRC_DIR}/bin/noc-system.mjs" /usr/local/bin/noc-system
echo -e "${GREEN}✓ Perintah CLI 'noc-system' terhubung secara global di /usr/local/bin/noc-system${NC}"

# 7. Jalankan instalasi awal noc-system dengan grup docker yang langsung aktif
echo -e "\n${CYAN}6/6 Menjalankan instalasi awal layanan via noc-system...${NC}"
cd "${SRC_DIR}"
sudo -u "${SUDO_USER_NAME}" sg docker -c "node bin/noc-system.mjs install"

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
