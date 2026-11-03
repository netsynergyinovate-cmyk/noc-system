package netflow

import (
	"context"
	"encoding/binary"
	"net"
	"net/netip"
	"testing"
	"time"
)

func buildV5(version, count uint16, recs int) []byte {
	b := make([]byte, HeaderLen+recs*RecordLen)
	be := binary.BigEndian
	be.PutUint16(b[0:], version)
	be.PutUint16(b[2:], count)
	be.PutUint32(b[16:], 99)
	for i := range recs {
		r := b[HeaderLen+i*RecordLen:]
		copy(r[0:], net.IPv4(10, 0, 0, byte(i+1)).To4())
		copy(r[4:], net.IPv4(8, 8, 8, 8).To4())
		be.PutUint32(r[16:], uint32(10+i))
		be.PutUint32(r[20:], uint32(1500*(i+1)))
		be.PutUint16(r[32:], uint16(40000+i))
		be.PutUint16(r[34:], 443)
		r[38] = 6
		if i == 1 {
			r[38] = 17
		}
	}
	return b
}

func TestParseV5(t *testing.T) {
	h, recs, err := ParseV5(buildV5(5, 2, 2))
	if err != nil {
		t.Fatal(err)
	}
	if h.Count != 2 || h.FlowSequence != 99 || len(recs) != 2 {
		t.Fatalf("header/records salah: %+v %d", h, len(recs))
	}
	r := recs[1]
	if !r.SrcAddr.Equal(net.IPv4(10, 0, 0, 2)) || !r.DstAddr.Equal(net.IPv4(8, 8, 8, 8)) ||
		r.SrcPort != 40001 || r.DstPort != 443 || r.Bytes != 3000 || r.Pkts != 11 || r.Proto != 17 {
		t.Fatalf("record salah: %+v", r)
	}
	if recs[0].Proto != 6 || recs[0].Bytes != 1500 {
		t.Fatalf("record 0 salah: %+v", recs[0])
	}
}

func TestParseV5Rejects(t *testing.T) {
	cases := map[string][]byte{
		"pendek":    make([]byte, 23),
		"versi":     buildV5(9, 1, 1),
		"count 0":   buildV5(5, 0, 1),
		"count 31":  buildV5(5, 31, 31),
		"terpotong": buildV5(5, 2, 1),
	}
	for name, b := range cases {
		if _, _, err := ParseV5(b); err == nil {
			t.Errorf("%s: harus error", name)
		}
	}
}

type chanSink chan []Record

func (c chanSink) HandleFlows(_ context.Context, r []Record) error { c <- r; return nil }

