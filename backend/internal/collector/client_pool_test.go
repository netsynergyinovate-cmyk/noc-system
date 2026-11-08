package collector

import "testing"

func TestClientPoolReusesOneClientPerRouter(t *testing.T) {
	pool := NewClientPool()
	target := Target{
		RouterID: "r1",
		BaseURL:  "https://10.0.0.1",
		Protocol: "rest",
		Username: "noc-api",
		Password: "rahasia",
	}

	first, err := pool.Get(target, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := pool.Get(target, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("target yang sama harus memakai client yang sama (satu login)")
	}

	changed := target
	changed.Password = "kata-sandi-baru"
	third, err := pool.Get(changed, nil)
	if err != nil {
		t.Fatal(err)
	}
	if third == first {
		t.Fatal("kredensial berubah harus membuat client baru")
	}

	pool.Drop("r1")
	fourth, err := pool.Get(target, nil)
	if err != nil {
		t.Fatal(err)
	}
	if fourth == third {
		t.Fatal("Drop harus membuang client lama")
	}
}
