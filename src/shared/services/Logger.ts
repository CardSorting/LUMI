/**
 * Simple Logger utility for the extension's backend code.
 */
export class Logger {
	private constructor() {}
	private static isVerbose = process.env.IS_DEV === "true"

	static setVerbose(verbose: boolean) {
		Logger.isVerbose = verbose
	}

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static output(msg: string): void {
		for (const subscriber of Logger.subscribers) {
			try {
				subscriber(msg)
			} catch {
				// ignore errors from subscribers
			}
		}
	}

	/**
	 * Register a callback to receive log output messages.
	 */
	static subscribe(outputFn: (msg: string) => void) {
		Logger.subscribers.add(outputFn)
	}

	static error(message: string, ...args: unknown[]) {
		Logger.#output("ERROR", message, undefined, args)
	}

	static warn(message: string, ...args: unknown[]) {
		Logger.#output("WARN", message, undefined, args)
	}

	static log(message: string, ...args: unknown[]) {
		Logger.#output("LOG", message, undefined, args)
	}

	static debug(message: string, ...args: unknown[]) {
		Logger.#output("DEBUG", message, undefined, args)
	}

	static info(message: string, ...args: unknown[]) {
		Logger.#output("INFO", message, undefined, args)
	}

	static trace(message: string, ...args: unknown[]) {
		Logger.#output("TRACE", message, undefined, args)
	}

	static #output(level: string, message: string, error: Error | undefined, args: unknown[]) {
		try {
			const { SensitiveDataMasker } = require("../utils/SensitiveDataMasker")
			let fullMessage = message
			if (Logger.isVerbose && args.length > 0) {
				fullMessage += ` ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
			}
			const errorSuffix = error?.message ? ` ${error.message}` : ""
			const sanitizedOutput = SensitiveDataMasker.mask(`${level} ${fullMessage}${errorSuffix}`.trimEnd())
			Logger.output(sanitizedOutput)
		} catch {
			// do nothing if Logger fails
		}
	}
}
