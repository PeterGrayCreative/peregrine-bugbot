export interface CountTask {
  taskId: string;
  warehouseId: string;
  sku: string;
  priority: number;
  dueAt: string;
  assignedTo: string | null;
  status: "pending" | "assigned" | "completed";
}

export function scheduleCountTasks(
  warehouseId: string,
  skus: string[],
  dueAt: string,
  priorityFor: (sku: string) => number,
): CountTask[] {
  if (!Number.isFinite(Date.parse(dueAt))) throw new Error("invalid count due date");
  const unique = [...new Set(skus)];
  return unique.map((sku, index) => ({
    taskId: `${warehouseId}-${index + 1}`,
    warehouseId,
    sku,
    priority: priorityFor(sku),
    dueAt,
    assignedTo: null,
    status: "pending" as const,
  })).sort((left, right) => right.priority - left.priority || left.sku.localeCompare(right.sku));
}

export function assignCountTask(task: CountTask, assignee: string): CountTask {
  if (task.status !== "pending") throw new Error("only pending tasks can be assigned");
  if (!assignee.trim()) throw new Error("assignee is required");
  return { ...task, assignedTo: assignee, status: "assigned" };
}

export function completeCountTask(task: CountTask): CountTask {
  if (task.status !== "assigned" || task.assignedTo === null) throw new Error("task must be assigned");
  return { ...task, status: "completed" };
}

export function overdueCountTasks(tasks: CountTask[], nowMs: number): CountTask[] {
  return tasks
    .filter((task) => task.status !== "completed" && Date.parse(task.dueAt) < nowMs)
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

export function countTaskProgress(tasks: CountTask[]): { completed: number; total: number } {
  return { completed: tasks.filter((task) => task.status === "completed").length, total: tasks.length };
}
