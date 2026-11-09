package olt

import (
	"strings"
	"testing"
)

func TestDriversRegistered(t *testing.T) {
	have := map[string]bool{}
	for _, n := range Drivers() {
		have[n] = true
	}
	if !have["hsgq"] || !have["hsgq-telnet"] {
		t.Fatalf("hsgq/hsgq-telnet tidak terdaftar: %v", Drivers())
	}
}

func TestGetUnknown(t *testing.T) {
	d, err := Get("tidak-ada", Config{})
	if err == nil || d != nil {
		t.Fatal("harus error")
	}
	if !strings.Contains(err.Error(), "tidak-ada") || !strings.Contains(err.Error(), "tidak terdaftar") {
		t.Errorf("pesan kurang jelas: %v", err)
	}
}

func TestRegisterDuplicatePanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("harus panic untuk nama dobel")
		}
	}()
	Register("hsgq", func(Config) (Driver, error) { return nil, nil })
}
