package olt

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// Firmware HSGQ yang berbeda (dan simulator di sisi Next.js) memakai bentuk JSON
// berbeda: daftar langsung atau dibungkus {"ports": [...]}, camelCase
// (ponIndex, rxPowerDbm) atau snake_case (pon_index, rx_power). Pembaca di sini
// menerima keduanya, supaya driver tidak bergantung pada satu tebakan format.
// Nilai yang tidak ada atau null dibaca sebagai "tidak terbaca" (nil), bukan 0.

type jsonObj map[string]json.RawMessage

// decodeObjects membaca daftar objek dari akar array atau dari salah satu
// kunci pembungkus (mis. "ports", "data").
func decodeObjects(b []byte, wrappers ...string) ([]jsonObj, error) {
	b = bytes.TrimSpace(b)
	if len(b) == 0 {
		return nil, fmt.Errorf("jawaban kosong")
	}
	var list []jsonObj
	if b[0] == '[' {
		if err := json.Unmarshal(b, &list); err != nil {
			return nil, err
		}
		return list, nil
	}
	var root jsonObj
	if err := json.Unmarshal(b, &root); err != nil {
		return nil, err
	}
	for _, w := range wrappers {
		raw, ok := root[w]
		if !ok {
			continue
		}
		if err := json.Unmarshal(raw, &list); err != nil {
			return nil, fmt.Errorf("kunci %q bukan daftar objek: %w", w, err)
		}
		return list, nil
	}
	return nil, fmt.Errorf("tidak ada daftar di kunci %s", strings.Join(wrappers, " atau "))
}

func (o jsonObj) float(keys ...string) *float64 {
	for _, k := range keys {
		raw, ok := o[k]
		if !ok || string(raw) == "null" {
			continue
		}
		var v float64
		if err := json.Unmarshal(raw, &v); err == nil {
			return &v
		}
		var s string // sebagian firmware mengirim angka sebagai teks
		if err := json.Unmarshal(raw, &s); err == nil {
			var n float64
			if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &n); err == nil {
				return &n
			}
		}
	}
	return nil
}

func (o jsonObj) integer(keys ...string) (int, bool) {
	if v := o.float(keys...); v != nil {
		return int(*v), true
	}
	return 0, false
}

func (o jsonObj) text(keys ...string) string {
	for _, k := range keys {
		raw, ok := o[k]
		if !ok {
			continue
		}
		var s string
		if err := json.Unmarshal(raw, &s); err == nil && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// normalizeState memetakan teks status OLT ke online, offline, atau los.
func normalizeState(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "online", "up", "working", "ok":
		return "online"
	case "los", "dying-gasp", "dyinggasp", "loss":
		return "los"
	default:
		return "offline"
	}
}
