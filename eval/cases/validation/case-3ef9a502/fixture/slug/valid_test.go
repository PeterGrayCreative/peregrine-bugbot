package slug

import "testing"

func TestValid(t *testing.T) {
	tests := []struct {
		name, input string
		want        bool
	}{
		{name: "empty", input: "", want: false},
		{name: "letters", input: "alpha", want: true},
		{name: "digits", input: "2026", want: true},
		{name: "hyphen", input: "alpha-2", want: true},
		{name: "unicode", input: "café", want: true},
		{name: "space", input: "alpha beta", want: false},
		{name: "underscore", input: "alpha_beta", want: false},
		{name: "slash", input: "alpha/beta", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Valid(test.input); got != test.want {
				t.Fatalf("Valid(%q) = %t, want %t", test.input, got, test.want)
			}
		})
	}
}
