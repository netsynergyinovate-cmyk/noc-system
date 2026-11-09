package customers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"noc-isp/backend/internal/collector"
	"noc-isp/backend/internal/cpe"
)

// CustomerLiveStatus memenuhi kontrak CustomerLiveStatus di frontend dashboard.
type CustomerLiveStatus struct {
	IP          *string  `json:"ip"`
	Uptime      *string  `json:"uptime"`
	SSID        *string  `json:"ssid"`
	Clients     *int     `json:"clients"`
	RxDbm       *float64 `json:"rxDbm"`
	RxSource    *string  `json:"rxSource"`
	OnuLos      bool     `json:"onuLos"`
	ModemOnline bool     `json:"modemOnline"`
	InformAt    *int64   `json:"informAt"`
	StaleNote   *string  `json:"staleNote"`
}

type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type SessionLookup interface {
	LookupCustomer(customerID string) (collector.CustomerSession, bool)
	LookupUser(username string) (collector.CustomerSession, bool)
}

type Service struct {
	db        DB
	sessions  SessionLookup
	cpeClient *cpe.Client
	logger    *slog.Logger
	now       func() time.Time

	mu         sync.Mutex
	cpeCacheAt time.Time
	cpeCache   map[string]cpeInfo
}

type cpeInfo struct {
	PPPoEUsername string
	WanIP         string
	UptimeText    string
	IsOnline      bool
	LastInformAt  int64
	SSID          string
	ClientsCount  *int
	RxDbm         *float64
}

func NewService(db DB, sessions SessionLookup, cpeClient *cpe.Client, logger *slog.Logger) *Service {
	return &Service{
		db:        db,
		sessions:  sessions,
		cpeClient: cpeClient,
		logger:    logger,
		now:       time.Now,
	}
}

const cpeCacheTTL = 20 * time.Second

// loadCpeMap mengambil daftar modem GenieACS dan mengindeksnya per lowercase pppoeUsername.
func (s *Service) loadCpeMap(ctx context.Context) map[string]cpeInfo {
	if s.cpeClient == nil {
		return nil
	}
	s.mu.Lock()
	if !s.cpeCacheAt.IsZero() && s.now().Sub(s.cpeCacheAt) < cpeCacheTTL && s.cpeCache != nil {
		cached := s.cpeCache
		s.mu.Unlock()
		return cached
	}
	s.mu.Unlock()
	projection := "_lastInform,VirtualParameters.pppoeUsername,VirtualParameters.ipPppoe,VirtualParameters.ipTr069,VirtualParameters.rxPower,VirtualParameters.connectedDevices,InternetGatewayDevice.DeviceInfo.UpTime,Device.DeviceInfo.UpTime,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID,InternetGatewayDevice.LANDevice.WLANConfiguration.1.SSID,Device.WiFi.SSID.1.SSID,InternetGatewayDevice.WANDevice.1.WANConnectionDevice,InternetGatewayDevice.X_ALU_OntOpticalParam,InternetGatewayDevice.DeviceInfo.XponInterface,InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig,InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig,InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig,InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig,InternetGatewayDevice.Optical.Interface.1.OpticalSignalLevel,Device.Optical.Interface.1.OpticalSignalLevel,Device.PPP.Interface"
	rawDevices, err := s.cpeClient.ListDevicesProjected(ctx, "", projection)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("gagal memuat daftar perangkat GenieACS NBI", "error", err)
		}
		s.mu.Lock()
		cached := s.cpeCache
		s.mu.Unlock()
		return cached
	}

	nowSec := s.now().Unix()
	res := make(map[string]cpeInfo, len(rawDevices))
	for _, d := range rawDevices {
		info := parseCpeDevice(d, nowSec)
		if info.PPPoEUsername != "" {
			res[strings.ToLower(strings.TrimSpace(info.PPPoEUsername))] = info
		}
	}

	s.mu.Lock()
	s.cpeCache = res
	s.cpeCacheAt = s.now()
	s.mu.Unlock()

	return res
}

