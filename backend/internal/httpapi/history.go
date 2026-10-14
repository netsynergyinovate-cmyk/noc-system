package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"noc-isp/backend/internal/archive"
	"noc-isp/backend/internal/wire"
)

// HistorySource menjawab query traffic masa lalu dari arsip; *archive.PGStore
// memenuhinya. Implementasinya harus menghormati context (batas waktu dan
// pembatalan).
type HistorySource interface {
	History(ctx context.Context, q archive.HistoryQuery) ([]archive.HistoryPoint, error)
}

const (
	// historyTimeout membatasi satu query; query lambat dihentikan di database,
	// bukan dibiarkan menumpuk.
	historyTimeout = 10 * time.Second
	// maxConcurrentHistory membatasi query histori yang berjalan bersamaan.
	// Query rentang panjang memindai banyak baris; tanpa batas, beberapa tab
	// yang berpindah rentang bisa menghabiskan koneksi database.
	maxConcurrentHistory = 4
	// autoHistoryPoints adalah target jumlah titik bila `step` tidak diberikan.
	autoHistoryPoints = 400
	// maxFutureSkew adalah selisih jam yang dimaafkan untuk `to` di masa depan.
	maxFutureSkew = time.Minute
	// maxUnixSeconds menjaga waktu dari angka yang membuat time.Time meluap.
	maxUnixSeconds = 253402300799 // 9999-12-31T23:59:59Z
	maxStepSeconds = 86400
)

// historyRanges adalah pintasan `range`: jendela yang berakhir sekarang. Nama
// sama dengan pemilih rentang di dashboard.
var historyRanges = map[string]time.Duration{
	"1h":  time.Hour,
	"6h":  6 * time.Hour,
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
	"30d": 30 * 24 * time.Hour,
}

// historySteps adalah langkah "bulat" yang dipilih otomatis; dengan target 400
// titik hasilnya 1 jam -> 10 dtk, 6 jam -> 1 mnt, 24 jam -> 5 mnt, 7 hari -> 30 mnt.
var historySteps = []int64{1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400}

type historyAPI struct {
	source HistorySource
	logger *slog.Logger
	slots  chan struct{}
	now    func() time.Time
}

func newHistoryAPI(source HistorySource, logger *slog.Logger) *historyAPI {
	return &historyAPI{
		source: source,
		logger: logger,
		slots:  make(chan struct{}, maxConcurrentHistory),
		now:    time.Now,
	}
}

type historyData struct {
	// From adalah awal bucket pertama (dibulatkan ke bawah ke kelipatan Step),
	// To batas akhir jendela yang diminta (tidak ikut), keduanya detik unix.
	From int64 `json:"from"`
	To   int64 `json:"to"`
	Step int64 `json:"step"`
	wire.TrafficSeries
}

// history melayani GET /api/v1/traffic/history: total traffic semua router
// (atau satu router) pada jendela waktu lampau, dirata-rata per `step` detik.
//
// Jendela dipilih dengan `range` (1h, 6h, 24h, 7d, 30d; berakhir sekarang) atau
// dengan `from` dan `to` (detik unix, `to` tidak ikut). `step` (detik) boleh
// dikosongkan; server memilih langkah yang memberi sekitar 400 titik. Bucket
// tanpa data tidak muncul, jadi celah tampak sebagai selisih waktu antartitik.
func (a *historyAPI) history(w http.ResponseWriter, r *http.Request) {
	params, err := parseQuery(r, "range", "from", "to", "step", "router")
	if err != nil {
		badRequest(w, err)
		return
	}
	from, to, err := a.window(params)
	if err != nil {
		badRequest(w, err)
		return
	}
	step, err := historyStep(params, to-from)
	if err != nil {
		badRequest(w, err)
		return
	}
	query := archive.HistoryQuery{
		From:     time.Unix(from, 0).UTC(),
		To:       time.Unix(to, 0).UTC(),
		Step:     time.Duration(step) * time.Second,
		RouterID: params.Get("router"),
	}
	if err := query.Validate(); err != nil {
		badRequest(w, err)
		return
	}
	if a.source == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{
			Error:   "history_unavailable",
			Message: "arsip traffic belum dikonfigurasi (isi DATABASE_URL pada backend)",
		})
		return
	}

	select {
	case a.slots <- struct{}{}:
		defer func() { <-a.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{
			Error:   "busy",
			Message: "terlalu banyak query histori yang sedang berjalan; coba lagi sebentar",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), historyTimeout)
	defer cancel()
	points, err := a.source.History(ctx, query)
	if err != nil {
		if r.Context().Err() != nil {
			return // klien sudah pergi; tidak ada yang menerima jawaban
		}
		// Detail error dicatat, bukan dikirim: bisa memuat alamat database.
		a.logger.Error("query histori traffic gagal", "error", err.Error(), "from", from, "to", to, "step", step)
		message := "arsip traffic sedang tidak bisa dibaca"
		if errors.Is(err, context.DeadlineExceeded) {
			message = "query histori terlalu lama; coba rentang yang lebih pendek"
		}
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: "history_unavailable", Message: message})
		return
	}

	series := wire.TrafficSeries{
		Times: make([]int64, 0, len(points)),
		Rx:    make([]float64, 0, len(points)),
		Tx:    make([]float64, 0, len(points)),
	}
	for _, p := range points {
		series.Times = append(series.Times, p.At.Unix())
		series.Rx = append(series.Rx, p.RxMbps)
		series.Tx = append(series.Tx, p.TxMbps)
	}
	writeJSON(w, http.StatusOK, dataResponse[historyData]{Data: historyData{
		From:          from - from%step,
		To:            to,
		Step:          step,
		TrafficSeries: series,
	}})
}

// window membaca jendela dari `range` atau dari `from` dan `to`.
func (a *historyAPI) window(params url.Values) (from, to int64, err error) {
	now := a.now()
	rangeName := params.Get("range")
	if rangeName != "" {
		if params.Has("from") || params.Has("to") {
			return 0, 0, fmt.Errorf("range tidak bisa dipakai bersama from atau to")
		}
		span, ok := historyRanges[rangeName]
		if !ok {
			return 0, 0, fmt.Errorf("range harus salah satu dari 1h, 6h, 24h, 7d, 30d")
		}
		to = now.Unix()
		return to - int64(span/time.Second), to, nil
	}
	if !params.Has("from") || !params.Has("to") {
		return 0, 0, fmt.Errorf("isi range, atau from dan to (detik unix)")
	}
	if from, err = unixParam(params, "from"); err != nil {
		return 0, 0, err
	}
	if to, err = unixParam(params, "to"); err != nil {
		return 0, 0, err
	}
	if to > now.Add(maxFutureSkew).Unix() {
		return 0, 0, fmt.Errorf("to tidak boleh di masa depan")
	}
	return from, to, nil
}

func unixParam(params url.Values, key string) (int64, error) {
	n, err := strconv.ParseInt(params.Get(key), 10, 64)
	if err != nil || n < 0 || n > maxUnixSeconds {
		return 0, fmt.Errorf("%s harus detik unix berupa bilangan bulat tidak negatif", key)
	}
	return n, nil
}

// historyStep memakai `step` bila ada; bila tidak, langkah bulat terkecil yang
// membuat jumlah titik tidak melebihi autoHistoryPoints.
func historyStep(params url.Values, span int64) (int64, error) {
	if params.Has("step") {
		n, err := intParam(params, "step", 0, 1, maxStepSeconds)
		return int64(n), err
	}
	for _, step := range historySteps {
		if (span+step-1)/step <= autoHistoryPoints {
			return step, nil
		}
	}
	return maxStepSeconds, nil
}
