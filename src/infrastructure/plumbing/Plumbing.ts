export class Mutex {
	private queue: Promise<void> = Promise.resolve()
	constructor(private readonly name: string = "GenericMutex") {}

	public async acquire(timeoutMs = 30000): Promise<() => void> {
		const previousTask = this.queue
		let resolver: (() => void) | undefined
		this.queue = new Promise<void>((resolve) => {
			resolver = resolve
		})

		const acquirePromise = (async () => {
			await previousTask
		})()

		if (timeoutMs > 0) {
			let timeoutId: NodeJS.Timeout
			const timeoutPromise = new Promise((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(new Error(`Mutex Timeout: ${this.name}`))
				}, timeoutMs)
			})

			try {
				await Promise.race([acquirePromise, timeoutPromise])
			} catch (e) {
				resolver?.()
				throw e
			} finally {
				clearTimeout(timeoutId!)
			}
		} else {
			await acquirePromise
		}

		let released = false
		return () => {
			if (!released) {
				released = true
				resolver?.()
			}
		}
	}
}
