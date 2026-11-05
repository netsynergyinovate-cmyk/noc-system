package state

import (
	"slices"
	"strings"
	"time"
)

// Status tagihan pelanggan. Nilainya sama dengan customers.billing_status dan
// BillingStatus di frontend (src/lib/dashboard/types.ts).
const (
	BillingLunas  = "lunas"
	BillingIsolir = "isolir"
)

// ValidBillingStatus melaporkan apakah s salah satu status tagihan yang dikenal.
func ValidBillingStatus(s string) bool { return s == BillingLunas || s == BillingIsolir }

// BillingChange adalah status tagihan baru satu pelanggan, hasil sinkron billing.
type BillingChange struct {
	CustomerID string
	Status     string
}

// QueuedBilling adalah perubahan status tagihan yang menunggu disiarkan hub.
// Status adalah keadaan TERBARU pelanggan saat diambil, bukan saat diubah, jadi
// dua perubahan berturut-turut pada pelanggan yang sama menjadi satu entri.
type QueuedBilling struct {
	BillingChange
	// Seq adalah nomor urut perubahan terakhir pada pelanggan ini (lihat
	// Snapshot.BillingSeq). Naik satu tiap panggilan SetBillingStatuses yang
	// mengubah sesuatu, mulai dari 1.
	Seq uint64
}

// SetBillingStatuses menyimpan status tagihan baru pelanggan dan menandainya agar
// hub menyiarkannya pada delta berikutnya (lihat DrainBillingChanges). Yang
// dikembalikan hanya perubahan yang BENAR-BENAR mengubah keadaan, menurut urutan
// masukan; kosong bila tidak ada.
//
//   - Pelanggan yang statusnya sudah sama diabaikan dan tidak ditandai, jadi
//     menerapkan perubahan yang sama dua kali tidak menghasilkan perubahan kedua.
//   - ID yang tidak dikenal (belum didaftarkan lewat UpsertCustomer, mis. pelanggan
//     yang baru dibuat setelah Manager dimuat) dan status selain lunas atau isolir
//     diabaikan, tidak pernah panik dan tidak pernah menciptakan pelanggan.
//   - Seluruh masukan diterapkan di bawah SATU kunci: Snapshot melihat semuanya
//     atau tidak satu pun, dan semuanya mendapat nomor urut yang sama.
//
// Dipanggil oleh pendengar Syncer SESUDAH transaksi database ter-commit, jadi
// keadaan di sini tidak pernah mendahului database.
func (m *Manager) SetBillingStatuses(changes []BillingChange) []BillingChange {
	if len(changes) == 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var applied []BillingChange
	seqIncremented := false
	for _, change := range changes {
		customer, ok := m.customers[change.CustomerID]
		if !ok || !ValidBillingStatus(change.Status) || customer.BillingStatus == change.Status {
			continue
		}
		effBefore := customer.EffectiveBillingStatus()
		m.updateLocked(change.CustomerID, func(c *Customer) { c.BillingStatus = change.Status })
		effAfter := customer.EffectiveBillingStatus()
		if effBefore != effAfter {
			if !seqIncremented {
				m.billingSeq++
				seqIncremented = true
			}
			m.billingQueued[change.CustomerID] = m.billingSeq
		}
		applied = append(applied, change)
	}
	return applied
}

// SetIsolirRouter memperbarui status isolir router pelanggan (true = isolir, false = normal).
// Bila status efektif (EffectiveBillingStatus) berubah, perubahan dimasukkan ke antrean siaran hub (billingQueued).
// Mengembalikan jumlah pelanggan yang data isolir routernya berubah.
func (m *Manager) SetIsolirRouter(updates map[string]bool) int {
	if len(updates) == 0 {
		return 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	changed := 0
	seqIncremented := false
	for id, isolated := range updates {
		customer, ok := m.customers[id]
		if !ok {
			continue
		}
		if customer.IsolirRouter != nil && *customer.IsolirRouter == isolated {
			continue
		}
		effBefore := customer.EffectiveBillingStatus()
		isoVal := isolated
		m.updateLocked(id, func(c *Customer) {
			c.IsolirRouter = &isoVal
		})
		effAfter := customer.EffectiveBillingStatus()
		if effBefore != effAfter {
			if !seqIncremented {
				m.billingSeq++
				seqIncremented = true
			}
			m.billingQueued[id] = m.billingSeq
		}
		changed++
	}
	return changed
}

// ClearIsolirRouter menghapus bukti router (IsolirRouter = nil) untuk pelanggan router
// routerID yang TIDAK ada di keep, yaitu yang sesinya sudah hilang: tanpa sesi tidak ada
// bukti, jadi status kembali ke billing. Perubahan status efektif masuk antrean siaran.
// Mengembalikan jumlah pelanggan yang dibersihkan.
func (m *Manager) ClearIsolirRouter(routerID string, keep map[string]bool) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	cleared := 0
	seqIncremented := false
	for id, customer := range m.customers {
		if customer.RouterID != routerID || customer.IsolirRouter == nil {
			continue
		}
		if _, kept := keep[id]; kept {
			continue
		}
		effBefore := customer.EffectiveBillingStatus()
		m.updateLocked(id, func(c *Customer) { c.IsolirRouter = nil })
		if effBefore != customer.EffectiveBillingStatus() {
			if !seqIncremented {
				m.billingSeq++
				seqIncremented = true
			}
			m.billingQueued[id] = m.billingSeq
		}
		cleared++
	}
	return cleared
}

