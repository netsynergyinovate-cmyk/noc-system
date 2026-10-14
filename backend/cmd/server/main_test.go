package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func listenLocal(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return listener
}

func TestServeFinishesInFlightRequestOnShutdown(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "selesai")
	})}
	listener := listenLocal(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- serve(ctx, srv, listener, 5*time.Second) }()

	body := make(chan string, 1)
	go func() {
		resp, err := http.Get("http://" + listener.Addr().String())
		if err != nil {
			body <- "error: " + err.Error()
			return
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		body <- string(data)
	}()

	<-started
	cancel() // minta berhenti saat permintaan masih berjalan

	select {
	case err := <-done:
		t.Fatalf("serve selesai sebelum permintaan berjalan tuntas (err = %v)", err)
	case <-time.After(150 * time.Millisecond):
	}

	close(release)
	if got := <-body; got != "selesai" {
		t.Errorf("respons = %q, want %q", got, "selesai")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve error = %v, want nil", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve tidak kembali setelah permintaan selesai")
	}
}

func TestServeGivesUpWhenGraceExpires(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
	})}
	defer srv.Close()
	defer close(release)
	listener := listenLocal(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- serve(ctx, srv, listener, 50*time.Millisecond) }()
	go func() {
		if resp, err := http.Get("http://" + listener.Addr().String()); err == nil {
			resp.Body.Close()
		}
	}()

	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("serve error = %v, want context.DeadlineExceeded", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve tidak menyerah setelah masa tunggu habis")
	}
}

func TestServeReturnsListenerFailure(t *testing.T) {
	listener := listenLocal(t)
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}
	err := serve(context.Background(), &http.Server{}, listener, time.Second)
	if err == nil {
		t.Fatal("serve error = nil, want error for closed listener")
	}
}

// Database yang belum menyala tidak boleh menghalangi backend naik: pool
// dibuat tanpa langsung terhubung, dan kegagalan baru terasa saat query.
func TestOpenArchivePoolDoesNotConnectUntilNeeded(t *testing.T) {
	started := time.Now()
	pool, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@127.0.0.1:1/noc?connect_timeout=1")
	if err != nil {
		t.Fatalf("openArchivePool = %v; database mati tidak boleh menggagalkan startup", err)
	}
	defer pool.Close()
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("membuka pool memakan %s; seharusnya tidak menunggu koneksi", elapsed)
	}
	if got := pool.Config().MaxConns; got != archiveMaxConns {
		t.Errorf("MaxConns = %d, want %d", got, archiveMaxConns)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err == nil {
		t.Error("Ping ke database mati seharusnya gagal")
	}
}

func TestOpenArchivePoolErrorDoesNotLeakThePassword(t *testing.T) {
	_, err := openArchivePool(context.Background(), "postgres://noc:rahasia-sekali@local host:abc/noc")
	if err == nil {
		t.Fatal("URL yang rusak seharusnya ditolak")
	}
	if strings.Contains(err.Error(), "rahasia-sekali") {
		t.Errorf("error membocorkan kata sandi: %v", err)
	}
}
