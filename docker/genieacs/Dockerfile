FROM node:20-alpine

# Install dependensi sistem yang dibutuhkan oleh GenieACS
RUN apk add --no-cache python3 make g++ dumb-init

# Pasang GenieACS v1.2.13 dari npm
RUN npm install -g --omit=dev genieacs@1.2.13

# Siapkan direktori log dan konfigurasi
RUN mkdir -p /var/log/genieacs /opt/genieacs/ext /app

WORKDIR /app

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Port:
# 7547 = CWMP (TR-069 untuk modem/CPE)
# 7557 = NBI (REST API untuk NOC system)
# 7567 = FS (File server download firmware/config)
# 7558 = UI (Antarmuka web operator GenieACS)
EXPOSE 7547 7557 7567 7558

ENV GENIEACS_MONGODB_CONNECTION_URL="mongodb://genieacs-mongo:27017/genieacs"
ENV GENIEACS_CWMP_ACCESS_LOG_FILE="/var/log/genieacs/genieacs-cwmp-access.log"
ENV GENIEACS_NBI_ACCESS_LOG_FILE="/var/log/genieacs/genieacs-nbi-access.log"
ENV GENIEACS_FS_ACCESS_LOG_FILE="/var/log/genieacs/genieacs-fs-access.log"
ENV GENIEACS_UI_ACCESS_LOG_FILE="/var/log/genieacs/genieacs-ui-access.log"
ENV GENIEACS_DEBUG_FILE="/var/log/genieacs/genieacs-debug.yaml"
ENV GENIEACS_LOG_INFORMS=true
ENV GENIEACS_EXT_DIR="/opt/genieacs/ext"

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/entrypoint.sh"]

