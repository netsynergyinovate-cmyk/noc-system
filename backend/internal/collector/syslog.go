package collector

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"noc-isp/backend/internal/state"
)

const (
	// maxSyslogPacket: pesan syslog lebih besar dari ini dibuang. RouterOS
	// mengirim baris pendek; batas ini melindungi dari paket sampah.
	maxSyslogPacket = 4096
	routerCacheTTL  = 5 * time.Second
)

// pppLogLine mencocokkan baris log PPP dari RouterOS (topik ppp,info,account):
//
//	<134>Oct  7 16:55:12 MikroTik ppp,info,account budi logged in, 10.0.0.2 from AA:BB
//	<134>Oct  7 16:58:01 MikroTik ppp,info,account budi logged out, 169 1200 3400
//
// Topik "ppp" wajib ada, karena login lain ("user admin logged in from ... via
// winbox", topik system) memakai kata yang sama dan tidak boleh dianggap sesi
// pelanggan.
var (
	pppTopic   = regexp.MustCompile(`(?:^|[\s:])(?:[\w-]+,)*ppp(?:,[\w-]+)*(?:[\s:]|$)`)
	loggedLine = regexp.MustCompile(`(\S+) logged (in|out)\b`)
)
var (
	// oltLosPattern mendeteksi alarm kabel putus (LOS / Loss of Signal / Link Down).
	// \b mencegah kecocokan parsial seperti "closed" atau "allocated".
	oltLosPattern = regexp.MustCompile(`(?i)\b(?:LOS|Loss of Signal|Link Down)\b`)

	// oltDyingGaspPattern mendeteksi alarm mati listrik pelanggan (Dying Gasp / Power Down / Power Off).
	oltDyingGaspPattern = regexp.MustCompile(`(?i)\b(?:Dying Gasp|Power Down|Power Off)\b`)

	// Pola pencarian PON dan ONU
	ponOnuColonPattern = regexp.MustCompile(`(?i)\b(?:pon|port|onu|epon|gpon)?\s*(\d+/\d+):(\d+)\b`)
	ponOnuWordPattern  = regexp.MustCompile(`(?i)\b(?:pon|port)\s*(\d+/\d+|\d+)\b.*?\b(?:onu|ont)\s*(\d+)\b`)
	ponOnlyPattern     = regexp.MustCompile(`(?i)\b(?:pon|port)\s*(\d+/\d+|\d+)\b`)

	// Pola status ONU pemulihan vs offline
	statusRecoverPattern = regexp.MustCompile(`(?i)\b(?:onu|ont)?\s*.*?\b(online|registered?)\b`)
	statusOfflinePattern = regexp.MustCompile(`(?i)\b(?:onu|ont)?\s*.*?\b(offline|deregistered?)\b`)
	// Pola alarm selesai / pulih (cleared, recovered, restored, normal, Link Up)
	alarmClearedPattern = regexp.MustCompile(`(?i)\b(?:clear(?:ed)?|restor(?:e|ed)?|recover(?:ed|y)?|disappear(?:ed)?|normal|resume[d]?|Link Up)\b`)
)

// OLTAlarmEvent mewakili alarm perangkat keras atau perubahan status ONU dari OLT.
type OLTAlarmEvent struct {
	OLTID    string
	OLTIP    string
	Type     string // "fiber_cut", "power_outage", "onu_offline", "recovery"
	Severity string // "critical", "warning", "info"
	Status   string // "active", "resolved"
	PonPort  string
	OnuID    string
	RawMsg   string
}

func extractPonOnu(msg string) (string, string) {
	if m := ponOnuColonPattern.FindStringSubmatch(msg); len(m) > 2 {
		return m[1], m[2]
	}
	if m := ponOnuWordPattern.FindStringSubmatch(msg); len(m) > 2 {
		return m[1], m[2]
	}
	if m := ponOnlyPattern.FindStringSubmatch(msg); len(m) > 1 {
		return m[1], ""
	}
	return "", ""
}

