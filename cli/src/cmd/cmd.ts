import type { CommandModule } from "yargs"

type WithDoubleDash<T> = T & { "--"?: string[] }

/**
 * Helper to define a modular yargs command.
 * Strictly mirrors the opencode style.
 */
export function cmd<T, U>(input: CommandModule<T, WithDoubleDash<U>>) {
	return input
}
