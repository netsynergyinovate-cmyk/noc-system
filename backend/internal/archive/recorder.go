package archive

import (
	"time"

	"noc-isp/backend/internal/state"
)

// Recorder meneruskan sampel traffic ke state.Manager (jalur real-time) dan,
// bila diterima, juga ke arsip. Dipakai sebagai collector.Recorder.
//
// Arsip tidak pernah memengaruhi jalur real-time: bila arsip mati atau
// lambat, Manager tetap menerima sampel dan polling tidak menunggu.
type Recorder struct {
	Next interface {
		RecordTraffic(routerID string, p state.TrafficPoint) (bool, error)
	}
	Writer *Writer
}

// RecordTraffic mencatat sampel ke Next lalu mengantrekannya ke arsip. Sampel
// yang ditolak Next (terlalu tua, router tidak dikenal) tidak diarsipkan.
func (r Recorder) RecordTraffic(routerID string, p state.TrafficPoint) (bool, error) {
	accepted, err := r.Next.RecordTraffic(routerID, p)
	if accepted && err == nil && r.Writer != nil {
		r.Writer.Enqueue(routerID, time.Unix(p.Time, 0), p.RxMbps, p.TxMbps)
	}
	return accepted, err
}
