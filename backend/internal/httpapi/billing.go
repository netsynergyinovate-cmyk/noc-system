package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"noc-isp/backend/internal/billing"
	"noc-isp/backend/internal/state"
	"noc-isp/backend/internal/wire"
)

// Endpoint status billing (kontraknya: "Status billing" di backend/README.md dan
// BillingOverview di src/lib/dashboard/billing.ts):
//
//	GET /api/v1/billing        ringkasan: baris per pelanggan, tagihan tak
//	                           bertuan, dan keadaan sinkron
//	GET /api/v1/billing/sync   hanya keadaan sinkron
//
// Keduanya hanya MEMBACA dan dipasang di belakang requireTicket seperti rute
// /api/v1/ lain: tiket hanya-lihat cukup, tanpa tiket 401. Satu-satunya yang
// mengubah data adalah POST /api/v1/billing/sync (sinkron manual): ia butuh izin
// "billing:manage" di tiket (tanpa izin 403, 409 bila sinkron sedang berjalan).
// Metode selain itu dijawab 405.
//
// KAPAN DIMATIKAN. Jawabannya 503 {"error":"billing_disabled"} bila sinkron
// billing tidak berjalan di proses ini: sumber data tidak diberikan (billing
// tidak dikonfigurasi, atau tidak ada database) atau fungsi nextRun tidak
// diberikan. Penjadwal yang tidak jalan berarti nextRunAt tidak punya arti, dan
// jawaban dengan nextRunAt karangan lebih buruk daripada tidak menjawab:
// halaman Billing akan menunggu sinkron yang tidak pernah datang. 503 (bukan 404)
// membedakan "fitur ini mati" dari "alamat salah", dan backend tetap hidup. Data
// lama di database sengaja tidak dilayani dalam keadaan ini.

const (
	// billingTimeout membatasi satu pembacaan database. Pembacaannya sederhana
	// (tiga query dalam satu transaksi); yang lebih lama berarti database sedang
	// bermasalah, dan jawaban 500 lebih baik daripada permintaan yang menggantung.
	billingTimeout = 5 * time.Second

	errBillingDisabled = "billing_disabled"
	errInternal        = "internal"
)

// BillingSource menjawab endpoint status billing; *billing.Reader memenuhinya.
// nextRunAt adalah saat sinkron terjadwal berikutnya (detik epoch dipotong dari
// waktunya); httpapi menjaminnya setelah saat jawaban dibuat. Implementasinya
// harus menghormati context (batas waktu dan pembatalan).
type BillingSource interface {
	Overview(ctx context.Context, nextRunAt time.Time) (wire.BillingOverview, error)
	SyncState(ctx context.Context, nextRunAt time.Time) (wire.BillingSyncState, error)
	// Runs memberi sinkron selesai berhalaman (terbaru dulu) dan jumlah seluruhnya.
	Runs(ctx context.Context, limit, offset int) ([]wire.BillingSyncRun, int, error)
}

const (
	historyDefaultLimit = 24
	historyMaxLimit     = 100
)

type historyResponse struct {
	Data   []wire.BillingSyncRun `json:"data"`
	Total  int                   `json:"total"`
	Limit  int                   `json:"limit"`
	Offset int                   `json:"offset"`
}

// history melayani GET /api/v1/billing/history?limit=&offset=.
func (a *billingAPI) history(w http.ResponseWriter, r *http.Request) {
	if !a.enabled() {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: errBillingDisabled})
		return
	}
	params, err := parseQuery(r, "limit", "offset")
	if err != nil {
		badRequest(w, err)
		return
	}
	limit, err := intParam(params, "limit", historyDefaultLimit, 1, historyMaxLimit)
	if err != nil {
		badRequest(w, err)
		return
	}
	offset, err := intParam(params, "offset", 0, 0, maxOffset)
	if err != nil {
		badRequest(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), billingTimeout)
	defer cancel()
	runs, total, err := a.source.Runs(ctx, limit, offset)
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		a.logger.Error("baca riwayat sinkron billing gagal", "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: errInternal})
		return
	}
	if runs == nil {
		runs = []wire.BillingSyncRun{}
	}
	writeJSON(w, http.StatusOK, historyResponse{Data: runs, Total: total, Limit: limit, Offset: offset})
}

// BillingTrigger menjalankan satu sinkron billing sekarang (sinkron manual);
// *billing.Scheduler memenuhinya. Bila sudah ada sinkron berjalan, galatnya
// membungkus billing.ErrRunInProgress.
type BillingTrigger interface {
	TriggerManual(ctx context.Context) (billing.RunOutcome, error)
}

// billingManagePerm adalah izin tiket untuk sinkron manual. Tiket browser tidak
// pernah memuatnya; hanya route Next.js yang sudah memeriksa peran admin yang
// menerbitkan tiket dengan izin ini (src/lib/billing-proxy.ts).
const billingManagePerm = "billing:manage"

type billingAPI struct {
	source  BillingSource
	nextRun func(now time.Time) time.Time
	trigger BillingTrigger
	logger  *slog.Logger
	now     func() time.Time
}

func newBillingAPI(source BillingSource, nextRun func(time.Time) time.Time, logger *slog.Logger) *billingAPI {
	return &billingAPI{source: source, nextRun: nextRun, logger: logger, now: time.Now}
}

// register memasang kedua rute pada mux. Pola tanpa garis miring penutup hanya
// cocok persis: /api/v1/billing/ atau /api/v1/billing/lain jatuh ke 404.
func (a *billingAPI) register(mux *http.ServeMux) {
	mux.Handle("/api/v1/billing", readOnly(a.overview))
	mux.Handle("/api/v1/billing/sync", http.HandlerFunc(a.handleBillingSync))
	mux.Handle("/api/v1/billing/history", readOnly(a.history))
}

