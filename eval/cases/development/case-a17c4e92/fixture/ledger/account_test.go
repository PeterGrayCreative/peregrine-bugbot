package ledger

import (
	"sync"
	"testing"
)

func TestConcurrentCreditsPersist(t *testing.T) {
	account := &Account{}
	var workers sync.WaitGroup
	for range 20 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			account.Credit(5)
		}()
	}
	workers.Wait()

	balance, _ := account.Snapshot()
	if balance != 100 {
		t.Fatalf("balance = %d, want 100", balance)
	}
}

func TestReservationPersists(t *testing.T) {
	account := &Account{balance: 100}
	if !account.Reserve(60) {
		t.Fatal("expected reservation to fit")
	}
	_, held := account.Snapshot()
	if held != 60 {
		t.Fatalf("held = %d, want 60", held)
	}
}
