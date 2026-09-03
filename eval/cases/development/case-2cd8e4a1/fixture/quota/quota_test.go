package quota

import "testing"

func TestBillable(t *testing.T) {
	for _, tc := range []struct {
		used, included, want int64
	}{
		{used: 140, included: 100, want: 40},
		{used: 80, included: 100, want: 0},
		{used: 100, included: 100, want: 0},
	} {
		if got := Billable(tc.used, tc.included); got != tc.want {
			t.Fatalf("Billable(%d, %d) = %d, want %d", tc.used, tc.included, got, tc.want)
		}
	}
}
