package quota

func Billable(used, included int64) int64 {
	return max(used-included, 0)
}
