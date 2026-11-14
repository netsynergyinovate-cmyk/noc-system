-- Akun PostgreSQL hanya-baca untuk developer yang membaca DB server lewat SSH tunnel.
-- Jalankan SEKALI di server sebagai pemilik DB (POSTGRES_USER, bawaan "starter"), mis. dari terminal
-- container postgres di Coolify:  psql -U starter -d starter  lalu tempel isi berkas ini.
-- Password TIDAK ada di berkas ini: setelah selesai, jalankan  \password noc_dev_ro  di psql yang sama.

CREATE ROLE noc_dev_ro LOGIN;
ALTER ROLE noc_dev_ro SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE starter TO noc_dev_ro; -- ganti "starter" bila POSTGRES_DB berbeda
GRANT USAGE ON SCHEMA public TO noc_dev_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO noc_dev_ro;
-- Tabel baru dari migrasi berikutnya ikut terbaca.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO noc_dev_ro;

-- Token login, hash password, dan kredensial: membaca ini = bisa membajak sesi/akun produksi.
REVOKE SELECT ON public.session, public.account, public.verification, public.api_keys,
  public.billing_credentials, public.ssh_credentials FROM noc_dev_ro;
