package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"noc-isp/backend/internal/routerproxy"
)

func main() {
	dataEnv, _ := os.ReadFile("../.env.local")
	for _, line := range strings.Split(string(dataEnv), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) == 2 {
			os.Setenv(parts[0], strings.Trim(parts[1], `"'`))
		}
	}

	pool, _ := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	defer pool.Close()

	var id string
	_ = pool.QueryRow(context.Background(), "SELECT id::text FROM routers WHERE status = 'aktif' LIMIT 1").Scan(&id)
	proxy := routerproxy.New(pool, os.Getenv("DEVICE_SECRET"), nil)

	ctx := context.Background()
	natData, _ := proxy.Read(ctx, id, "/rest/ip/firewall/nat", url.Values{})
	var nats []map[string]any
	_ = json.Unmarshal(natData, &nats)
	for _, n := range nats {
		comment, _ := n["comment"].(string)
		if strings.Contains(strings.ToLower(comment), "acs") {
			fmt.Printf("NAT noc-acs: packets=%s bytes=%s to-addr=%s to-port=%s\n",
				n["packets"], n["bytes"], n["to-addresses"], n["to-ports"])
		}
	}
}
