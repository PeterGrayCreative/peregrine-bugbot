package checkout

import "testing"

func TestTotalAddsShippingAfterDiscount(t *testing.T) {
	if got := Total(10_000, 1_500, 700); got != 9_200 {
		t.Fatalf("Total() = %d, want 9200", got)
	}
}