// ParseOLTLog memeriksa apakah pesan log adalah alarm atau status ONU dari OLT.
func ParseOLTLog(msg string, remoteIP string) (*OLTAlarmEvent, bool) {
	pon, onu := extractPonOnu(msg)
	if pon == "" {
		return nil, false
	}

	// 1. Cek alarm yang telah selesai atau pulih (cleared, recovered, online, registered)
	if alarmClearedPattern.MatchString(msg) || statusRecoverPattern.MatchString(msg) {
		alarmType := "recovery"
		if oltLosPattern.MatchString(msg) {
			alarmType = "fiber_cut"
		} else if oltDyingGaspPattern.MatchString(msg) {
			alarmType = "power_outage"
		}
		return &OLTAlarmEvent{
			OLTIP:    remoteIP,
			Type:     alarmType,
			Severity: "info",
			Status:   "resolved",
			PonPort:  pon,
			OnuID:    onu,
			RawMsg:   msg,
		}, true
	}

	if oltLosPattern.MatchString(msg) {
		return &OLTAlarmEvent{
			OLTIP:    remoteIP,
			Type:     "fiber_cut",
			Severity: "critical",
			Status:   "active",
			PonPort:  pon,
			OnuID:    onu,
			RawMsg:   msg,
		}, true
	}

	if oltDyingGaspPattern.MatchString(msg) {
		return &OLTAlarmEvent{
			OLTIP:    remoteIP,
			Type:     "power_outage",
			Severity: "warning",
			Status:   "active",
			PonPort:  pon,
			OnuID:    onu,
			RawMsg:   msg,
		}, true
	}

	if statusOfflinePattern.MatchString(msg) {
		return &OLTAlarmEvent{
			OLTIP:    remoteIP,
			Type:     "onu_offline",
			Severity: "warning",
			Status:   "active",
			PonPort:  pon,
			OnuID:    onu,
			RawMsg:   msg,
		}, true
	}

	return nil, false
}


// ParseSyslog mengambil kejadian sesi PPP dari satu pesan syslog. Mengembalikan
// false untuk pesan lain; hampir semua baris log router memang bukan kejadian
// PPP.
func ParseSyslog(message string) (PPPEvent, bool) {
	topic := pppTopic.FindStringIndex(message)
	if topic == nil {
		return PPPEvent{}, false
	}
	// Username dicari setelah topik, supaya teks topik sendiri tidak terbaca
	// sebagai username.
	match := loggedLine.FindStringSubmatch(message[topic[1]:])
	if match == nil {
		return PPPEvent{}, false
	}
	user := strings.TrimSuffix(strings.TrimPrefix(match[1], "<pppoe-"), ">")
	if !validUser(user) {
		return PPPEvent{}, false
	}
	return PPPEvent{User: user, Online: match[2] == "in"}, true
}

// SyslogStats menghitung apa yang terjadi pada paket yang diterima.
type SyslogStats struct {
	Received      uint64 // semua paket
	UnknownSource uint64 // bukan dari alamat router yang terdaftar
	NotPPPEvent   uint64 // bukan kejadian sesi PPP
	Rejected      uint64 // pelanggan tidak dikenal atau milik router lain
	Applied       uint64 // diterapkan ke state (termasuk yang tidak mengubah status)
	OLTNonAlarm   uint64 // pesan dari OLT tetapi bukan alarm
}

// SyslogListener menerima syslog UDP dari router dan mengubahnya menjadi status
// online pelanggan. Hanya paket dari alamat router terdaftar yang diproses, dan
// router hanya boleh mengubah pelanggannya sendiri.
//
// UDP tidak punya autentikasi dan alamat sumber bisa dipalsukan, jadi jalur ini
// hanya layak dipakai di jaringan manajemen tepercaya. Webhook ber-token adalah
// jalur utama; syslog dipakai sebagai cadangan.
type SyslogListener struct {
	conn     net.PacketConn
	presence Presence
	notify   func(state.Change)
	logger   *slog.Logger

	cacheMu     sync.Mutex
	cached      map[netip.Addr]string // alamat router -> id router
	cachedUntil time.Time
	warnedAt    map[netip.Addr]time.Time

	// sources: alamat pengirim tambahan -> id router (SYSLOG_SOURCE_MAP), untuk
	// router yang mengirim log lewat alamat lain (mis. WireGuard) dari Host-nya.
	sources map[netip.Addr]string
	// oltSources: alamat IP OLT -> id OLT untuk alarm hardware OLT.
	oltSources map[netip.Addr]string
	// store menerima setiap baris dari router dikenal (bukan hanya PPP).
	store func(SyslogLine)
	// oltAlarms antrean non-blocking untuk memproses alarm OLT di luar pembacaan soket UDP.
	oltAlarms chan OLTAlarmEvent
	oltHandler func(OLTAlarmEvent)

	received, unknownSource, notPPP, rejected, applied, oltNonAlarm atomic.Uint64
}

