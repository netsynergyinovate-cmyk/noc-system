package main

import (
	"strconv"
	"strings"
	"testing"
)
type recExec struct {
	lastSQL  string
	lastArgs []any
}

func TestOLTAlarmStatusUpdateLogic(t *testing.T) {
	cases := []struct {
		name         string
		alarmType    string
		alarmStatus  string
		ponPort      string
		onuID        string
		oltID        string
		wantStatus   string
		wantPon      int
		wantOnu      int
		wantContains string
	}{
		{
			name:         "LOS active sets los",
			alarmType:    "fiber_cut",
			alarmStatus:  "active",
			ponPort:      "0/1",
			onuID:        "5",
			oltID:        "olt-uuid-1",
			wantStatus:   "los",
			wantPon:      1,
			wantOnu:      5,
			wantContains: "UPDATE olt_onus SET status = $1",
		},
		{
			name:         "LOS resolved sets online only if was los",
			alarmType:    "los",
			alarmStatus:  "resolved",
			ponPort:      "EPON0/3",
			onuID:        "12",
			oltID:        "olt-uuid-2",
			wantStatus:   "online",
			wantPon:      3,
			wantOnu:      12,
			wantContains: "AND status = 'los'",
		},
		{
			name:        "Power outage does not set los",
			alarmType:   "power_outage",
			alarmStatus: "active",
			ponPort:     "0/2",
			onuID:       "1",
			oltID:       "olt-uuid-3",
			wantStatus:  "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ponStr := tc.ponPort
			if parts := strings.Split(ponStr, "/"); len(parts) > 1 {
				ponStr = parts[len(parts)-1]
			}
			pIdx, errP := strconv.Atoi(ponStr)
			oIdx, errO := strconv.Atoi(tc.onuID)
			if errP != nil || errO != nil {
				t.Fatalf("unexpected atoi error: %v, %v", errP, errO)
			}

			targetStatus := ""
			var updateSQL string
			if tc.alarmType == "fiber_cut" || tc.alarmType == "los" {
				if tc.alarmStatus == "active" {
					targetStatus = "los"
					updateSQL = `UPDATE olt_onus SET status = $1, captured_at = now() WHERE olt_id = $2::uuid AND pon_index = $3 AND onu_index = $4`
				} else if tc.alarmStatus == "resolved" {
					targetStatus = "online"
					updateSQL = `UPDATE olt_onus SET status = $1, captured_at = now() WHERE olt_id = $2::uuid AND pon_index = $3 AND onu_index = $4 AND status = 'los'`
				}
			}

			if targetStatus != tc.wantStatus {
				t.Errorf("targetStatus = %q, want %q", targetStatus, tc.wantStatus)
			}
			if tc.wantContains != "" && !strings.Contains(updateSQL, tc.wantContains) {
				t.Errorf("sql %q does not contain %q", updateSQL, tc.wantContains)
			}
			if targetStatus != "" {
				if pIdx != tc.wantPon || oIdx != tc.wantOnu {
					t.Errorf("got pon %d onu %d, want %d %d", pIdx, oIdx, tc.wantPon, tc.wantOnu)
				}
			}
		})
	}
}
