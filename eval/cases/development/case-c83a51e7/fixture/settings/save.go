package settings

import "io"

func Save(writer io.Writer, payload []byte) error {
	_, err := writer.Write(payload)
	return err
}
