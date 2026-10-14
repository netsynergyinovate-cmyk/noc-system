package netflow

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func buildV5(version, count uint16, recs int) []byte {
	b := make([]byte, HeaderLen+recs*RecordLen)
	be := binary.BigEndian
	be.PutUint16(b[0:], version)
	be.PutUint16(b[2:], count)
	be.PutUint32(b[16:], 99)
	for i := 0; i < recs; i++ {
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
