package checkout

func Total(subtotal, discount, shipping int64) int64 {
	return subtotal - (discount + shipping)
}
