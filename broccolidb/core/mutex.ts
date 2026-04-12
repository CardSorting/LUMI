export class TaskMutex {
  private static locks = new Map<string, Promise<void>>();

  /**
   * Acquires a lock for a specific key and executes the provided function exclusively.
   * Includes timeout protection to prevent deadlocks.
   */
  static async runExclusive<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs: number = 60000
  ): Promise<T> {
    const previous = TaskMutex.locks.get(key) || Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    TaskMutex.locks.set(
      key,
      previous.then(() => current)
    );

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error(`[TaskMutex] Lock acquisition timeout for ${key} after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    try {
      // Wait for previous OR timeout
      await Promise.race([previous, timeout]);
      return await fn();
    } finally {
      if (TaskMutex.locks.get(key) === current) {
        TaskMutex.locks.delete(key);
      }
      release?.();
    }
  }
}
