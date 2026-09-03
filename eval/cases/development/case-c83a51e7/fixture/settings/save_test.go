package settings

import (
	"bytes"
	"testing"
)

func TestSaveWritesPayload(t *testing.T) {
	var target bytes.Buffer
	if err := Save(&target, []byte("enabled=true")); err != nil {
		t.Fatalf("Save returned an error: %v", err)
	}
	if target.String() != "enabled=true" {
		t.Fatalf("payload = %q", target.String())
	}
}
