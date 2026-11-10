package store

import (
	"context"
	"testing"
)

func TestUserStoreNilPool(t *testing.T) {
	s := NewUserStore(nil)
	if _, err := s.GetUserByUsername(context.Background(), "admin"); err == nil {
		t.Fatal("expected error with nil pool")
	}
	if _, err := s.GetUserByID(context.Background(), "user-1"); err == nil {
		t.Fatal("expected error with nil pool")
	}
	if err := s.CreateUser(context.Background(), &User{Username: "admin"}); err == nil {
		t.Fatal("expected error with nil pool")
	}
}

func TestUserStoreValidation(t *testing.T) {
	s := NewUserStore(nil)
	if _, err := s.GetUserByUsername(context.Background(), ""); err == nil {
		t.Fatal("expected error with empty username")
	}
	if _, err := s.GetUserByID(context.Background(), ""); err == nil {
		t.Fatal("expected error with empty id")
	}
	if err := s.CreateUser(context.Background(), nil); err == nil {
		t.Fatal("expected error with nil user")
	}
}
