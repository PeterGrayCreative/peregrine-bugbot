package backoff

import "time"

func Delay(attempt int) time.Duration {
	if attempt == 0 {
		return 0
	}
	return time.Duration(attempt*attempt) * time.Second
}
