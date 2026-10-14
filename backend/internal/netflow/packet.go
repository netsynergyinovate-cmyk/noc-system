// Package netflow menerima dan mem-parse paket NetFlow v5 (MikroTik Traffic Flow, UDP 2055).
package netflow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net"
)

const (
	HeaderLen  = 24
	RecordLen  = 48
	MaxRecords = 30
)

var ErrInvalidPacket = errors.New("netflow: paket tidak valid")

type Header struct {
	Version          uint16
	Count            uint16
	SysUptime        uint32
	UnixSecs         uint32
	UnixNano         uint32
	FlowSequence     uint32
	EngineType       uint8
	EngineID         uint8
	SamplingInterval uint16
}

type Record struct {
	SrcAddr, DstAddr, NextHop net.IP
	InputIface, OutputIface   uint16
	Pkts, Bytes               uint32
	First, Last               uint32
	SrcPort, DstPort          uint16
	TCPFlags                  uint8
	Proto                     uint8
	Tos                       uint8
	SrcAS, DstAS              uint16
	SrcMask, DstMask          uint8
}

func ipv4(b []byte) net.IP { return net.IPv4(b[0], b[1], b[2], b[3]) }

// ParseV5 mem-parse satu datagram NetFlow v5.
func ParseV5(b []byte) (*Header, []Record, error) {
	if len(b) < HeaderLen {
		return nil, nil, fmt.Errorf("%w: panjang %d < %d", ErrInvalidPacket, len(b), HeaderLen)
	}
	be := binary.BigEndian
	h := &Header{
		Version:          be.Uint16(b[0:]),
		Count:            be.Uint16(b[2:]),
		SysUptime:        be.Uint32(b[4:]),
		UnixSecs:         be.Uint32(b[8:]),
		UnixNano:         be.Uint32(b[12:]),
		FlowSequence:     be.Uint32(b[16:]),
		EngineType:       b[20],
		EngineID:         b[21],
		SamplingInterval: be.Uint16(b[22:]),
	}
	if h.Version != 5 {
		return nil, nil, fmt.Errorf("%w: versi %d", ErrInvalidPacket, h.Version)
	}
	if h.Count < 1 || h.Count > MaxRecords {
		return nil, nil, fmt.Errorf("%w: count %d", ErrInvalidPacket, h.Count)
	}
	n := int(h.Count)
	if HeaderLen+n*RecordLen > len(b) {
		return nil, nil, fmt.Errorf("%w: record terpotong", ErrInvalidPacket)
	}
	recs := make([]Record, n)
	for i := range recs {
		r := b[HeaderLen+i*RecordLen:]
		recs[i] = Record{
			SrcAddr:     ipv4(r[0:]),
			DstAddr:     ipv4(r[4:]),
			NextHop:     ipv4(r[8:]),
			InputIface:  be.Uint16(r[12:]),
			OutputIface: be.Uint16(r[14:]),
			Pkts:        be.Uint32(r[16:]),
			Bytes:       be.Uint32(r[20:]),
			First:       be.Uint32(r[24:]),
			Last:        be.Uint32(r[28:]),
			SrcPort:     be.Uint16(r[32:]),
			DstPort:     be.Uint16(r[34:]),
			TCPFlags:    r[37],
			Proto:       r[38],
			Tos:         r[39],
			SrcAS:       be.Uint16(r[40:]),
			DstAS:       be.Uint16(r[42:]),
			SrcMask:     r[44],
			DstMask:     r[45],
		}
	}
	return h, recs, nil
}
