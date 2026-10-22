package archive

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// CustomerBucket sama dengan grafik "Daily (5 minute average)" MikroTik.
	CustomerBucket       = 5 * time.Minute
	customerFlushEvery   = 30 * time.Second
	customerRetention    = 400 * 24 * time.Hour
	customerPurgeEvery   = 24 * time.Hour
	customerMaxPending   = 50_000 // bucket yang boleh menunggu saat database mati
	customerQueuePrefix  = "<pppoe-"
	customerQueueSuffix  = ">"
	customerInsertTimout = 15 * time.Second
)

// CustomerRate adalah laju satu simple queue pelanggan pada satu polling.
type CustomerRate struct {
	Username       string
	DownBps, UpBps uint64
}

// CustomerUsername mengambil username PPPoE dari nama queue dinamis
// "<pppoe-USERNAME>"; ok=false untuk queue lain (dibuat manual).
func CustomerUsername(queueName string) (string, bool) {
	if !strings.HasPrefix(queueName, customerQueuePrefix) || !strings.HasSuffix(queueName, customerQueueSuffix) {
		return "", false
	}
	u := queueName[len(customerQueuePrefix) : len(queueName)-len(customerQueueSuffix)]
	return u, u != ""
}

// CustomerRow adalah rangkuman satu pelanggan dalam satu bucket 5 menit.
type CustomerRow struct {
	Username       string
	Start          time.Time
	Samples        int
	DownSum, UpSum float64 // jumlah bit/detik semua sampel
	DownMax, UpMax uint64
	PollSeconds    float64
}

func (r CustomerRow) avgMbps(sum float64) float64 { return sum / float64(r.Samples) / 1e6 }

// bytes: tiap sampel mewakili satu interval polling, jadi byte = laju * detik / 8.
func (r CustomerRow) bytes(sum float64) int64 { return int64(sum * r.PollSeconds / 8) }

// CustomerStore menyimpan rangkuman. Baris untuk pelanggan dan bucket yang sama
// DIJUMLAHKAN (bukan diganti), jadi bucket yang ditulis sebagian sebelum
// backend restart tetap utuh.
type CustomerStore interface {
	InsertCustomer(ctx context.Context, rows []CustomerRow) error
	PurgeCustomer(ctx context.Context, before time.Time) (int64, error)
}

// CustomerTraffic merangkum laju queue per pelanggan menjadi bucket 5 menit di
// memori, lalu menuliskannya ke customer_traffic_samples tiap 30 detik untuk
// bucket yang sudah lewat. Add tidak pernah menyentuh database, jadi polling
// tidak tertahan oleh database yang lambat.
type CustomerTraffic struct {
	store       CustomerStore
	logger      *slog.Logger
	pollSeconds float64
	now         func() time.Time

	mu      sync.Mutex
	current map[string]*CustomerRow
	pending []CustomerRow
}

// NewCustomerTraffic membuat perangkum. pollInterval adalah jarak polling queue
// (bawaan 1 detik) dan menjadi bobot perkiraan byte.
func NewCustomerTraffic(store CustomerStore, pollInterval time.Duration, logger *slog.Logger) *CustomerTraffic {
	if pollInterval <= 0 {
		pollInterval = time.Second
	}
	return &CustomerTraffic{
		store:       store,
		logger:      logger,
		pollSeconds: pollInterval.Seconds(),
		now:         time.Now,
		current:     map[string]*CustomerRow{},
	}
}

// Add mencatat satu polling. Aman dipanggil dari banyak goroutine router.
func (c *CustomerTraffic) Add(at time.Time, rates []CustomerRate) {
	start := at.Truncate(CustomerBucket)
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range rates {
		row := c.current[r.Username]
		if row != nil && !row.Start.Equal(start) {
			c.pending = append(c.pending, *row)
			row = nil
		}
		if row == nil {
			row = &CustomerRow{Username: r.Username, Start: start, PollSeconds: c.pollSeconds}
			c.current[r.Username] = row
		}
		row.Samples++
		row.DownSum += float64(r.DownBps)
		row.UpSum += float64(r.UpBps)
		row.DownMax = max(row.DownMax, r.DownBps)
		row.UpMax = max(row.UpMax, r.UpBps)
	}
}

// take mengambil bucket yang sudah selesai (all=true: semuanya, saat berhenti).
func (c *CustomerTraffic) take(all bool) []CustomerRow {
	open := c.now().Truncate(CustomerBucket)
	c.mu.Lock()
	defer c.mu.Unlock()
	out := c.pending
	c.pending = nil
	for user, row := range c.current {
		// Pelanggan yang sesinya putus tidak lagi mengirim sampel; bucket lamanya
		// ditutup di sini, bukan menunggu sampel berikutnya.
		if all || row.Start.Before(open) {
			out = append(out, *row)
			delete(c.current, user)
		}
	}
	return out
}

// requeue mengembalikan batch yang gagal ditulis, dibatasi agar memori aman.
func (c *CustomerTraffic) requeue(rows []CustomerRow) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pending = append(rows, c.pending...)
	if over := len(c.pending) - customerMaxPending; over > 0 {
		c.pending = c.pending[over:]
		c.logger.Warn("trafik pelanggan: antrean penuh, bucket tertua dibuang", "dibuang", over)
	}
}

func (c *CustomerTraffic) flush(ctx context.Context, all bool) {
	rows := c.take(all)
	if len(rows) == 0 {
		return
	}
	ictx, cancel := context.WithTimeout(ctx, customerInsertTimout)
	defer cancel()
	if err := c.store.InsertCustomer(ictx, rows); err != nil {
		c.logger.Warn("trafik pelanggan gagal disimpan, dicoba lagi", "bucket", len(rows), "error", err)
		c.requeue(rows)
	}
}

