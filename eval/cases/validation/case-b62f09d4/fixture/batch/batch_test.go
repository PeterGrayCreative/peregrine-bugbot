package batch

import (
	"testing"
	"time"
)

func TestRunCollectsEveryResult(t *testing.T) {
	done := make(chan []Result, 1)
	go func() {
		done <- Run([]Job{{Value: 2}, {Value: 3}, {Value: 5}})
	}()

	select {
	case results := <-done:
		if len(results) != 3 {
			t.Fatalf("got %d results, want 3", len(results))
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("batch did not complete")
	}
}
