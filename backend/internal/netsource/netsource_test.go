package netsource

import "testing"

// Server di belakang router yang sama keluar ke internet dengan IP publik router
// itu sendiri; menyarankan IP itu untuk allow-list router tidak pernah benar.
func TestUsablePublicRejectsRouterOwnAddress(t *testing.T) {
	if usablePublic("103.167.70.136", "103.167.70.136") {
		t.Fatal("IP publik = IP router harus ditolak")
	}
	if usablePublic("", "103.167.70.136") {
		t.Fatal("IP publik kosong harus ditolak")
	}
	if !usablePublic("203.0.113.5", "103.167.70.136") {
		t.Fatal("IP publik lain harus dipakai")
	}
}
