package slug

import "testing"

func TestKey(t *testing.T) {
	tests := []struct {
		name, input, want string
	}{
		{name: "empty", input: "", want: ""},
		{name: "one word", input: "ALPHA", want: "alpha"},
		{name: "two words", input: "Alpha Beta", want: "alpha-beta"},
		{name: "extra spacing", input: "  Alpha   Beta  ", want: "alpha-beta"},
		{name: "existing hyphen", input: "Alpha-Beta", want: "alpha-beta"},
		{name: "unicode", input: "CAFÉ NOIR", want: "café-noir"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Key(test.input); got != test.want {
				t.Fatalf("Key(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