// DrainBillingChanges mengambil perubahan status tagihan yang menunggu disiarkan,
// terurut menurut ID pelanggan, dan mengosongkannya. Dipanggil hub tiap detik
// (satu-satunya pemanggil); perubahan yang sudah diambil tidak diberikan lagi.
//
// limit membatasi jumlah yang diambil (nol atau negatif berarti semuanya). Sisanya
// tetap menunggu dan diambil pada panggilan berikutnya, dalam urutan ID yang sama,
// jadi tidak ada yang hilang dan tidak ada yang terkirim dua kali.
//
// Antrean paling banyak sebesar jumlah pelanggan (satu entri per pelanggan),
// walau tidak ada hub yang mengambilnya.
func (m *Manager) DrainBillingChanges(limit int) []QueuedBilling {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.billingQueued) == 0 {
		return nil
	}
	ids := make([]string, 0, len(m.billingQueued))
	for id := range m.billingQueued {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]QueuedBilling, 0, len(ids))
	for _, id := range ids {
		out = append(out, QueuedBilling{
			BillingChange: BillingChange{CustomerID: id, Status: m.customers[id].EffectiveBillingStatus()},
			Seq:           m.billingQueued[id],
		})
		delete(m.billingQueued, id)
	}
	return out
}

// billingMismatchOfflineAfter adalah lama pelanggan lunas boleh offline sebelum
// dianggap tidak sesuai; offline sebentar itu wajar (restart, gangguan singkat).
const billingMismatchOfflineAfter = 10 * time.Minute

// BillingServiceMismatch adalah pelanggan yang status tagihannya tidak cocok
// dengan keadaan layanannya.
type BillingServiceMismatch struct {
	CustomerID    string `json:"customerId"`
	Name          string `json:"name"`
	PPPoEUsername string `json:"pppoeUsername"`
	RouterID      string `json:"routerId"`
	BillingStatus string `json:"billingStatus"`
	IsOnline      bool   `json:"isOnline"`
	Type          string `json:"type"`   // "isolir_online" atau "lunas_offline"
	Detail        string `json:"detail"` // penjelasan ketidaksesuaian
}

// BillingServiceMismatches mengembalikan pelanggan yang isolir tetapi masih
// online, atau lunas tetapi offline lebih dari 10 menit. Terurut menurut ID
// pelanggan; tidak pernah nil.
func (m *Manager) BillingServiceMismatches() []BillingServiceMismatch {
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := m.now()
	out := []BillingServiceMismatch{}
	for _, c := range m.customers {
		var kind, detail string
		switch {
		case c.BillingStatus == BillingIsolir && c.IsOnline:
			kind, detail = "isolir_online", "Pelanggan berstatus isolir tetapi koneksi jaringan masih online"
		case c.BillingStatus == BillingLunas && !c.IsOnline && !c.StatusSince.IsZero() &&
			now.Sub(c.StatusSince) > billingMismatchOfflineAfter:
			kind, detail = "lunas_offline", "Pelanggan berstatus lunas tetapi koneksi jaringan offline berkepanjangan"
		default:
			continue
		}
		out = append(out, BillingServiceMismatch{
			CustomerID: c.ID, Name: c.Name, PPPoEUsername: c.PPPoEUsername, RouterID: c.RouterID,
			BillingStatus: c.BillingStatus, IsOnline: c.IsOnline, Type: kind, Detail: detail,
		})
	}
	slices.SortFunc(out, func(a, b BillingServiceMismatch) int { return strings.Compare(a.CustomerID, b.CustomerID) })
	return out
}
