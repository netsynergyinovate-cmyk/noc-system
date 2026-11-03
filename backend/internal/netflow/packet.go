// Package netflow menerima dan mem-parse paket NetFlow (v5, v9, IPFIX / v10).
package netflow

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"sync"
)

const (
	HeaderLen      = 24
	RecordLen      = 48
	MaxRecords     = 30
	HeaderLenV9    = 20
	HeaderLenIPFIX = 16
)

// NetFlow v9 dan IPFIX Field Types (RFC 3954 / RFC 7012)
const (
	FieldInBytes          = 1
	FieldInPkts           = 2
	FieldFlows            = 3
	FieldProtocol         = 4
	FieldSrcTos           = 5
	FieldTCPFlags         = 6
	FieldL4SrcPort        = 7
	FieldIPv4SrcAddr      = 8
	FieldSrcMask          = 9
	FieldInputSNMP        = 10
	FieldL4DstPort        = 11
	FieldIPv4DstAddr      = 12
	FieldDstMask          = 13
	FieldOutputSNMP       = 14
	FieldIPv4NextHop      = 15
	FieldSrcAS            = 16
	FieldDstAS            = 17
	FieldLastSwitched     = 21
	FieldFirstSwitched    = 22
	FieldOutBytes         = 23
	FieldOutPkts          = 24
	FieldIPv6SrcAddr      = 27
	FieldIPv6DstAddr      = 28
	FieldSamplingInterval = 34
	FieldSamplerRandomInt = 50
	FieldTotalBytesExp    = 85
	FieldTotalPktsExp     = 86
	FieldIPFIXSamplingInt = 305
)

type TemplateField struct {
	Type       uint16
	Length     uint16
	Enterprise uint32
}

type TemplateKey struct {
	Addr       netip.Addr
	DomainID   uint32
	TemplateID uint16
}

type TemplateCache struct {
	mu        sync.RWMutex
	templates map[TemplateKey][]TemplateField
	options   map[TemplateKey][]TemplateField
}

func NewTemplateCache() *TemplateCache {
	return &TemplateCache{
		templates: make(map[TemplateKey][]TemplateField),
		options:   make(map[TemplateKey][]TemplateField),
	}
}

