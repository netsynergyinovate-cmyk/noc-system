// Package archive menyimpan sampel traffic per router per detik ke tabel
// traffic_samples, supaya traffic pada jam insiden masih bisa ditelusuri setelah
// jendela 5 menit di memori lewat.
//
// Jalurnya sengaja terpisah dari pemantauan real-time: Writer.Enqueue tidak
// pernah menunggu database, sampel disimpan berbatch di goroutine sendiri, dan
// bila database mati sampel ditahan (dengan batas) lalu dicoba lagi. Arsip yang
// lambat tidak boleh mengganggu target 1 sampel per detik.
package archive
