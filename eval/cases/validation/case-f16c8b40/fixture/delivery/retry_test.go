package delivery

import (
	"errors"
	"testing"
)

func TestDeliverHonorsAttemptLimit(t *testing.T) {
	failure := errors.New("unavailable")
	calls := 0
	attempts, err := Deliver(3, func() error {
		calls++
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatalf("error = %v", err)
	}
	if attempts != 3 || calls != 3 {
		t.Fatalf("attempts = %d, calls = %d; want 3 and 3", attempts, calls)
	}
}