func (tc *TemplateCache) SetTemplate(addr netip.Addr, domainID uint32, templateID uint16, fields []TemplateField) {
	if tc == nil {
		return
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.templates[TemplateKey{Addr: addr, DomainID: domainID, TemplateID: templateID}] = fields
}

func (tc *TemplateCache) GetTemplate(addr netip.Addr, domainID uint32, templateID uint16) ([]TemplateField, bool) {
	if tc == nil {
		return nil, false
	}
	tc.mu.RLock()
	defer tc.mu.RUnlock()
	f, ok := tc.templates[TemplateKey{Addr: addr, DomainID: domainID, TemplateID: templateID}]
	return f, ok
}

func (tc *TemplateCache) SetOptions(addr netip.Addr, domainID uint32, templateID uint16, fields []TemplateField) {
	if tc == nil {
		return
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.options[TemplateKey{Addr: addr, DomainID: domainID, TemplateID: templateID}] = fields
}

func (tc *TemplateCache) GetOptions(addr netip.Addr, domainID uint32, templateID uint16) ([]TemplateField, bool) {
	if tc == nil {
		return nil, false
	}
	tc.mu.RLock()
	defer tc.mu.RUnlock()
	f, ok := tc.options[TemplateKey{Addr: addr, DomainID: domainID, TemplateID: templateID}]
	return f, ok
}

var defaultGlobalTemplates = NewTemplateCache()

func readUint(b []byte) uint64 {
	switch len(b) {
	case 0:
		return 0
	case 1:
		return uint64(b[0])
	case 2:
		return uint64(binary.BigEndian.Uint16(b))
	case 3:
		return uint64(b[0])<<16 | uint64(b[1])<<8 | uint64(b[2])
	case 4:
		return uint64(binary.BigEndian.Uint32(b))
	case 8:
		return binary.BigEndian.Uint64(b)
	default:
		var v uint64
		for _, x := range b {
			v = (v << 8) | uint64(x)
		}
		return v
	}
}

func decodeRecord(tmpl []TemplateField, data []byte) (Record, uint32) {
	var rec Record
	var samplingRate uint32
	offset := 0
	for _, f := range tmpl {
		fLen := int(f.Length)
		if offset+fLen > len(data) {
			break
		}
		if f.Enterprise != 0 {
			offset += fLen
			continue
		}
		fb := data[offset : offset+fLen]
		switch f.Type {
		case FieldIPv4SrcAddr:
			if len(fb) >= 4 {
				rec.SrcAddr = ipv4(fb)
			}
		case FieldIPv4DstAddr:
			if len(fb) >= 4 {
				rec.DstAddr = ipv4(fb)
			}
		case FieldIPv4NextHop:
			if len(fb) >= 4 {
				rec.NextHop = ipv4(fb)
			}
		case FieldIPv6SrcAddr:
			if len(fb) >= 16 {
				ip := make(net.IP, 16)
				copy(ip, fb[:16])
				rec.SrcAddr = ip
			}
		case FieldIPv6DstAddr:
			if len(fb) >= 16 {
				ip := make(net.IP, 16)
				copy(ip, fb[:16])
				rec.DstAddr = ip
			}
		case FieldInBytes, FieldOutBytes, FieldTotalBytesExp:
			rec.Bytes = readUint(fb)
		case FieldInPkts, FieldOutPkts, FieldTotalPktsExp:
			rec.Pkts = readUint(fb)
		case FieldL4SrcPort:
			rec.SrcPort = uint16(readUint(fb))
		case FieldL4DstPort:
			rec.DstPort = uint16(readUint(fb))
		case FieldProtocol:
			if len(fb) >= 1 {
				rec.Proto = fb[0]
			}
		case FieldTCPFlags:
			if len(fb) >= 1 {
				rec.TCPFlags = fb[0]
			}
		case FieldSrcTos:
			if len(fb) >= 1 {
				rec.Tos = fb[0]
			}
		case FieldInputSNMP:
			rec.InputIface = uint16(readUint(fb))
		case FieldOutputSNMP:
			rec.OutputIface = uint16(readUint(fb))
		case FieldSrcAS:
			rec.SrcAS = uint16(readUint(fb))
		case FieldDstAS:
			rec.DstAS = uint16(readUint(fb))
		case FieldSrcMask:
			if len(fb) >= 1 {
				rec.SrcMask = fb[0]
			}
		case FieldDstMask:
			if len(fb) >= 1 {
				rec.DstMask = fb[0]
			}
		case FieldFirstSwitched:
			rec.First = uint32(readUint(fb))
		case FieldLastSwitched:
			rec.Last = uint32(readUint(fb))
		case FieldSamplingInterval, FieldSamplerRandomInt, FieldIPFIXSamplingInt:
			rate := uint32(readUint(fb))
			if rate > 0 {
				samplingRate = rate
			}
		}
		offset += fLen
	}
	return rec, samplingRate
}

func decodeOptionsSamplingRate(tmpl []TemplateField, data []byte) uint32 {
	var rate uint32
	offset := 0
	for _, f := range tmpl {
		fLen := int(f.Length)
		if offset+fLen > len(data) {
			break
		}
		fb := data[offset : offset+fLen]
		switch f.Type {
		case FieldSamplingInterval, FieldSamplerRandomInt, FieldIPFIXSamplingInt:
			val := uint32(readUint(fb))
			if val > 0 {
				rate = val
			}
		}
		offset += fLen
	}
	return rate
}

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
	Pkts, Bytes               uint64
	First, Last               uint32
	SrcPort, DstPort          uint16
	TCPFlags                  uint8
	Proto                     uint8
	Tos                       uint8
	SrcAS, DstAS              uint16
	SrcMask, DstMask          uint8
	// RouterID diisi Server dari alamat pengirim; kosong bila tanpa pemeta.
	RouterID string
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
			Pkts:        uint64(be.Uint32(r[16:])),
			Bytes:       uint64(be.Uint32(r[20:])),
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

// ParseV9 mem-parse satu datagram NetFlow v9.
func ParseV9(b []byte) ([]Record, uint32, error) {
	recs, rate, _, err := ParseV9WithCache(netip.Addr{}, b, defaultGlobalTemplates)
	return recs, rate, err
}

// ParseV9WithCache mem-parse datagram NetFlow v9 menggunakan template cache terisolasi.
func ParseV9WithCache(from netip.Addr, b []byte, tc *TemplateCache) ([]Record, uint32, int, error) {
	if tc == nil {
		tc = defaultGlobalTemplates
	}
	if len(b) < HeaderLenV9 {
		return nil, 0, 0, fmt.Errorf("%w: panjang v9 %d < %d", ErrInvalidPacket, len(b), HeaderLenV9)
	}
	be := binary.BigEndian
	version := be.Uint16(b[0:])
	if version != 9 {
		return nil, 0, 0, fmt.Errorf("%w: versi %d bukan 9", ErrInvalidPacket, version)
	}
	sourceID := be.Uint32(b[16:])

	var records []Record
	var samplingRate uint32
	var unknownTemplates int

	pos := HeaderLenV9
	for pos+4 <= len(b) {
		flowSetID := be.Uint16(b[pos:])
		length := int(be.Uint16(b[pos+2:]))
		if length < 4 || pos+length > len(b) {
			return nil, 0, unknownTemplates, fmt.Errorf("%w: flowset terpotong id=%d len=%d", ErrInvalidPacket, flowSetID, length)
		}
		content := b[pos+4 : pos+length]
		pos += length

		switch {
		case flowSetID == 0:
			// Template FlowSet
			tPos := 0
			for tPos+4 <= len(content) {
				tmplID := be.Uint16(content[tPos:])
				fieldCount := int(be.Uint16(content[tPos+2:]))
				tPos += 4
				if tPos+fieldCount*4 > len(content) {
					break
				}
				fields := make([]TemplateField, fieldCount)
				for j := range fieldCount {
					fields[j] = TemplateField{
						Type:   be.Uint16(content[tPos:]),
						Length: be.Uint16(content[tPos+2:]),
					}
					tPos += 4
				}
				tc.SetTemplate(from, sourceID, tmplID, fields)
			}

		case flowSetID == 1:
			// Options Template FlowSet
			tPos := 0
			for tPos+6 <= len(content) {
				tmplID := be.Uint16(content[tPos:])
				scopeLen := int(be.Uint16(content[tPos+2:]))
				optLen := int(be.Uint16(content[tPos+4:]))
				tPos += 6
				totalLen := scopeLen + optLen
				if tPos+totalLen > len(content) {
					break
				}
				numFields := totalLen / 4
				fields := make([]TemplateField, numFields)
				for j := range numFields {
					fields[j] = TemplateField{
						Type:   be.Uint16(content[tPos:]),
						Length: be.Uint16(content[tPos+2:]),
					}
					tPos += 4
				}
				tc.SetOptions(from, sourceID, tmplID, fields)
			}

		case flowSetID >= 256:
			// Data FlowSet
			if tmpl, ok := tc.GetOptions(from, sourceID, flowSetID); ok {
				recLen := 0
				for _, f := range tmpl {
					recLen += int(f.Length)
				}
				if recLen > 0 {
					for dPos := 0; dPos+recLen <= len(content); dPos += recLen {
						rate := decodeOptionsSamplingRate(tmpl, content[dPos:dPos+recLen])
						if rate > 0 {
							samplingRate = rate
						}
					}
				}
			} else if tmpl, ok := tc.GetTemplate(from, sourceID, flowSetID); ok {
				recLen := 0
				for _, f := range tmpl {
					recLen += int(f.Length)
				}
				if recLen > 0 {
					for dPos := 0; dPos+recLen <= len(content); dPos += recLen {
						rec, rate := decodeRecord(tmpl, content[dPos:dPos+recLen])
						if rate > 0 {
							samplingRate = rate
						}
						records = append(records, rec)
					}
				}
			} else {
				unknownTemplates++
			}
		}
	}

	return records, samplingRate, unknownTemplates, nil
}

// ParseIPFIX mem-parse satu datagram IPFIX (NetFlow v10).
func ParseIPFIX(b []byte) ([]Record, uint32, error) {
	recs, rate, _, err := ParseIPFIXWithCache(netip.Addr{}, b, defaultGlobalTemplates)
	return recs, rate, err
}

// ParseIPFIXWithCache mem-parse datagram IPFIX menggunakan template cache terisolasi.
func ParseIPFIXWithCache(from netip.Addr, b []byte, tc *TemplateCache) ([]Record, uint32, int, error) {
	if tc == nil {
		tc = defaultGlobalTemplates
	}
	if len(b) < HeaderLenIPFIX {
		return nil, 0, 0, fmt.Errorf("%w: panjang ipfix %d < %d", ErrInvalidPacket, len(b), HeaderLenIPFIX)
	}
	be := binary.BigEndian
	version := be.Uint16(b[0:])
	if version != 10 {
		return nil, 0, 0, fmt.Errorf("%w: versi %d bukan 10", ErrInvalidPacket, version)
	}
	msgLen := int(be.Uint16(b[2:]))
	if msgLen < HeaderLenIPFIX || msgLen > len(b) {
		return nil, 0, 0, fmt.Errorf("%w: panjang pesan ipfix tidak valid %d", ErrInvalidPacket, msgLen)
	}
	domainID := be.Uint32(b[12:])

	var records []Record
	var samplingRate uint32
	var unknownTemplates int

	pos := HeaderLenIPFIX
	for pos+4 <= msgLen {
		setID := be.Uint16(b[pos:])
		setLength := int(be.Uint16(b[pos+2:]))
		if setLength < 4 || pos+setLength > msgLen {
			return nil, 0, unknownTemplates, fmt.Errorf("%w: ipfix set terpotong id=%d len=%d", ErrInvalidPacket, setID, setLength)
		}
		content := b[pos+4 : pos+setLength]
		pos += setLength

		switch {
		case setID == 2:
			// Template Set
			tPos := 0
			for tPos+4 <= len(content) {
				tmplID := be.Uint16(content[tPos:])
				fieldCount := int(be.Uint16(content[tPos+2:]))
				tPos += 4
				fields := make([]TemplateField, 0, fieldCount)
				for range fieldCount {
					if tPos+4 > len(content) {
						break
					}
					fType := be.Uint16(content[tPos:])
					fLen := be.Uint16(content[tPos+2:])
					tPos += 4
					var enterprise uint32
					if fType&0x8000 != 0 {
						fType = fType & 0x7FFF
						if tPos+4 > len(content) {
							break
						}
						enterprise = be.Uint32(content[tPos:])
						tPos += 4
					}
					fields = append(fields, TemplateField{Type: fType, Length: fLen, Enterprise: enterprise})
				}
				tc.SetTemplate(from, domainID, tmplID, fields)
			}

		case setID == 3:
			// Options Template Set
			tPos := 0
			for tPos+6 <= len(content) {
				tmplID := be.Uint16(content[tPos:])
				fieldCount := int(be.Uint16(content[tPos+2:]))
				scopeFieldCount := int(be.Uint16(content[tPos+4:]))
				_ = scopeFieldCount
				tPos += 6
				fields := make([]TemplateField, 0, fieldCount)
				for range fieldCount {
					if tPos+4 > len(content) {
						break
					}
					fType := be.Uint16(content[tPos:])
					fLen := be.Uint16(content[tPos+2:])
					tPos += 4
					var enterprise uint32
					if fType&0x8000 != 0 {
						fType = fType & 0x7FFF
						if tPos+4 > len(content) {
							break
						}
						enterprise = be.Uint32(content[tPos:])
						tPos += 4
					}
					fields = append(fields, TemplateField{Type: fType, Length: fLen, Enterprise: enterprise})
				}
				tc.SetOptions(from, domainID, tmplID, fields)
			}

		case setID >= 256:
			// Data Set
			if tmpl, ok := tc.GetOptions(from, domainID, setID); ok {
				recLen := 0
				for _, f := range tmpl {
					recLen += int(f.Length)
				}
				if recLen > 0 {
					for dPos := 0; dPos+recLen <= len(content); dPos += recLen {
						rate := decodeOptionsSamplingRate(tmpl, content[dPos:dPos+recLen])
						if rate > 0 {
							samplingRate = rate
						}
					}
				}
			} else if tmpl, ok := tc.GetTemplate(from, domainID, setID); ok {
				recLen := 0
				hasVarlen := false
				for _, f := range tmpl {
					if f.Length == 65535 {
						hasVarlen = true
						break
					}
					recLen += int(f.Length)
				}
				if !hasVarlen && recLen > 0 {
					for dPos := 0; dPos+recLen <= len(content); dPos += recLen {
						rec, rate := decodeRecord(tmpl, content[dPos:dPos+recLen])
						if rate > 0 {
							samplingRate = rate
						}
						records = append(records, rec)
					}
				} else {
					unknownTemplates++
				}
			} else {
				unknownTemplates++
			}
		}
	}

	return records, samplingRate, unknownTemplates, nil
}

func ParsePacket(b []byte) (version uint16, records []Record, samplingRate uint32, err error) {
	v, recs, rate, _, err := ParsePacketWithCache(netip.Addr{}, b, defaultGlobalTemplates)
	return v, recs, rate, err
}

// ParsePacketWithCache mendeteksi versi (v5, v9, v10/IPFIX) secara otomatis dan mem-parse datagram.
func ParsePacketWithCache(from netip.Addr, b []byte, tc *TemplateCache) (version uint16, records []Record, samplingRate uint32, unknownTemplates int, err error) {
	if len(b) < 2 {
		return 0, nil, 0, 0, fmt.Errorf("%w: panjang %d < 2", ErrInvalidPacket, len(b))
	}
	version = binary.BigEndian.Uint16(b[0:2])
	switch version {
	case 5:
		h, recs, err := ParseV5(b)
		if err != nil {
			return 5, nil, 0, 0, err
		}
		rate := uint32(h.SamplingInterval & 0x3FFF)
		if rate == 0 {
			rate = 1
		}
		return 5, recs, rate, 0, nil
	case 9:
		recs, rate, unk, err := ParseV9WithCache(from, b, tc)
		if err != nil {
			return 9, nil, 0, unk, err
		}
		if rate == 0 {
			rate = 1
		}
		return 9, recs, rate, unk, nil
	case 10:
		recs, rate, unk, err := ParseIPFIXWithCache(from, b, tc)
		if err != nil {
			return 10, nil, 0, unk, err
		}
		if rate == 0 {
			rate = 1
		}
		return 10, recs, rate, unk, nil
	default:
		return version, nil, 0, 0, fmt.Errorf("%w: versi %d tidak didukung", ErrInvalidPacket, version)
	}
}
