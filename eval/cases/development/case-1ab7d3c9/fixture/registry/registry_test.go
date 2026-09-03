package registry

import (
	"fmt"
	"sync"
	"testing"
)

func TestSnapshotDuringWrites(t *testing.T) {
	registry := New()
	var workers sync.WaitGroup
	for index := range 20 {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			registry.Put(fmt.Sprint(index), "ready")
			_ = registry.Snapshot()
		}(index)
	}
	workers.Wait()
	if got := len(registry.Snapshot()); got != 20 {
		t.Fatalf("snapshot contains %d values, want 20", got)
	}
}