// GetLiveStatus menyatukan data GenieACS, MikroTik, dan OLT langsung di backend Go.
func (s *Service) GetLiveStatus(ctx context.Context) (map[string]CustomerLiveStatus, error) {
	if s.db == nil {
		return map[string]CustomerLiveStatus{}, nil
	}

	nowSec := s.now().Unix()
	cpeByUser := s.loadCpeMap(ctx)

	// 1. Ambil pelanggan dari DB
	custRows, err := s.db.Query(ctx, `SELECT id::text, pppoe_username, is_online, optical_power::float8 FROM customers`)
	if err != nil {
		return nil, fmt.Errorf("query customers: %w", err)
	}
	defer custRows.Close()

	type custRow struct {
		id       string
		username string
		isOnline bool
		rxPower  *float64
	}
	var custList []custRow
	for custRows.Next() {
		var c custRow
		if err := custRows.Scan(&c.id, &c.username, &c.isOnline, &c.rxPower); err == nil {
			custList = append(custList, c)
		}
	}
	custRows.Close()

	// 2. Ambil data ONU OLT (kondisi optik dan status online/offline/los)
	type onuRow struct {
		customerID string
		status     string
		rxPower    *float64
		ponIndex   int
		onuIndex   int
	}
	onuByCust := make(map[string]onuRow)
	onuRows, err := s.db.Query(ctx, `
		SELECT customer_id::text, status, rx_power::float8, pon_index, onu_index
		FROM olt_onus
		WHERE customer_id IS NOT NULL`)
	if err == nil {
		for onuRows.Next() {
			var o onuRow
			if err := onuRows.Scan(&o.customerID, &o.status, &o.rxPower, &o.ponIndex, &o.onuIndex); err == nil {
				onuByCust[o.customerID] = o
			}
		}
		onuRows.Close()
	}

	// 3. Ambil fallback IP dari billing runsnet
	ipBilling := make(map[string]string)
	billRows, err := s.db.Query(ctx, `SELECT cust_id, ip_address FROM runsnet_customers WHERE ip_address IS NOT NULL`)
	if err == nil {
		for billRows.Next() {
			var cid, ip string
			if err := billRows.Scan(&cid, &ip); err == nil && ip != "" {
				ipBilling[strings.ToLower(strings.TrimSpace(cid))] = ip
			}
		}
		billRows.Close()
	}

	// 4. Gabungkan menjadi satu map output utuh
	out := make(map[string]CustomerLiveStatus, len(custList))
	for _, c := range custList {
		normUser := strings.ToLower(strings.TrimSpace(c.username))
		billingKey := strings.TrimSuffix(normUser, "@runsnet.id")

		cpe, hasCpe := cpeByUser[normUser]
		onu, hasOnu := onuByCust[c.id]

		// Deteksi LOS seketika: OLT menandai status ONU sebagai "los"
		isLos := hasOnu && strings.EqualFold(strings.TrimSpace(onu.status), "los")

		// Evaluasi Redaman Optik (RX dBm) & Sumber
		var rxDbm *float64
		var rxSource *string
		if isLos {
			rxDbm = nil
			oltSrc := "olt"
			rxSource = &oltSrc
		} else {
			if hasCpe && cpe.IsOnline && cpe.RxDbm != nil && *cpe.RxDbm > -35.0 && *cpe.RxDbm != 0.0 {
				rxDbm = cpe.RxDbm
				src := "genieacs"
				rxSource = &src
			} else if hasOnu && onu.rxPower != nil && *onu.rxPower > -35.0 && *onu.rxPower != 0.0 {
				rxDbm = onu.rxPower
				src := "olt"
				rxSource = &src
			}
		}

		// Evaluasi IP: MikroTik PPPoE aktif -> GenieACS WAN IP -> Billing IP
		var ip *string
		var mikrotikUptime string
		if s.sessions != nil {
			if sess, ok := s.sessions.LookupCustomer(c.id); ok && sess.IP != "" {
				ip = &sess.IP
				mikrotikUptime = sess.Uptime
			} else if sess, ok := s.sessions.LookupUser(normUser); ok && sess.IP != "" {
				ip = &sess.IP
				mikrotikUptime = sess.Uptime
			}
		}
		if ip == nil && hasCpe && cpe.WanIP != "" {
			ip = &cpe.WanIP
		}
		if ip == nil {
			if billIP, ok := ipBilling[billingKey]; ok && billIP != "" {
				ip = &billIP
			}
		}

		// Evaluasi Uptime:
		// 1. Modem GenieACS online -> uptime modem
		// 2. Modem GenieACS offline tapi MikroTik aktif -> uptime sesi MikroTik
		// 3. Bila modem offline -> uptime terakhir modem dengan catatan staleNote
		var uptime *string
		var staleNote *string
		if hasCpe && cpe.IsOnline && cpe.UptimeText != "" {
			uptime = &cpe.UptimeText
		} else if mikrotikUptime != "" {
			normUp := normalizeRouterOSUptime(mikrotikUptime)
			uptime = &normUp
		} else if hasCpe && cpe.UptimeText != "" {
			uptime = &cpe.UptimeText
			if cpe.LastInformAt > 0 {
				note := fmt.Sprintf("per %s", formatAgo(nowSec-cpe.LastInformAt))
				staleNote = &note
			}
		}

		// Wi-Fi SSID & Clients dari GenieACS
		var ssid *string
		if hasCpe && cpe.SSID != "" {
			ssid = &cpe.SSID
		}
		var clients *int
		if hasCpe && cpe.ClientsCount != nil {
			clients = cpe.ClientsCount
		}

		// Modem online & informAt
		modemOnline := false
		var informAt *int64
		if hasCpe {
			modemOnline = cpe.IsOnline
			if cpe.LastInformAt > 0 {
				informAt = &cpe.LastInformAt
			}
		}

		out[c.id] = CustomerLiveStatus{
			IP:          ip,
			Uptime:      uptime,
			SSID:        ssid,
			Clients:     clients,
			RxDbm:       rxDbm,
			RxSource:    rxSource,
			OnuLos:      isLos,
			ModemOnline: modemOnline,
			InformAt:    informAt,
			StaleNote:   staleNote,
		}
	}

	return out, nil
}

