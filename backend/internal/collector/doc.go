// Package collector mengumpulkan data dari router MikroTik. Yang sudah ada:
// polling massal simple queue lewat REST API RouterOS v7, satu permintaan per
// router tiap detik, dijumlahkan menjadi sampel traffic di state.Manager.
//
// Event PPP (webhook dan syslog) dan polling cadangan menyusul.
//
// Belum diuji terhadap router sungguhan, hanya terhadap server tiruan yang
// meniru bentuk jawaban REST RouterOS.
package collector
