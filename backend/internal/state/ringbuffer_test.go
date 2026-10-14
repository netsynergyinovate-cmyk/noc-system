package state

import (
	"slices"
	"testing"
)

func TestRingBufferKeepsOrderBeforeFull(t *testing.T) {
	r := NewRingBuffer[int](5)
	for i := 1; i <= 3; i++ {
		r.Push(i)
	}
	if got, want := r.Snapshot(), []int{1, 2, 3}; !slices.Equal(got, want) {
		t.Errorf("Snapshot() = %v, want %v", got, want)
	}
	if r.Len() != 3 || r.Cap() != 5 {
		t.Errorf("Len/Cap = %d/%d, want 3/5", r.Len(), r.Cap())
	}
}

func TestRingBufferOverwritesOldestWhenFull(t *testing.T) {
	r := NewRingBuffer[int](3)
	for i := 1; i <= 7; i++ {
		r.Push(i)
	}
	if got, want := r.Snapshot(), []int{5, 6, 7}; !slices.Equal(got, want) {
		t.Errorf("Snapshot() = %v, want %v (tertua dibuang, urutan terjaga)", got, want)
	}
	if r.Len() != 3 {
		t.Errorf("Len() = %d, want 3", r.Len())
	}
	if last, ok := r.Last(); !ok || last != 7 {
		t.Errorf("Last() = %d, %v, want 7, true", last, ok)
	}
	if first, ok := r.At(0); !ok || first != 5 {
		t.Errorf("At(0) = %d, %v, want 5, true", first, ok)
	}
}

func TestRingBufferEmptyAndOutOfRange(t *testing.T) {
	r := NewRingBuffer[int](2)
	if _, ok := r.Last(); ok {
		t.Error("Last() on empty buffer should report false")
	}
	if r.ReplaceLast(1) {
		t.Error("ReplaceLast() on empty buffer should report false")
	}
	if got := r.Snapshot(); len(got) != 0 {
		t.Errorf("Snapshot() = %v, want empty", got)
	}
	r.Push(1)
	for _, i := range []int{-1, 1, 2} {
		if _, ok := r.At(i); ok {
			t.Errorf("At(%d) should be out of range", i)
		}
	}
}

func TestRingBufferReplaceLastKeepsLength(t *testing.T) {
	r := NewRingBuffer[int](3)
	for i := 1; i <= 4; i++ { // setelah wraparound
		r.Push(i)
	}
	if !r.ReplaceLast(99) {
		t.Fatal("ReplaceLast() = false, want true")
	}
	if got, want := r.Snapshot(), []int{2, 3, 99}; !slices.Equal(got, want) {
		t.Errorf("Snapshot() = %v, want %v", got, want)
	}
}

func TestRingBufferSnapshotIsACopy(t *testing.T) {
	r := NewRingBuffer[int](3)
	r.Push(1)
	snap := r.Snapshot()
	snap[0] = 42
	if got, _ := r.At(0); got != 1 {
		t.Errorf("mengubah Snapshot() memengaruhi buffer: At(0) = %d, want 1", got)
	}
}

func TestRingBufferRejectsInvalidCapacity(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("NewRingBuffer(0) should panic")
		}
	}()
	NewRingBuffer[int](0)
}
