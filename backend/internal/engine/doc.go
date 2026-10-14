// Package engine adalah rule engine. Aturan (Rule) menyatakan kondisi yang
// sedang benar; Engine membandingkannya dengan evaluasi sebelumnya dan hanya
// mengeluarkan Event saat sebuah gangguan mulai atau selesai, bukan tiap detik
// selama gangguan berlangsung.
//
// Sebuah kondisi punya syarat durasi (Condition.For): gangguan baru dianggap
// ada setelah kondisinya terus benar selama itu, sehingga lonjakan sesaat tidak
// membunyikan alert. Aturan bawaan baru OfflineRule; aturan traffic, CPU,
// sinyal optik, dan port error ditambahkan sebagai Rule baru tanpa mengubah
// Engine.
package engine
