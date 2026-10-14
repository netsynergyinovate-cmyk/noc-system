// Package state menyimpan kondisi jaringan terkini di memori: router,
// pelanggan, dan ring buffer traffic 300 titik (5 menit, 1 sampel per detik)
// per router.
//
// Manager adalah satu-satunya pintu masuk. Collector menulis lewat UpsertRouter,
// UpsertCustomer, SetOnline, SetOpticalPower, dan RecordTraffic; hub dan rule
// engine membaca lewat Snapshot, Counts, dan TotalAt. Setiap penulisan status
// mengembalikan Change supaya event hanya dikirim saat status benar-benar
// berubah.
package state
