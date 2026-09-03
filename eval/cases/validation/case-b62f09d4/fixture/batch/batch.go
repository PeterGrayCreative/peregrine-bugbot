package batch

import "sync"

type Job struct{ Value int }
type Result struct{ Value int }

func Run(jobs []Job) []Result {
	results := make(chan Result, 1)
	var workers sync.WaitGroup
	for _, job := range jobs {
		workers.Add(1)
		go func(job Job) {
			defer workers.Done()
			results <- Result{Value: job.Value * 2}
		}(job)
	}
	workers.Wait()
	close(results)

	output := make([]Result, 0, len(jobs))
	for result := range results {
		output = append(output, result)
	}
	return output
}
