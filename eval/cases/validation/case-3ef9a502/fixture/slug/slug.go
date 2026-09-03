package slug

import (
	"strings"
	"unicode"
)

func Normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func Compact(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func Key(value string) string {
	return strings.ReplaceAll(Normalize(Compact(value)), " ", "-")
}

func Segments(value string) []string {
	parts := strings.Split(value, "/")
	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		if normalized := Normalize(part); normalized != "" {
			segments = append(segments, normalized)
		}
	}
	return segments
}

func Valid(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if !unicode.IsLetter(char) && !unicode.IsDigit(char) && char != '-' {
			return false
		}
	}
	return true
}
