package slug

import "testing"

func TestCompact(t *testing.T) {
	tests := []struct {
		name, input, want string
	}{
		{name: "empty", input: "", want: ""},
		{name: "single word", input: "alpha", want: "alpha"},
		{name: "outer spaces", input: "  alpha  ", want: "alpha"},
		{name: "inner spaces", input: "alpha   beta", want: "alpha beta"},
		{name: "mixed whitespace", input: "alpha\t beta\ngamma", want: "alpha beta gamma"},
		{name: "unicode", input: "  café   noir ", want: "café noir"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Compact(test.input); got != test.want {
				t.Fatalf("Compact(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
