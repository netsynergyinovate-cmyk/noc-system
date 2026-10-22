package collector

import (
	"context"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// SyslogLine adalah satu baris log router yang disimpan ke syslog_events.
// Facility/Severity -1 berarti paket tidak memuat PRI.
type SyslogLine struct {
	RouterID   string
	ReceivedAt time.Time
	Facility   int
	Severity   int
	Topics     string
	Message    string
}

var (
	priPrefix = regexp.MustCompile(`^<(\d{1,3})>`)
	// Header BSD (RFC 3164) opsional: "Oct  7 16:55:12 hostname ".
	bsdHeader = regexp.MustCompile(`^[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \S+ `)
	// Header RFC 5424 opsional: "1 2026-10-07T16:55:12+07:00 hostname - - - ".
	rfc5424Header = regexp.MustCompile(`^1 \d{4}-\d{2}-\d{2}T\S+ \S+ (?:- )*`)
	// Topik RouterOS: daftar berkoma ("pppoe,ppp,info") atau satu tingkat log.
	rosTopics = regexp.MustCompile(`^(?:[a-z0-9-]+(?:,[a-z0-9-]+)+|info|error|warning|critical|debug)$`)
)

// ParseSyslogLine memisahkan PRI, header BSD, dan topik RouterOS dari pesan.
// Bagian yang tidak dikenali tetap ada di Message, tidak dibuang.
func ParseSyslogLine(raw string) (facility, severity int, topics, message string) {
	facility, severity = -1, -1
	msg := strings.TrimSpace(raw)
	if m := priPrefix.FindStringSubmatch(msg); m != nil {
		if pri, err := strconv.Atoi(m[1]); err == nil && pri <= 191 {
			facility, severity = pri/8, pri%8
		}
		msg = msg[len(m[0]):]
	}
	msg = rfc5424Header.ReplaceAllString(msg, "")
	msg = strings.TrimLeft(bsdHeader.ReplaceAllString(msg, ""), " ")
	if first, rest, ok := strings.Cut(msg, " "); ok && rosTopics.MatchString(strings.TrimSuffix(first, ":")) {
		topics, msg = strings.TrimSuffix(first, ":"), strings.TrimSpace(rest)
	}
	return facility, severity, topics, msg
}

const (
	syslogQueueSize  = 10_000
	syslogBatchSize  = 500
	syslogFlushEvery = time.Second
	syslogPurgeEvery = time.Hour
)

const syslogInsertSQL = `INSERT INTO syslog_events (router_id, received_at, facility, severity, topics, message)
SELECT r, t, NULLIF(f, -1), NULLIF(s, -1), tp, m
FROM unnest($1::uuid[], $2::timestamptz[], $3::smallint[], $4::smallint[], $5::text[], $6::text[]) AS u(r, t, f, s, tp, m)`

// SyslogWriter menyimpan baris syslog secara berkelompok dan menghapus baris
// yang lebih tua dari masa retensi. Add tidak pernah memblokir listener UDP.
type SyslogWriter struct {
	db        Execer
	logger    *slog.Logger
	retention time.Duration
	ch        chan SyslogLine
	dropped   atomic.Uint64
	now       func() time.Time
}

func NewSyslogWriter(db Execer, retention time.Duration, logger *slog.Logger) *SyslogWriter {
	return &SyslogWriter{
		db:        db,
		logger:    logger,
		retention: retention,
		ch:        make(chan SyslogLine, syslogQueueSize),
		now:       time.Now,
	}
}

// Add memasukkan baris ke antrean; bila penuh baris dibuang dan dihitung.
func (w *SyslogWriter) Add(line SyslogLine) {
	select {
	case w.ch <- line:
	default:
		if w.dropped.Add(1)%1000 == 1 {
			w.logger.Warn("antrean syslog penuh, baris log dibuang", "total_dibuang", w.dropped.Load())
		}
	}
}

// Run menulis antrean sampai ctx selesai.
func (w *SyslogWriter) Run(ctx context.Context) {
	flush := time.NewTicker(syslogFlushEvery)
	defer flush.Stop()
	purge := time.NewTicker(syslogPurgeEvery)
	defer purge.Stop()
	batch := make([]SyslogLine, 0, syslogBatchSize)
	w.purge(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case line := <-w.ch:
			batch = append(batch, line)
			if len(batch) >= syslogBatchSize {
				batch = w.write(ctx, batch)
			}
		case <-flush.C:
			if len(batch) > 0 {
				batch = w.write(ctx, batch)
			}
		case <-purge.C:
			w.purge(ctx)
		}
	}
}

func (w *SyslogWriter) write(ctx context.Context, batch []SyslogLine) []SyslogLine {
	n := len(batch)
	routers := make([]string, n)
	at := make([]time.Time, n)
	fac := make([]int16, n)
	sev := make([]int16, n)
	topics := make([]string, n)
	msgs := make([]string, n)
	for i, l := range batch {
		routers[i], at[i], fac[i], sev[i], topics[i], msgs[i] = l.RouterID, l.ReceivedAt, int16(l.Facility), int16(l.Severity), l.Topics, l.Message
	}
	if _, err := w.db.Exec(ctx, syslogInsertSQL, routers, at, fac, sev, topics, msgs); err != nil && ctx.Err() == nil {
		w.logger.Warn("baris syslog gagal disimpan", "jumlah", n, "error", err)
	}
	return batch[:0]
}

func (w *SyslogWriter) purge(ctx context.Context) {
	tag, err := w.db.Exec(ctx, `DELETE FROM syslog_events WHERE received_at < $1`, w.now().Add(-w.retention))
	if err != nil {
		if ctx.Err() == nil {
			w.logger.Warn("hapus syslog lama gagal", "error", err)
		}
		return
	}
	if tag.RowsAffected() > 0 {
		w.logger.Info("syslog lama dihapus", "baris", tag.RowsAffected())
	}
}