func TestServerReceives(t *testing.T) {
	sink := make(chanSink, 1)
	s, err := NewServer("127.0.0.1:0", sink, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.ListenAndServe(ctx) }()
	c, err := net.Dial("udp", s.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte("junk"))
	c.Write(buildV5(5, 2, 2))
	select {
	case r := <-sink:
		if len(r) != 2 {
			t.Fatalf("got %d records", len(r))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func buildV9WithTemplate(templateID uint16, samplingRate uint32) []byte {
	// Header (20) + Template FlowSet (40) + Data FlowSet (32) = 92 bytes
	tmplLen := 4 + 4 + 9*4 // 44 bytes
	recLen := 4 + 4 + 2 + 2 + 1 + 1 + 4 + 4 + 4 // 26 bytes
	pad := 2
	dataLen := 4 + recLen + pad // 32 bytes
	total := HeaderLenV9 + tmplLen + dataLen
	b := make([]byte, total)
	be := binary.BigEndian

	// Header
	be.PutUint16(b[0:], 9)
	be.PutUint16(b[2:], 2)
	be.PutUint32(b[4:], 1000)
	be.PutUint32(b[8:], 1700000000)
	be.PutUint32(b[12:], 1)
	be.PutUint32(b[16:], 123)

	// FlowSet 0: Template
	pos := HeaderLenV9
	be.PutUint16(b[pos:], 0)
	be.PutUint16(b[pos+2:], uint16(tmplLen))
	be.PutUint16(b[pos+4:], templateID)
	be.PutUint16(b[pos+6:], 9)
	fields := [][2]uint16{
		{FieldIPv4SrcAddr, 4},
		{FieldIPv4DstAddr, 4},
		{FieldL4SrcPort, 2},
		{FieldL4DstPort, 2},
		{FieldProtocol, 1},
		{FieldTCPFlags, 1},
		{FieldInPkts, 4},
		{FieldInBytes, 4},
		{FieldSamplingInterval, 4},
	}
	tPos := pos + 8
	for _, f := range fields {
		be.PutUint16(b[tPos:], f[0])
		be.PutUint16(b[tPos+2:], f[1])
		tPos += 4
	}

	// FlowSet: Data
	pos += tmplLen
	be.PutUint16(b[pos:], templateID)
	be.PutUint16(b[pos+2:], uint16(dataLen))
	dPos := pos + 4
	copy(b[dPos:], net.IPv4(192, 168, 10, 5).To4())
	copy(b[dPos+4:], net.IPv4(8, 8, 4, 4).To4())
	be.PutUint16(b[dPos+8:], 50000)
	be.PutUint16(b[dPos+10:], 443)
	b[dPos+12] = 6
	b[dPos+13] = 18
	be.PutUint32(b[dPos+14:], 15)
	be.PutUint32(b[dPos+18:], 15000)
	be.PutUint32(b[dPos+22:], samplingRate)

	return b
}

func buildIPFIXWithTemplate(templateID uint16) []byte {
	tmplLen := 4 + 4 + 8*4 // 40 bytes
	recLen := 4 + 4 + 2 + 2 + 1 + 1 + 4 + 4 // 22 bytes
	pad := 2
	dataLen := 4 + recLen + pad // 28 bytes
	total := HeaderLenIPFIX + tmplLen + dataLen
	b := make([]byte, total)
	be := binary.BigEndian

	// Header
	be.PutUint16(b[0:], 10)
	be.PutUint16(b[2:], uint16(total))
	be.PutUint32(b[4:], 1700000000)
	be.PutUint32(b[8:], 1)
	be.PutUint32(b[12:], 456)

	// Set 2: Template
	pos := HeaderLenIPFIX
	be.PutUint16(b[pos:], 2)
	be.PutUint16(b[pos+2:], uint16(tmplLen))
	be.PutUint16(b[pos+4:], templateID)
	be.PutUint16(b[pos+6:], 8)
	fields := [][2]uint16{
		{FieldIPv4SrcAddr, 4},
		{FieldIPv4DstAddr, 4},
		{FieldL4SrcPort, 2},
		{FieldL4DstPort, 2},
		{FieldProtocol, 1},
		{FieldTCPFlags, 1},
		{FieldInPkts, 4},
		{FieldInBytes, 4},
	}
	tPos := pos + 8
	for _, f := range fields {
		be.PutUint16(b[tPos:], f[0])
		be.PutUint16(b[tPos+2:], f[1])
		tPos += 4
	}

	// Set: Data
	pos += tmplLen
	be.PutUint16(b[pos:], templateID)
	be.PutUint16(b[pos+2:], uint16(dataLen))
	dPos := pos + 4
	copy(b[dPos:], net.IPv4(10, 10, 10, 20).To4())
	copy(b[dPos+4:], net.IPv4(1, 1, 1, 1).To4())
	be.PutUint16(b[dPos+8:], 34567)
	be.PutUint16(b[dPos+10:], 53)
	b[dPos+12] = 17
	b[dPos+13] = 0
	be.PutUint32(b[dPos+14:], 3)
	be.PutUint32(b[dPos+18:], 240)

	return b
}

func TestParseV9(t *testing.T) {
	b := buildV9WithTemplate(300, 10)
	recs, rate, err := ParseV9(b)
	if err != nil {
		t.Fatal(err)
	}
	if rate != 10 {
		t.Fatalf("sampling rate = %d, mau 10", rate)
	}
	if len(recs) != 1 {
		t.Fatalf("jumlah record = %d, mau 1", len(recs))
	}
	r := recs[0]
	if !r.SrcAddr.Equal(net.IPv4(192, 168, 10, 5)) || !r.DstAddr.Equal(net.IPv4(8, 8, 4, 4)) {
		t.Fatalf("IP salah: src=%v dst=%v", r.SrcAddr, r.DstAddr)
	}
	if r.SrcPort != 50000 || r.DstPort != 443 || r.Proto != 6 || r.TCPFlags != 18 {
		t.Fatalf("port/proto salah: sport=%d dport=%d proto=%d flags=%d", r.SrcPort, r.DstPort, r.Proto, r.TCPFlags)
	}
	if r.Pkts != 15 || r.Bytes != 15000 {
		t.Fatalf("pkts/bytes salah: pkts=%d bytes=%d", r.Pkts, r.Bytes)
	}
}

func TestParseIPFIX(t *testing.T) {
	b := buildIPFIXWithTemplate(301)
	recs, rate, err := ParseIPFIX(b)
	if err != nil {
		t.Fatal(err)
	}
	_ = rate
	if len(recs) != 1 {
		t.Fatalf("jumlah record = %d, mau 1", len(recs))
	}
	r := recs[0]
	if !r.SrcAddr.Equal(net.IPv4(10, 10, 10, 20)) || !r.DstAddr.Equal(net.IPv4(1, 1, 1, 1)) {
		t.Fatalf("IP salah: src=%v dst=%v", r.SrcAddr, r.DstAddr)
	}
	if r.SrcPort != 34567 || r.DstPort != 53 || r.Proto != 17 {
		t.Fatalf("port/proto salah: sport=%d dport=%d proto=%d", r.SrcPort, r.DstPort, r.Proto)
	}
	if r.Pkts != 3 || r.Bytes != 240 {
		t.Fatalf("pkts/bytes salah: pkts=%d bytes=%d", r.Pkts, r.Bytes)
	}
}

func TestParsePacketAutoDetect(t *testing.T) {
	// v5
	v5Data := buildV5(5, 2, 2)
	ver5, recs5, rate5, err := ParsePacket(v5Data)
	if err != nil || ver5 != 5 || len(recs5) != 2 || rate5 != 1 {
		t.Fatalf("v5 gagal: ver=%d len=%d rate=%d err=%v", ver5, len(recs5), rate5, err)
	}

	// v9
	v9Data := buildV9WithTemplate(302, 50)
	ver9, recs9, rate9, err := ParsePacket(v9Data)
	if err != nil || ver9 != 9 || len(recs9) != 1 || rate9 != 50 {
		t.Fatalf("v9 gagal: ver=%d len=%d rate=%d err=%v", ver9, len(recs9), rate9, err)
	}

	// IPFIX (v10)
	ipfixData := buildIPFIXWithTemplate(303)
	ver10, recs10, rate10, err := ParsePacket(ipfixData)
	if err != nil || ver10 != 10 || len(recs10) != 1 || rate10 != 1 {
		t.Fatalf("ipfix gagal: ver=%d len=%d rate=%d err=%v", ver10, len(recs10), rate10, err)
	}

	// Tidak didukung
	bad := make([]byte, 20)
	binary.BigEndian.PutUint16(bad[0:], 7)
	if _, _, _, err := ParsePacket(bad); err == nil {
		t.Fatal("harus error untuk versi 7")
	}
}

func TestServerTracksExportersAndHealth(t *testing.T) {
	sink := make(chanSink, 4)
	s, err := NewServer("127.0.0.1:0", sink, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- s.ListenAndServe(ctx) }()

	c, err := net.Dial("udp", s.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	// Kirim v9 dengan sampling rate 10
	c.Write(buildV9WithTemplate(304, 10))
	select {
	case r := <-sink:
		if len(r) != 1 {
			t.Fatalf("got %d records", len(r))
		}
		// Sampling rate 10 harus sudah dikalikan: Bytes 15000 * 10 = 150000, Pkts 15 * 10 = 150
		if r[0].Bytes != 150000 || r[0].Pkts != 150 {
			t.Fatalf("sampling multiplier gagal: bytes=%d pkts=%d", r[0].Bytes, r[0].Pkts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout menunggu v9")
	}

	// Kirim IPFIX
	c.Write(buildIPFIXWithTemplate(305))
	select {
	case r := <-sink:
		if len(r) != 1 {
			t.Fatalf("got %d records", len(r))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout menunggu IPFIX")
	}

	// Periksa Exporters
	exps := s.Exporters()
	if len(exps) == 0 {
		t.Fatal("exporters kosong")
	}
	exp := exps[0]
	if exp.Packets < 2 || exp.Flows < 2 {
		t.Fatalf("statistik exporter salah: %+v", exp)
	}
	if exp.LastSeen.IsZero() {
		t.Fatal("LastSeen kosong")
	}

	// Periksa Health
	h := s.Health()
	if !h.Active || h.TotalPackets < 2 || h.TotalFlows < 2 || len(h.Exporters) == 0 {
		t.Fatalf("health salah: %+v", h)
	}
	if h.LastReceivedAt == nil {
		t.Fatal("LastReceivedAt nil")
	}

	cancel()
	_ = <-done
}

func TestServerManualSamplingRate(t *testing.T) {
	sink := make(chanSink, 2)
	s, err := NewServer("127.0.0.1:0", sink, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.SetSamplingRate("r-custom", 20)
	s.SetResolver(func(addr netip.Addr) (string, bool) {
		return "r-custom", true
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.ListenAndServe(ctx) }()

	c, err := net.Dial("udp", s.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	// Paket 1: v5 tanpa sampling (rate 1), tetapi manual rate 20 diatur
	c.Write(buildV5(5, 1, 1))
	select {
	case r := <-sink:
		if len(r) != 1 {
			t.Fatalf("got %d records", len(r))
		}
		if r[0].Bytes != 30000 || r[0].Pkts != 200 {
			t.Fatalf("manual sampling rate gagal: bytes=%d pkts=%d", r[0].Bytes, r[0].Pkts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout packet 1")
	}

	// Paket 2: verifikasi tidak ada deadlock dan pengali tetap aktif
	c.Write(buildV5(5, 1, 1))
	select {
	case r := <-sink:
		if len(r) != 1 {
			t.Fatalf("got %d records on packet 2", len(r))
		}
		if r[0].Bytes != 30000 || r[0].Pkts != 200 {
			t.Fatalf("packet 2 sampling rate gagal: bytes=%d pkts=%d", r[0].Bytes, r[0].Pkts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout packet 2 - kemungkinan deadlock pada lock mutex")
	}
}
