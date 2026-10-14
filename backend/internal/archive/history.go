package archive

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// MaxHistoryRange adalah jendela terpanjang yang boleh ditanyakan sekali
	// jalan; sedikit lebih panjang dari masa simpan bawaan (30 hari).
	MaxHistoryRange = 31 * 24 * time.Hour
	// MaxHistoryPoints membatasi jumlah titik dalam satu jawaban, supaya jendela
	// panjang dengan langkah sangat kecil tidak menghasilkan jawaban raksasa.
	MaxHistoryPoints = 2500
)

// HistoryQuery meminta total traffic semua router (atau satu router) pada
// jendela [From, To), dirata-rata per Step. Step harus kelipatan detik penuh.
type HistoryQuery struct {
	From, To time.Time
	Step     time.Duration
	// RouterID membatasi ke satu router (UUID); kosong berarti semua router.
	RouterID string
}

// HistoryPoint adalah satu titik hasil: At adalah awal bucket (kelipatan Step
// sejak epoch), nilainya rata-rata traffic total per detik di bucket itu.
type HistoryPoint struct {
	At             time.Time
	RxMbps, TxMbps float64
}

// ErrInvalidHistoryQuery dikembalikan (dibungkus) untuk query yang tidak boleh
// dijalankan; pemanggil bisa memeriksanya dengan errors.Is.
var ErrInvalidHistoryQuery = errors.New("query histori tidak valid")

// Validate memeriksa query sebelum menyentuh database. Batas yang sama juga
// dijaga lapisan HTTP, tetapi penjagaan di sini membuat store aman dipakai
// dari mana pun.
func (q HistoryQuery) Validate() error {
	switch {
	case !q.From.Before(q.To):
		return fmt.Errorf("%w: From harus sebelum To", ErrInvalidHistoryQuery)
	case q.To.Sub(q.From) > MaxHistoryRange:
		return fmt.Errorf("%w: jendela lebih dari %s", ErrInvalidHistoryQuery, MaxHistoryRange)
	case q.Step < time.Second || q.Step%time.Second != 0:
		return fmt.Errorf("%w: Step harus kelipatan satu detik", ErrInvalidHistoryQuery)
	case q.RouterID != "" && !validRouterID(q.RouterID):
		return fmt.Errorf("%w: RouterID bukan UUID", ErrInvalidHistoryQuery)
	}
	// Jumlah bucket pada jendela yang dibulatkan ke bawah ke kelipatan Step.
	step := int64(q.Step / time.Second)
	first := q.From.Unix() - floorMod(q.From.Unix(), step)
	end := q.To.Unix()
	if q.To.Nanosecond() > 0 {
		end++
	}
	if buckets := (end - first + step - 1) / step; buckets > MaxHistoryPoints {
		return fmt.Errorf("%w: %d titik melebihi batas %d; perbesar Step", ErrInvalidHistoryQuery, buckets, MaxHistoryPoints)
	}
	return nil
}

func floorMod(a, b int64) int64 {
	m := a % b
	if m < 0 {
		m += b
	}
	return m
}

// historySQL menjumlahkan semua router pada tiap detik lebih dulu, baru
// merata-ratakan per bucket. Merata-ratakan langsung seluruh baris akan
// menghasilkan rata-rata per router, bukan total jaringan. Bucket tanpa sampel
// tidak muncul (tidak diisi nol), supaya celah data tidak terbaca sebagai
// traffic nol.
const historySQL = `
SELECT bucket, avg(rx), avg(tx)
FROM (
  SELECT (floor(extract(epoch FROM sampled_at))::bigint / $3::bigint) * $3::bigint AS bucket,
         rx, tx
  FROM (
    SELECT sampled_at, sum(rx_mbps) AS rx, sum(tx_mbps) AS tx
    FROM traffic_samples
    WHERE sampled_at >= $1 AND sampled_at < $2
      AND ($4::uuid IS NULL OR router_id = $4::uuid)
    GROUP BY sampled_at
  ) per_second
) bucketed
GROUP BY bucket
ORDER BY bucket`

// History menjalankan query histori. Jendela dibulatkan ke bawah ke kelipatan
// Step supaya bucket pertama tidak setengah terisi. Hasilnya tidak pernah nil.
func (s *PGStore) History(ctx context.Context, q HistoryQuery) ([]HistoryPoint, error) {
	if err := q.Validate(); err != nil {
		return nil, err
	}
	step := int64(q.Step / time.Second)
	from := q.From.Unix() - floorMod(q.From.Unix(), step)

	var router pgtype.UUID // nol (tidak valid) menjadi NULL
	if q.RouterID != "" {
		if err := router.Scan(q.RouterID); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidHistoryQuery, err)
		}
	}
	rows, err := s.pool.Query(ctx, historySQL, time.Unix(from, 0).UTC(), q.To.UTC(), step, router)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]HistoryPoint, 0, 64)
	for rows.Next() {
		var bucket int64
		var point HistoryPoint
		if err := rows.Scan(&bucket, &point.RxMbps, &point.TxMbps); err != nil {
			return nil, err
		}
		point.At = time.Unix(bucket, 0).UTC()
		points = append(points, point)
	}
	return points, rows.Err()
}
