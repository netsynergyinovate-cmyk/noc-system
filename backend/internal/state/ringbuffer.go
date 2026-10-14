package state

// RingBuffer menyimpan paling banyak `capacity` elemen terbaru. Saat penuh,
// Push menimpa elemen tertua, jadi memori tidak pernah bertambah.
//
// RingBuffer tidak aman dipakai dari banyak goroutine sekaligus; Manager yang
// mengunci akses ke dalamnya.
type RingBuffer[T any] struct {
	buf   []T
	start int // indeks elemen tertua
	size  int
}

// NewRingBuffer membuat buffer dengan kapasitas tetap. Kapasitas harus > 0.
func NewRingBuffer[T any](capacity int) *RingBuffer[T] {
	if capacity <= 0 {
		panic("state: kapasitas ring buffer harus lebih dari 0")
	}
	return &RingBuffer[T]{buf: make([]T, capacity)}
}

// Len adalah jumlah elemen yang tersimpan sekarang.
func (r *RingBuffer[T]) Len() int { return r.size }

// Cap adalah jumlah elemen maksimum.
func (r *RingBuffer[T]) Cap() int { return len(r.buf) }

// Push menambah elemen paling baru dan membuang yang tertua bila penuh.
func (r *RingBuffer[T]) Push(v T) {
	if r.size < len(r.buf) {
		r.buf[(r.start+r.size)%len(r.buf)] = v
		r.size++
		return
	}
	r.buf[r.start] = v
	r.start = (r.start + 1) % len(r.buf)
}

// At mengembalikan elemen ke-i dengan 0 sebagai yang tertua. Indeks di luar
// jangkauan mengembalikan false.
func (r *RingBuffer[T]) At(i int) (T, bool) {
	if i < 0 || i >= r.size {
		var zero T
		return zero, false
	}
	return r.buf[(r.start+i)%len(r.buf)], true
}

// Last mengembalikan elemen terbaru.
func (r *RingBuffer[T]) Last() (T, bool) { return r.At(r.size - 1) }

// ReplaceLast mengganti elemen terbaru tanpa menambah jumlah elemen. Mengembalikan
// false bila buffer kosong.
func (r *RingBuffer[T]) ReplaceLast(v T) bool {
	if r.size == 0 {
		return false
	}
	r.buf[(r.start+r.size-1)%len(r.buf)] = v
	return true
}

// Each memanggil fn untuk tiap elemen dari yang tertua ke terbaru, tanpa
// menyalin isi buffer.
func (r *RingBuffer[T]) Each(fn func(T)) {
	for i := 0; i < r.size; i++ {
		fn(r.buf[(r.start+i)%len(r.buf)])
	}
}

// Snapshot menyalin isi buffer, tertua lebih dulu. Hasilnya milik pemanggil.
func (r *RingBuffer[T]) Snapshot() []T {
	out := make([]T, 0, r.size)
	r.Each(func(v T) { out = append(out, v) })
	return out
}
