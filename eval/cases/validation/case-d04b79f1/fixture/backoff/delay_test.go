package backoff

import (
	"testing"
	"time"
)

func TestDelay(t *testing.T) {
	cases := []struct {
		name    string
		attempt int
		want    time.Duration
	}{
		{name: "later attempt", attempt: 3, want: 9 * time.Second},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Delay(tc.attempt); got != tc.want {
				t.Fatalf("Delay(%d) = %s, want %s", tc.attempt, got, tc.want)
			}
		})
	}
}