// ListenSyslog membuka soket UDP lebih dulu supaya alamat yang salah atau sudah
// terpakai langsung ketahuan saat server start. Port di bawah 1024 (514) butuh
// hak khusus di Linux; di pengembangan pakai port tinggi, mis. 5514.
func ListenSyslog(addr string, presence Presence, notify func(state.Change), logger *slog.Logger) (*SyslogListener, error) {
	if presence == nil || logger == nil {
		return nil, errors.New("collector: Presence dan Logger wajib diisi")
	}
	conn, err := net.ListenPacket("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("buka syslog UDP %s: %w", addr, err)
	}
	return &SyslogListener{
		conn: conn, presence: presence, notify: notify, logger: logger,
		oltAlarms: make(chan OLTAlarmEvent, 256),
	}, nil
}

// SetSources menambah pemetaan alamat pengirim -> id router. Panggil sebelum Serve.
func (l *SyslogListener) SetSources(m map[netip.Addr]string) { l.sources = m }

// SetStore memasang penyimpan baris log. Panggil sebelum Serve.
func (l *SyslogListener) SetStore(fn func(SyslogLine)) { l.store = fn }

// SetOLTSources menyetel pemetaan IP pengirim OLT ke ID OLT. Panggil sebelum Serve.
func (l *SyslogListener) SetOLTSources(m map[netip.Addr]string) {
	l.cacheMu.Lock()
	defer l.cacheMu.Unlock()
	l.oltSources = m
}

// SetOLTAlarm memasang callback untuk menangani alarm OLT di goroutine worker.
func (l *SyslogListener) SetOLTAlarm(fn func(OLTAlarmEvent)) {
	l.oltHandler = fn
}

// Addr adalah alamat yang sedang didengarkan.
func (l *SyslogListener) Addr() net.Addr { return l.conn.LocalAddr() }

// Stats memberi salinan hitungan paket.
func (l *SyslogListener) Stats() SyslogStats {
	return SyslogStats{
		Received:      l.received.Load(),
		UnknownSource: l.unknownSource.Load(),
		NotPPPEvent:   l.notPPP.Load(),
		Rejected:      l.rejected.Load(),
		Applied:       l.applied.Load(),
		OLTNonAlarm:   l.oltNonAlarm.Load(),
	}
}

// Serve membaca paket sampai ctx dibatalkan, lalu menutup soket. Mengembalikan
// nil bila berhenti karena ctx.
func (l *SyslogListener) Serve(ctx context.Context) error {
	stopped := make(chan struct{})
	defer close(stopped)
	go func() {
		select {
		case <-ctx.Done():
			_ = l.conn.Close()
		case <-stopped:
		}
	}()

	if l.oltHandler != nil {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case alarm, ok := <-l.oltAlarms:
					if !ok {
						return
					}
					l.oltHandler(alarm)
				}
			}
		}()
	}

	buf := make([]byte, maxSyslogPacket+1)
	for {
		n, from, err := l.conn.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return nil
			}
			return fmt.Errorf("baca syslog: %w", err)
		}
		if n > maxSyslogPacket {
			continue // terlalu besar untuk baris log router
		}
		l.handle(from, string(buf[:n]))
	}
}