// handleBillingSync: GET/HEAD membaca keadaan sinkron, POST memicu sinkron manual.
func (a *billingAPI) handleBillingSync(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		a.syncState(w, r)
	case http.MethodPost:
		a.manualSync(w, r)
	default:
		w.Header().Set("Allow", "GET, HEAD, POST")
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method_not_allowed"})
	}
}

// manualSync melayani POST /api/v1/billing/sync. Tiket yang sah sudah dipastikan
// oleh requireTicket (tanpa tiket: 401); di sini izin diperiksa SEBELUM apa pun
// dijalankan: tiket hanya-lihat 403.
func (a *billingAPI) manualSync(w http.ResponseWriter, r *http.Request) {
	identity, ok := identityFrom(r.Context())
	if !ok {
		unauthorized(w)
		return
	}
	if !identity.Can(billingManagePerm) {
		forbidden(w)
		return
	}
	if a.trigger == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: errBillingDisabled})
		return
	}
	_, err := a.trigger.TriggerManual(r.Context())
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "sinkronisasi manual berhasil dijalankan"})
	case errors.Is(err, billing.ErrRunInProgress):
		writeJSON(w, http.StatusConflict, errorResponse{Error: "sinkronisasi sedang berjalan"})
	default:
		if r.Context().Err() != nil {
			return // petugas sudah pergi; tidak ada yang menerima jawaban
		}
		// Rincian hanya di log; kalimat Classify tidak memuat alamat atau kredensial.
		a.logger.Error("sinkron billing manual gagal", "error", err.Error())
		writeJSON(w, http.StatusBadGateway, errorResponse{Error: "sync_failed", Message: billing.Classify(err).Message})
	}
}

func (a *billingAPI) enabled() bool { return a.source != nil && a.nextRun != nil }

// overview melayani GET /api/v1/billing.
func (a *billingAPI) overview(w http.ResponseWriter, r *http.Request) {
	a.serve(w, r, "overview", func(ctx context.Context, next time.Time) (any, error) {
		data, err := a.source.Overview(ctx, next)
		if err != nil {
			return nil, err
		}
		return normalizeOverview(data), nil
	})
}

// syncState melayani GET /api/v1/billing/sync.
func (a *billingAPI) syncState(w http.ResponseWriter, r *http.Request) {
	a.serve(w, r, "sinkron", func(ctx context.Context, next time.Time) (any, error) {
		data, err := a.source.SyncState(ctx, next)
		if err != nil {
			return nil, err
		}
		return normalizeSync(data), nil
	})
}

// normalizeOverview dan normalizeSync menjaga di batas HTTP bahwa daftar tidak
// pernah menjadi null di JSON (kontrak TypeScript: BillingRow[], bukan
// BillingRow[] | null), siapa pun sumbernya.
func normalizeOverview(o wire.BillingOverview) wire.BillingOverview {
	o.Sync = normalizeSync(o.Sync)
	if o.Rows == nil {
		o.Rows = []wire.BillingRow{}
	}
	if o.Unmatched == nil {
		o.Unmatched = []wire.BillingUnmatched{}
	}
	return o
}

func normalizeSync(s wire.BillingSyncState) wire.BillingSyncState {
	if s.Runs == nil {
		s.Runs = []wire.BillingSyncRun{}
	}
	return s
}

// serve adalah jalur bersama kedua endpoint.
func (a *billingAPI) serve(w http.ResponseWriter, r *http.Request, what string, read func(context.Context, time.Time) (any, error)) {
	if !a.enabled() {
		writeJSON(w, http.StatusServiceUnavailable, errorResponse{Error: errBillingDisabled})
		return
	}
	if _, err := parseQuery(r); err != nil {
		badRequest(w, err)
		return
	}

	now := a.now()
	next := a.nextRun(now)
	if !next.After(now) {
		// Kontrak: nextRunAt selalu setelah saat jawaban dibuat. Fungsi yang
		// disuntikkan melanggarnya adalah galat pemrograman; menjawab dengan
		// waktu yang sudah lewat akan membuat halaman Billing menanyakan ulang
		// tanpa henti.
		a.logger.Error("jadwal sinkron billing tidak masuk akal: sinkron berikutnya tidak setelah sekarang",
			"endpoint", what, "sekarang", now.Unix(), "berikutnya", next.Unix())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: errInternal})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), billingTimeout)
	defer cancel()
	data, err := read(ctx, next)
	if err != nil {
		if r.Context().Err() != nil {
			return // klien sudah pergi; tidak ada yang menerima jawaban
		}
		// Teks galat database bisa memuat nama tabel, alamat server, atau potongan
		// data; hanya dicatat di log, tidak pernah dikirim.
		a.logger.Error("baca status billing gagal", "endpoint", what, "error", err.Error())
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: errInternal})
		return
	}
	writeJSON(w, http.StatusOK, dataResponse[any]{Data: data})
}

// billingServiceMismatches melayani GET /api/v1/billing/service-mismatches:
// pelanggan yang status tagihannya tidak cocok dengan status koneksinya.
// Dibaca dari state di memori, jadi tetap berjawab walau sinkron billing mati.
func (a *dashboardAPI) billingServiceMismatches(w http.ResponseWriter, r *http.Request) {
	if _, err := parseQuery(r); err != nil {
		badRequest(w, err)
		return
	}
	mismatches := a.data.BillingServiceMismatches()
	writeJSON(w, http.StatusOK, struct {
		Data  []state.BillingServiceMismatch `json:"data"`
		Count int                            `json:"count"`
	}{Data: mismatches, Count: len(mismatches)})
}
