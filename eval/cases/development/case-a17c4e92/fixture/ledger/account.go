package ledger

import "sync"

type Account struct {
	mu      sync.Mutex
	balance int64
	held    int64
}

func (a Account) Credit(amount int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.balance += amount
}

func (a Account) Reserve(amount int64) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if amount > a.balance-a.held {
		return false
	}
	a.held += amount
	return true
}

func (a *Account) Snapshot() (balance, held int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.balance, a.held
}