// formatAgo memformat jeda waktu detik ke bahasa Indonesia ringkas
func formatAgo(seconds int64) string {
	s := max(0, seconds)
	if s < 60 {
		return "baru saja"
	}
	if s < 3600 {
		return fmt.Sprintf("%d mnt lalu", s/60)
	}
	if s < 86400 {
		return fmt.Sprintf("%d jam lalu", s/3600)
	}
	return fmt.Sprintf("%d hari lalu", s/86400)
}

func normalizeRouterOSUptime(s string) string {
	if s == "" {
		return ""
	}
	var weeks, days, hours, mins, secs int64
	var curr int64
	hasUnits := false
	for i := range s {
		ch := s[i]
		if ch >= '0' && ch <= '9' {
			curr = curr*10 + int64(ch-'0')
		} else {
			switch ch {
			case 'w':
				weeks = curr
				hasUnits = true
			case 'd':
				days = curr
				hasUnits = true
			case 'h':
				hours = curr
				hasUnits = true
			case 'm':
				mins = curr
				hasUnits = true
			case 's':
				secs = curr
				hasUnits = true
			}
			curr = 0
		}
	}
	if !hasUnits {
		return s
	}
	totalSec := weeks*7*86400 + days*86400 + hours*3600 + mins*60 + secs
	return formatSecondsUptime(totalSec)
}

