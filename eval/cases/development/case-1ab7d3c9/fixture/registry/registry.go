package registry

import "sync"

type Registry struct {
	mu     sync.RWMutex
	values map[string]string
}

func New() *Registry {
	return &Registry{values: make(map[string]string)}
}

func (r *Registry) Put(key, value string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.values[key] = value
}

func (r *Registry) Snapshot() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	copy := make(map[string]string, len(r.values))
	for key, value := range r.values {
		copy[key] = value
	}
	return copy
}
