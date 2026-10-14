// Package hub adalah WebSocket hub yang menyiarkan kondisi jaringan ke dashboard
// yang sudah login: satu snapshot saat tersambung, lalu satu delta per detik dan
// event anomali. Protokolnya ada di protocol.go.
//
// Alur: collector mengubah state.Manager lalu memanggil Hub.NotifyChange; Hub.Run
// mengubah isi Manager menjadi delta tiap detik. Snapshot dan delta dijamin
// bersambung tanpa celah dan tanpa titik ganda. Klien yang terlalu lambat
// diputus, tidak pernah ditunggu.
package hub