func formatSecondsUptime(sec int64) string {
	if sec <= 0 {
		return "—"
	}
	days := sec / 86400
	hours := (sec % 86400) / 3600
	minutes := (sec % 3600) / 60
	if days > 0 {
		return fmt.Sprintf("%dh %dj %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dj %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

// parseCpeDevice mengekstrak data leaf TR-098/TR-181 dan VirtualParameters dari raw GenieACS
func parseCpeDevice(raw map[string]any, nowSec int64) cpeInfo {
	var info cpeInfo

	// Last inform & Online status
	lastInform := getInt64Field(raw, "_lastInform")
	if lastInform > 1e11 {
		lastInform = lastInform / 1000
	}
	info.LastInformAt = lastInform
	// Online window 15 menit (900 detik)
	info.IsOnline = lastInform > 0 && (nowSec-lastInform) <= 900

	// 1. PPPoE Username
	info.PPPoEUsername = findNestedString(raw,
		"VirtualParameters.pppoeUsername",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username",
		"Device.PPP.Interface.1.Username",
	)

	// 2. WAN IP / PPPoE IP
	info.WanIP = findNestedString(raw,
		"VirtualParameters.ipPppoe",
		"VirtualParameters.ipTr069",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
		"Device.IP.Interface.1.IPv4Address.1.IPAddress",
		"_ip",
	)
	if info.WanIP == "0.0.0.0" {
		info.WanIP = ""
	}

	// 3. Uptime
	upSec := findNestedInt64(raw,
		"InternetGatewayDevice.DeviceInfo.UpTime",
		"Device.DeviceInfo.UpTime",
	)
	if upSec > 0 {
		info.UptimeText = formatSecondsUptime(upSec)
	}

	// 4. Wi-Fi SSID
	info.SSID = findNestedString(raw,
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
		"InternetGatewayDevice.LANDevice.WLANConfiguration.1.SSID",
		"Device.WiFi.SSID.1.SSID",
	)

	// 5. Wi-Fi Clients count
	if v, ok := getNestedVal(raw, "VirtualParameters.connectedDevices"); ok {
		switch countVal := v.(type) {
		case float64:
			c := int(countVal)
			info.ClientsCount = &c
		case int:
			info.ClientsCount = &countVal
		case string:
			var list []any
			if json.Unmarshal([]byte(countVal), &list) == nil {
				c := len(list)
				info.ClientsCount = &c
			} else if n, err := strconv.Atoi(countVal); err == nil {
				info.ClientsCount = &n
			}
		case []any:
			c := len(countVal)
			info.ClientsCount = &c
		}
	}

	// 6. Rx Power (dBm) mengikuti urutan dan konversi multi-vendor yang teruji
	info.RxDbm = parseOpticalRx(raw)

	return info
}

func parseOpticalRx(raw map[string]any) *float64 {
	// 1. CDTC: X_ALU_OntOpticalParam
	if s := findNestedString(raw,
		"InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
		"Device.X_ALU_OntOpticalParam.RXPower",
	); s != "" {
		if val, err := parseDbmString(s); err == nil && val > -35.0 && val != 0 {
			r := math.Round(val*100) / 100
			return &r
		}
	}

	// 2. CDTC cadangan: DeviceInfo.XponInterface
	if s := findNestedString(raw,
		"InternetGatewayDevice.DeviceInfo.XponInterface.RXPower",
		"Device.DeviceInfo.XponInterface.RXPower",
	); s != "" {
		if val, err := parseDbmString(s); err == nil && val > -35.0 && val != 0 {
			r := math.Round(val*100) / 100
			return &r
		}
	}

	// 3. CT-COM (Epon / Gpon): 0.1 uW mentah -> dBm
	if rawRx, ok := findNestedFloat(raw,
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
		"Device.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
		"Device.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
	); ok && rawRx > 0 {
		dbm := math.Round((10*math.Log10(rawRx*0.0001))*100) / 100
		if dbm > -35.0 {
			return &dbm
		}
	}

	// 4. CMCC (ZTE F609 & Huawei HG8245H Epon / Gpon): 0.1 uW mentah -> dBm
	if rawRx, ok := findNestedFloat(raw,
		"InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower",
		"Device.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower",
		"Device.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower",
	); ok && rawRx > 0 {
		dbm := math.Round((10*math.Log10(rawRx*0.0001))*100) / 100
		if dbm > -35.0 {
			return &dbm
		}
	}

	// 5. TR-181 Optical Interface
	if optRx, ok := findNestedFloat(raw,
		"InternetGatewayDevice.Optical.Interface.1.OpticalSignalLevel",
		"Device.Optical.Interface.1.OpticalSignalLevel",
	); ok {
		if math.Abs(optRx) > 100 {
			optRx = optRx * 0.001
		}
		if optRx > -35.0 && optRx != 0 {
			r := math.Round(optRx*100) / 100
			return &r
		}
	}

	// 6. VirtualParameters.rxPower
	if rx, ok := findNestedFloat(raw, "VirtualParameters.rxPower"); ok && rx > -35.0 && rx != 0 {
		r := math.Round(rx*100) / 100
		return &r
	}

	return nil
}

func parseDbmString(s string) (float64, error) {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0, fmt.Errorf("empty string")
	}
	clean := strings.TrimRight(fields[0], "dBm")
	return strconv.ParseFloat(clean, 64)
}


func getNestedVal(raw map[string]any, path string) (any, bool) {
	if v, ok := raw[path]; ok {
		return unwrapValue(v), true
	}
	segs := strings.Split(path, ".")
	var curr any = raw
	for _, seg := range segs {
		m, ok := curr.(map[string]any)
		if !ok {
			return nil, false
		}
		curr, ok = m[seg]
		if !ok {
			return nil, false
		}
	}
	return unwrapValue(curr), true
}

func unwrapValue(v any) any {
	if m, ok := v.(map[string]any); ok {
		if val, exists := m["_value"]; exists {
			return val
		}
	}
	return v
}

func findNestedString(raw map[string]any, paths ...string) string {
	for _, p := range paths {
		if v, ok := getNestedVal(raw, p); ok && v != nil {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" && s != "—" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}

func findNestedFloat(raw map[string]any, paths ...string) (float64, bool) {
	for _, p := range paths {
		if v, ok := getNestedVal(raw, p); ok && v != nil {
			switch n := v.(type) {
			case float64:
				return n, true
			case int:
				return float64(n), true
			case int64:
				return float64(n), true
			case string:
				if f, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
					return f, true
				}
			}
		}
	}
	return 0, false
}

func findNestedInt64(raw map[string]any, paths ...string) int64 {
	for _, p := range paths {
		if v, ok := getNestedVal(raw, p); ok && v != nil {
			switch n := v.(type) {
			case int64:
				return n
			case int:
				return int64(n)
			case float64:
				return int64(n)
			case string:
				if i, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64); err == nil {
					return i
				}
			}
		}
	}
	return 0
}

func getInt64Field(raw map[string]any, key string) int64 {
	if v, ok := raw[key]; ok && v != nil {
		switch n := v.(type) {
		case int:
			return int64(n)
		case int64:
			return n
		case float64:
			return int64(n)
		case string:
			if t, err := time.Parse(time.RFC3339, n); err == nil {
				return t.Unix()
			}
			if i, err := strconv.ParseInt(n, 10, 64); err == nil {
				return i
			}
		}
	}
	return 0
}
