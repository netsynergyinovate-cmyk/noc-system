package routerproxy

import (
	"strings"
	"testing"
)

func TestRestSegmentsOnlyAllowsReadPaths(t *testing.T) {
	ok := map[string][]string{
		"/rest/system/resource": {"system", "resource"},
		"rest/queue/simple":     {"queue", "simple"},
	}
	for path, want := range ok {
		got, err := restSegments(path)
		if err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		if strings.Join(got, "/") != strings.Join(want, "/") {
			t.Errorf("%s: got %v want %v", path, got, want)
		}
	}
	for _, path := range []string{"", "/system/resource", "/rest/system/resource/../user", "/rest//queue", "/rest/queue simple", "/rest/queue?x=1"} {
		if _, err := restSegments(path); err == nil {
			t.Errorf("%q harus ditolak", path)
		}
	}
}

func TestValidateMeasureAllowlist(t *testing.T) {
	for _, path := range []string{"/rest/tool/ping", "rest/tool/traceroute", "/rest/interface/ethernet/monitor"} {
		if err := validateMeasure(path); err != nil {
			t.Errorf("%q harus diizinkan: %v", path, err)
		}
	}
	for _, path := range []string{"/rest/user/add", "/rest/system/reboot", "/rest/tool/torch", ""} {
		if err := validateMeasure(path); err == nil {
			t.Errorf("%q harus ditolak", path)
		}
	}
}
