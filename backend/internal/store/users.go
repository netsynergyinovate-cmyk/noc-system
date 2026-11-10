package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNoRows     = errors.New("user tidak ditemukan")
	ErrUserBanned = errors.New("akun ditangguhkan")
)

// User merepresentasikan data akun pengguna di sistem.
type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UserStore mengelola akses data pengguna menggunakan pool pgx/v5.
type UserStore struct {
	pool *pgxpool.Pool
}

// NewUserStore membuat instance UserStore baru dengan pgxpool.
func NewUserStore(pool *pgxpool.Pool) *UserStore {
	return &UserStore{pool: pool}
}

// GetUserByUsername mencari pengguna berdasarkan email (unik).
func (s *UserStore) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	if s.pool == nil {
		return nil, errors.New("database pool nil")
	}
	email := strings.TrimSpace(username)
	if email == "" {
		return nil, errors.New("username kosong")
	}

	query := `
		SELECT u.id, coalesce(u.name, u.email), u.email, coalesce(a.password, ''), coalesce(u.role, 'user'),
		       coalesce(u.banned, false), u.ban_expires, u.created_at, u.updated_at
		FROM "user" u
		LEFT JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
		WHERE lower(u.email) = lower($1)
		ORDER BY (a.password IS NOT NULL AND a.password != '') DESC, u.created_at ASC
		LIMIT 1
	`
	var (
		u          User
		banned     bool
		banExpires *time.Time
	)
	err := s.pool.QueryRow(ctx, query, email).Scan(
		&u.ID,
		&u.Username,
		&u.Email,
		&u.Password,
		&u.Role,
		&banned,
		&banExpires,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRows
		}
		return nil, fmt.Errorf("query user: %w", err)
	}

	if banned && (banExpires == nil || banExpires.After(time.Now())) {
		return nil, ErrUserBanned
	}

	return &u, nil
}

// GetUserByID mencari pengguna berdasarkan user ID.
func (s *UserStore) GetUserByID(ctx context.Context, id string) (*User, error) {
	if s.pool == nil {
		return nil, errors.New("database pool nil")
	}
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("id user kosong")
	}

	query := `
		SELECT u.id, coalesce(u.name, u.email), u.email, coalesce(a.password, ''), coalesce(u.role, 'user'),
		       coalesce(u.banned, false), u.ban_expires, u.created_at, u.updated_at
		FROM "user" u
		LEFT JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
		WHERE u.id = $1
		LIMIT 1
	`
	var (
		u          User
		banned     bool
		banExpires *time.Time
	)
	err := s.pool.QueryRow(ctx, query, id).Scan(
		&u.ID,
		&u.Username,
		&u.Email,
		&u.Password,
		&u.Role,
		&banned,
		&banExpires,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRows
		}
		return nil, fmt.Errorf("query user by id: %w", err)
	}

	if banned && (banExpires == nil || banExpires.After(time.Now())) {
		return nil, ErrUserBanned
	}

	return &u, nil
}

// CreateUser menyimpan data user dan akun password ke database PostgreSQL.
func (s *UserStore) CreateUser(ctx context.Context, u *User) error {
	if s.pool == nil {
		return errors.New("database pool nil")
	}
	if u == nil {
		return errors.New("user nil")
	}
	if u.ID == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		u.ID = hex.EncodeToString(b)
	}
	if u.Role == "" {
		u.Role = "user"
	}
	if u.Email == "" && strings.Contains(u.Username, "@") {
		u.Email = u.Username
	} else if u.Email == "" {
		u.Email = u.Username + "@noc.local"
	}
	now := time.Now()
	u.CreatedAt = now
	u.UpdatedAt = now

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	insertUser := `
		INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
		VALUES ($1, $2, $3, false, $4, $5, $6)
		ON CONFLICT (email) DO UPDATE SET
			name = EXCLUDED.name,
			role = EXCLUDED.role,
			updated_at = EXCLUDED.updated_at
	`
	if _, err := tx.Exec(ctx, insertUser, u.ID, u.Username, u.Email, u.Role, u.CreatedAt, u.UpdatedAt); err != nil {
		return fmt.Errorf("insert user: %w", err)
	}

	if u.Password != "" {
		accIDBytes := make([]byte, 16)
		_, _ = rand.Read(accIDBytes)
		accID := hex.EncodeToString(accIDBytes)

		insertAcc := `
			INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
			VALUES ($1, $2, 'credential', $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET
				password = EXCLUDED.password,
				updated_at = EXCLUDED.updated_at
		`
		if _, err := tx.Exec(ctx, insertAcc, accID, u.Email, u.ID, u.Password, u.CreatedAt, u.UpdatedAt); err != nil {
			return fmt.Errorf("insert account: %w", err)
		}
	}

	return tx.Commit(ctx)
}