// Run menulis bucket berkala sampai ctx selesai, lalu menulis sisanya.
func (c *CustomerTraffic) Run(ctx context.Context) {
	flush := time.NewTicker(customerFlushEvery)
	defer flush.Stop()
	purge := time.NewTicker(customerPurgeEvery)
	defer purge.Stop()
	for {
		select {
		case <-ctx.Done():
			// Bucket yang sedang berjalan ikut ditulis; penulisan berikutnya menambahkannya.
			sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
			c.flush(sctx, true)
			cancel()
			return
		case <-flush.C:
			c.flush(ctx, false)
		case <-purge.C:
			if n, err := c.store.PurgeCustomer(ctx, c.now().Add(-customerRetention)); err != nil {
				c.logger.Warn("pembersihan trafik pelanggan lama gagal", "error", err)
			} else if n > 0 {
				c.logger.Info("trafik pelanggan lama dihapus", "baris", n)
			}
		}
	}
}

// insertCustomerSQL: baris untuk username yang tidak ada di customers dilewati
// lewat JOIN. Rata-rata digabung berbobot jumlah sampel; ekspresi SET membaca
// nilai lama baris, jadi urutan kolom tidak berpengaruh.
const insertCustomerSQL = `
INSERT INTO customer_traffic_samples AS s (customer_id, bucket_start, samples,
  download_mbps_avg, upload_mbps_avg, download_mbps_max, upload_mbps_max, download_bytes, upload_bytes)
SELECT c.id, t.bucket_start, t.samples, t.down_avg, t.up_avg, t.down_max, t.up_max, t.down_bytes, t.up_bytes
FROM unnest($1::text[], $2::timestamptz[], $3::int[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::bigint[], $9::bigint[])
  AS t(username, bucket_start, samples, down_avg, up_avg, down_max, up_max, down_bytes, up_bytes)
JOIN customers c ON c.pppoe_username = t.username
ON CONFLICT (customer_id, bucket_start) DO UPDATE SET
  samples = s.samples + EXCLUDED.samples,
  download_mbps_avg = (s.download_mbps_avg * s.samples + EXCLUDED.download_mbps_avg * EXCLUDED.samples) / (s.samples + EXCLUDED.samples),
  upload_mbps_avg = (s.upload_mbps_avg * s.samples + EXCLUDED.upload_mbps_avg * EXCLUDED.samples) / (s.samples + EXCLUDED.samples),
  download_mbps_max = greatest(s.download_mbps_max, EXCLUDED.download_mbps_max),
  upload_mbps_max = greatest(s.upload_mbps_max, EXCLUDED.upload_mbps_max),
  download_bytes = s.download_bytes + EXCLUDED.download_bytes,
  upload_bytes = s.upload_bytes + EXCLUDED.upload_bytes`

// CustomerPGStore menyimpan trafik pelanggan di PostgreSQL.
type CustomerPGStore struct{ pool *pgxpool.Pool }

// NewCustomerPGStore membungkus pool koneksi milik pemanggil.
func NewCustomerPGStore(pool *pgxpool.Pool) *CustomerPGStore { return &CustomerPGStore{pool: pool} }

// InsertCustomer menyimpan semua baris dengan satu perintah SQL. Satu
// (username, bucket) hanya boleh muncul sekali per perintah, jadi baris kembar
// digabung dulu.
func (s *CustomerPGStore) InsertCustomer(ctx context.Context, rows []CustomerRow) error {
	rows = mergeCustomerRows(rows)
	n := len(rows)
	users, starts := make([]string, n), make([]time.Time, n)
	samples := make([]int32, n)
	downAvg, upAvg, downMax, upMax := make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)
	downBytes, upBytes := make([]int64, n), make([]int64, n)
	for i, r := range rows {
		users[i], starts[i], samples[i] = r.Username, r.Start, int32(r.Samples)
		downAvg[i], upAvg[i] = r.avgMbps(r.DownSum), r.avgMbps(r.UpSum)
		downMax[i], upMax[i] = float64(r.DownMax)/1e6, float64(r.UpMax)/1e6
		downBytes[i], upBytes[i] = r.bytes(r.DownSum), r.bytes(r.UpSum)
	}
	if _, err := s.pool.Exec(ctx, insertCustomerSQL, users, starts, samples, downAvg, upAvg, downMax, upMax, downBytes, upBytes); err != nil {
		return fmt.Errorf("simpan trafik pelanggan: %w", err)
	}
	return nil
}

// PurgeCustomer menghapus bucket yang lebih tua dari before.
func (s *CustomerPGStore) PurgeCustomer(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM customer_traffic_samples WHERE bucket_start < $1`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// mergeCustomerRows menggabung baris dengan username dan bucket yang sama
// (bisa terjadi bila batch gagal dikembalikan lalu bucket itu terisi lagi).
func mergeCustomerRows(rows []CustomerRow) []CustomerRow {
	type key struct {
		user  string
		start int64
	}
	idx := make(map[key]int, len(rows))
	out := rows[:0:0]
	for _, r := range rows {
		k := key{r.Username, r.Start.Unix()}
		if i, ok := idx[k]; ok {
			m := &out[i]
			m.Samples += r.Samples
			m.DownSum += r.DownSum
			m.UpSum += r.UpSum
			m.DownMax = max(m.DownMax, r.DownMax)
			m.UpMax = max(m.UpMax, r.UpMax)
			continue
		}
		idx[k] = len(out)
		out = append(out, r)
	}
	return out
}