func (l *SyslogListener) handle(from net.Addr, message string) {
	l.received.Add(1)

	isOLT := false
	if oltID, source, ok := l.oltFor(from); ok {
		isOLT = true
		if alarm, ok := ParseOLTLog(message, source.String()); ok {
			alarm.OLTID = oltID
			select {
			case l.oltAlarms <- *alarm:
				l.applied.Add(1)
			default:
				l.logger.Warn("antrean alarm OLT penuh, paket dilepas", "olt", source.String())
			}
			return
		}
	}

	routerID, ok := l.routerFor(from)
	if !ok {
		if isOLT {
			// Pesan OLT non-alarm dari OLT yang bukan router (atau bukan log PPP)
			// tidak dikirim ke store router agar tidak melanggar foreign key batch unnest.
			l.oltNonAlarm.Add(1)
			return
		}
		l.unknownSource.Add(1)
		l.warnUnknown(from)
		return
	}
	if l.store != nil {
		facility, severity, topics, text := ParseSyslogLine(message)
		l.store(SyslogLine{RouterID: routerID, ReceivedAt: time.Now(), Facility: facility, Severity: severity, Topics: topics, Message: text})
	}
	event, ok := ParseSyslog(message)
	if !ok {
		l.notPPP.Add(1)
		return
	}
	change, result := applyPPPEvent(l.presence, l.notify, event, routerID)
	if result != resultApplied {
		l.rejected.Add(1)
		l.logger.Debug("syslog PPP ditolak", "router", routerID, "alasan", rejectReason(result))
		return
	}
	l.applied.Add(1)
	if change.Changed() {
		l.logger.Info("status pelanggan berubah lewat syslog", "user", event.User, "online", event.Online, "router", routerID)
	}
}

func rejectReason(r applyResult) string {
	if r == resultRouterMismatch {
		return "pelanggan milik router lain"
	}
	return "pelanggan tidak dikenal"
}

func (l *SyslogListener) oltFor(from net.Addr) (string, netip.Addr, bool) {
	udp, ok := from.(*net.UDPAddr)
	if !ok {
		return "", netip.Addr{}, false
	}
	source := udp.AddrPort().Addr().Unmap()
	l.cacheMu.Lock()
	defer l.cacheMu.Unlock()
	if l.oltSources == nil {
		return "", source, false
	}
	id, ok := l.oltSources[source]
	return id, source, ok
}


// routerFor mencari router dari alamat IP pengirim.
func (l *SyslogListener) routerFor(from net.Addr) (string, bool) {
	udp, ok := from.(*net.UDPAddr)
	if !ok {
		return "", false
	}
	source := udp.AddrPort().Addr().Unmap()
	if id, ok := l.sources[source]; ok {
		return id, true
	}

	l.cacheMu.Lock()
	defer l.cacheMu.Unlock()
	if now := time.Now(); now.After(l.cachedUntil) {
		l.cached = make(map[netip.Addr]string)
		for _, r := range l.presence.Routers() {
			if addr, ok := routerAddr(r.Host); ok {
				l.cached[addr] = r.ID
			}
		}
		l.cachedUntil = now.Add(routerCacheTTL)
	}
	id, ok := l.cached[source]
	return id, ok
}

// warnUnknown mencatat pengirim tak dikenal paling sering sekali per 10 menit
// per alamat, supaya alamat itu bisa dipetakan lewat SYSLOG_SOURCE_MAP.
func (l *SyslogListener) warnUnknown(from net.Addr) {
	udp, ok := from.(*net.UDPAddr)
	if !ok {
		return
	}
	addr := udp.AddrPort().Addr().Unmap()
	l.cacheMu.Lock()
	defer l.cacheMu.Unlock()
	if l.warnedAt == nil {
		l.warnedAt = make(map[netip.Addr]time.Time)
	}
	if now := time.Now(); now.Sub(l.warnedAt[addr]) > 10*time.Minute {
		l.warnedAt[addr] = now
		l.logger.Warn("syslog dari alamat yang bukan router terdaftar dibuang; petakan lewat SYSLOG_SOURCE_MAP bila ini router", "alamat", addr.String())
	}
}

// RouterAddr adalah routerAddr untuk paket lain (NetFlow) yang mencocokkan
// pengirim dengan Host router.
func RouterAddr(host string) (netip.Addr, bool) { return routerAddr(host) }

// routerAddr mengambil alamat IP dari Host router, yang boleh berbentuk
// "10.0.0.1", "10.0.0.1:8728", atau "https://10.0.0.1". Nama host tidak
// diterjemahkan; pakai alamat IP agar syslog bisa dicocokkan.
func routerAddr(host string) (netip.Addr, bool) {
	if _, rest, found := strings.Cut(host, "://"); found {
		host = rest
	}
	host = strings.TrimRight(host, "/")
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	addr, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}
