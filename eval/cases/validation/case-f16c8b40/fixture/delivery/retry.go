package delivery

type Sender func() error

func Deliver(maxAttempts int, send Sender) (int, error) {
	var err error
	for attempt := 0; attempt <= maxAttempts; attempt++ {
		err = send()
		if err == nil {
			return attempt + 1, nil
		}
	}
	return maxAttempts + 1, err
}
