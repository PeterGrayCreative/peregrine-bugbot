package slug

import (
	"reflect"
	"testing"
)

func TestSegments(t *testing.T) {
	tests := []struct {
		name, input string
		want        []string
	}{
		{name: "empty", input: "", want: []string{}},
		{name: "root", input: "/", want: []string{}},
		{name: "one", input: "Alpha", want: []string{"alpha"}},
		{name: "nested", input: "Alpha/Beta", want: []string{"alpha", "beta"}},
		{name: "outer slashes", input: "/Alpha/Beta/", want: []string{"alpha", "beta"}},
		{name: "empty middle", input: "Alpha//Beta", want: []string{"alpha", "beta"}},
		{name: "spaced", input: " Alpha / Beta ", want: []string{"alpha", "beta"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Segments(test.input); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("Segments(%q) = %#v, want %#v", test.input, got, test.want)
			}
		})
	}
}
