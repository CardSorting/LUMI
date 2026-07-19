import path from "node:path"

let vscode: typeof import("vscode") | undefined
try {
	vscode = require("vscode")
} catch {
	// Not in VS Code environment (e.g. tests)
}

export interface CommandValidationResult {
	error?: string
	valid: boolean
}

const COMMAND_SEPARATORS = new Set(["\n", "\r", ";"])
const INTERACTIVE_EDITORS = new Set(["emacs", "joe", "micro", "nano", "nano-tiny", "neovim", "nvim", "vi", "vim"])
const INTERACTIVE_REPLS = new Set(["irb", "node", "perl", "php", "python", "python2", "python3", "ruby"])
const SHELLS = new Set(["bash", "cmd", "csh", "fish", "powershell", "pwsh", "sh", "tcsh", "zsh"])
const HELP_OR_VERSION_FLAGS = new Set(["--help", "--version", "-h", "-v"])
const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_VALIDATION_DEPTH = 12

/**
 * Split a shell command at every command boundary that can start another
 * executable. Quoting, escapes, and nested command substitutions are retained.
 */
export function splitCommand(command: string): string[] {
	const segments: string[] = []
	let current = ""
	let escaped = false
	let inDoubleQuote = false
	let inSingleQuote = false
	let parenthesisDepth = 0

	const flush = () => {
		const segment = current.trim()
		if (segment) {
			segments.push(segment)
		}
		current = ""
	}

	for (let index = 0; index < command.length; index++) {
		const character = command[index]
		const nextCharacter = command[index + 1]

		if (escaped) {
			current += character
			escaped = false
			continue
		}
		if (character === "\\") {
			current += character
			escaped = true
			continue
		}
		if (character === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote
			current += character
			continue
		}
		if (character === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote
			current += character
			continue
		}
		if (inSingleQuote || inDoubleQuote) {
			current += character
			continue
		}

		if (character === "(") {
			parenthesisDepth++
			current += character
			continue
		}
		if (character === ")" && parenthesisDepth > 0) {
			parenthesisDepth--
			current += character
			continue
		}
		if (parenthesisDepth > 0) {
			current += character
			continue
		}

		const isDoubleSeparator = (character === "&" && nextCharacter === "&") || (character === "|" && nextCharacter === "|")
		const isSingleSeparator =
			COMMAND_SEPARATORS.has(character) ||
			(character === "|" && nextCharacter !== "|") ||
			(character === "&" && nextCharacter !== "&")
		if (isDoubleSeparator || isSingleSeparator) {
			flush()
			if (isDoubleSeparator) {
				index++
			}
			continue
		}

		current += character
	}

	flush()
	return segments
}

/**
 * Tokenize one simple command while preserving whitespace inside quotes.
 */
export function tokenizeSubcommand(subcommand: string): string[] {
	const tokens: string[] = []
	let current = ""
	let escaped = false
	let inDoubleQuote = false
	let inSingleQuote = false

	const flush = () => {
		if (current) {
			tokens.push(current)
			current = ""
		}
	}

	for (const character of subcommand) {
		if (escaped) {
			current += character
			escaped = false
			continue
		}
		if (character === "\\") {
			escaped = true
			continue
		}
		if (character === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote
			continue
		}
		if (character === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote
			continue
		}
		if (/\s/u.test(character) && !inSingleQuote && !inDoubleQuote) {
			flush()
			continue
		}
		current += character
	}

	if (escaped) {
		current += "\\"
	}
	flush()
	return tokens
}

/**
 * Extract command substitutions so interactive commands cannot be hidden
 * inside `$()`, process substitutions, or backticks.
 */
export function extractCommandSubstitutions(command: string): string[] {
	const substitutions: string[] = []
	const dollarSubstitutionStarts: number[] = []
	let escaped = false
	let inSingleQuote = false

	for (let index = 0; index < command.length; index++) {
		const character = command[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (character === "\\") {
			escaped = true
			continue
		}
		if (character === "'") {
			inSingleQuote = !inSingleQuote
			continue
		}
		if (inSingleQuote) {
			continue
		}

		if (character === "`") {
			let content = ""
			let innerEscaped = false
			let cursor = index + 1
			for (; cursor < command.length; cursor++) {
				const innerCharacter = command[cursor]
				if (innerEscaped) {
					content += innerCharacter
					innerEscaped = false
				} else if (innerCharacter === "\\") {
					innerEscaped = true
				} else if (innerCharacter === "`") {
					break
				} else {
					content += innerCharacter
				}
			}
			if (content.trim()) {
				substitutions.push(content.trim())
			}
			index = cursor
			continue
		}

		if (["$", "<", ">"].includes(character) && command[index + 1] === "(") {
			dollarSubstitutionStarts.push(index + 2)
			index++
			continue
		}
		if (character === ")" && dollarSubstitutionStarts.length > 0) {
			const start = dollarSubstitutionStarts.pop()
			if (start !== undefined) {
				const content = command.slice(start, index).trim()
				if (content) {
					substitutions.push(content)
				}
			}
		}
	}

	return substitutions
}

function executableBasename(executable: string): string {
	const normalized = executable.replace(/\\/g, "/")
	const basename = path.posix.basename(normalized).toLowerCase()
	return basename.replace(/\.(?:bat|cmd|com|exe|ps1)$/i, "")
}

function blocked(executable: string, guidance: string): CommandValidationResult {
	return {
		valid: false,
		error: `Command '${executable}' requires interactive terminal input. ${guidance}`,
	}
}

function optionValueIndex(args: string[], optionIndex: number, optionsWithValues: Set<string>): number {
	const option = args[optionIndex]
	if (optionsWithValues.has(option)) {
		return optionIndex + 2
	}
	return optionIndex + 1
}

function unwrapCommand(tokens: string[]): { args: string[]; executable: string } | undefined {
	let index = 0
	while (index < tokens.length && ASSIGNMENT_PATTERN.test(tokens[index])) {
		index++
	}

	while (index < tokens.length) {
		const executable = executableBasename(tokens[index])
		const remaining = tokens.slice(index + 1)

		if (executable === "env") {
			const optionsWithValues = new Set(["--chdir", "--split-string", "--unset", "-C", "-S", "-u"])
			let envIndex = 0
			while (envIndex < remaining.length) {
				const argument = remaining[envIndex]
				if (argument === "--") {
					envIndex++
					break
				}
				if (ASSIGNMENT_PATTERN.test(argument)) {
					envIndex++
					continue
				}
				if (argument.startsWith("-")) {
					envIndex = optionValueIndex(remaining, envIndex, optionsWithValues)
					continue
				}
				break
			}
			index += envIndex + 1
			continue
		}

		if (executable === "sudo") {
			const hasNonInteractiveFlag = remaining.some(
				(argument) => argument === "--non-interactive" || /^-[^-]*n/.test(argument),
			)
			if (!hasNonInteractiveFlag) {
				return { executable: "sudo", args: remaining }
			}
			const longOptionsWithValues = new Set([
				"--chdir",
				"--close-from",
				"--group",
				"--host",
				"--other-user",
				"--prompt",
				"--role",
				"--type",
				"--user",
			])
			const shortOptionsWithValues = new Set(["C", "D", "g", "h", "p", "R", "T", "t", "U", "u"])
			let sudoIndex = 0
			while (sudoIndex < remaining.length && remaining[sudoIndex].startsWith("-")) {
				const argument = remaining[sudoIndex]
				if (argument === "--") {
					sudoIndex++
					break
				}
				if (argument.startsWith("--")) {
					sudoIndex = longOptionsWithValues.has(argument) && !argument.includes("=") ? sudoIndex + 2 : sudoIndex + 1
					continue
				}

				let consumesFollowingValue = false
				for (let optionIndex = 1; optionIndex < argument.length; optionIndex++) {
					if (shortOptionsWithValues.has(argument[optionIndex])) {
						consumesFollowingValue = optionIndex === argument.length - 1
						break
					}
				}
				sudoIndex += consumesFollowingValue ? 2 : 1
			}
			index += sudoIndex + 1
			continue
		}

		if (["builtin", "command", "exec", "nohup"].includes(executable)) {
			let wrapperIndex = 0
			while (wrapperIndex < remaining.length && remaining[wrapperIndex].startsWith("-")) {
				wrapperIndex++
			}
			index += wrapperIndex + 1
			continue
		}

		if (executable === "time") {
			const optionsWithValues = new Set(["--format", "--output", "-f", "-o"])
			let timeIndex = 0
			while (timeIndex < remaining.length && remaining[timeIndex].startsWith("-")) {
				timeIndex = optionValueIndex(remaining, timeIndex, optionsWithValues)
			}
			index += timeIndex + 1
			continue
		}

		if (executable === "timeout" || executable === "gtimeout") {
			const optionsWithValues = new Set(["--kill-after", "--signal", "-k", "-s"])
			let timeoutIndex = 0
			while (timeoutIndex < remaining.length && remaining[timeoutIndex].startsWith("-")) {
				timeoutIndex = optionValueIndex(remaining, timeoutIndex, optionsWithValues)
			}
			// timeout requires a duration before the executable.
			index += timeoutIndex + 2
			continue
		}

		if (executable === "xargs") {
			const optionsWithValues = new Set([
				"--arg-file",
				"--delimiter",
				"--eof",
				"--max-args",
				"--max-chars",
				"--max-lines",
				"--max-procs",
				"--replace",
				"-a",
				"-d",
				"-E",
				"-I",
				"-L",
				"-n",
				"-P",
				"-s",
			])
			let xargsIndex = 0
			while (xargsIndex < remaining.length && remaining[xargsIndex].startsWith("-")) {
				xargsIndex = optionValueIndex(remaining, xargsIndex, optionsWithValues)
			}
			if (xargsIndex >= remaining.length) {
				return { executable: "echo", args: [] }
			}
			index += xargsIndex + 1
			continue
		}

		return { executable, args: remaining }
	}

	return undefined
}

function findGitSubcommand(args: string[]): { args: string[]; subcommand?: string } {
	const globalOptionsWithValues = new Set([
		"--exec-path",
		"--git-dir",
		"--namespace",
		"--super-prefix",
		"--work-tree",
		"-C",
		"-c",
	])
	let index = 0
	while (index < args.length) {
		const argument = args[index]
		if (argument === "--") {
			index++
			break
		}
		if (!argument.startsWith("-")) {
			return { subcommand: argument.toLowerCase(), args: args.slice(index + 1) }
		}
		index = optionValueIndex(args, index, globalOptionsWithValues)
	}
	const subcommand = args[index]
	return { subcommand: subcommand?.toLowerCase(), args: args.slice(index + 1) }
}

function validateGitCommand(args: string[]): CommandValidationResult {
	const gitCommand = findGitSubcommand(args)
	const flags = new Set(gitCommand.args)

	if (gitCommand.subcommand === "commit") {
		const hasMessageSource = [
			"--file",
			"--fixup",
			"--message",
			"--no-edit",
			"--reuse-message",
			"--squash",
			"-C",
			"-F",
			"-c",
			"-m",
		].some((flag) => flags.has(flag) || gitCommand.args.some((argument) => argument.startsWith(`${flag}=`)))
		const hasCombinedMessageFlag = gitCommand.args.some((argument) => /^-[^-]*[mFCc]/.test(argument))
		if (!hasMessageSource && !hasCombinedMessageFlag) {
			return blocked("git commit", "Provide a message with -m/-F or use --no-edit.")
		}
	}

	const interactiveFlag = gitCommand.args.some(
		(argument) => ["--interactive", "--patch", "-i", "-p"].includes(argument) || /^-[^-]*(?:i|p)/.test(argument),
	)
	if (
		interactiveFlag &&
		["add", "checkout", "clean", "rebase", "reset", "restore", "stash"].includes(gitCommand.subcommand ?? "")
	) {
		return blocked(`git ${gitCommand.subcommand}`, "Use a non-interactive variant of the command.")
	}
	if (gitCommand.subcommand === "mergetool") {
		return blocked("git mergetool", "Resolve files with normal file-editing tools.")
	}
	if (gitCommand.subcommand === "difftool" && !flags.has("--no-prompt") && !flags.has("-y")) {
		return blocked("git difftool", "Add --no-prompt or -y.")
	}

	return { valid: true }
}

function findSshRemoteCommand(args: string[]): string[] {
	const optionsWithValues = new Set([
		"-B",
		"-b",
		"-c",
		"-D",
		"-E",
		"-e",
		"-F",
		"-I",
		"-i",
		"-J",
		"-L",
		"-l",
		"-m",
		"-O",
		"-o",
		"-p",
		"-Q",
		"-R",
		"-S",
		"-W",
		"-w",
	])
	let index = 0
	while (index < args.length) {
		const argument = args[index]
		if (argument === "--") {
			index++
			break
		}
		if (argument.startsWith("-")) {
			index = optionValueIndex(args, index, optionsWithValues)
			continue
		}
		// First positional argument is the destination.
		return args.slice(index + 1)
	}
	return []
}

function validateSimpleCommand(tokens: string[], depth: number): CommandValidationResult {
	if (depth > MAX_VALIDATION_DEPTH) {
		return {
			valid: false,
			error: "Command nesting is too deep to validate safely.",
		}
	}
	const unwrapped = unwrapCommand(tokens)
	if (!unwrapped) {
		return { valid: true }
	}
	const { args, executable } = unwrapped
	if (executable === "find") {
		const findExecIndex = args.findIndex((token) => token === "-exec" || token === "-execdir")
		if (findExecIndex !== -1) {
			const terminatorIndex = args.findIndex((token, index) => index > findExecIndex && (token === ";" || token === "+"))
			const execTokens = args.slice(findExecIndex + 1, terminatorIndex === -1 ? undefined : terminatorIndex)
			const execValidation = validateSimpleCommand(execTokens, depth + 1)
			if (!execValidation.valid) {
				return execValidation
			}
		}
	}

	if (executable === "sudo") {
		return blocked("sudo", "Use sudo -n so missing privileges fail immediately instead of requesting a password.")
	}
	if (INTERACTIVE_EDITORS.has(executable)) {
		if (args.some((argument) => HELP_OR_VERSION_FLAGS.has(argument))) {
			return { valid: true }
		}
		if (executable === "nvim" && args.includes("--headless")) {
			return { valid: true }
		}
		return blocked(executable, "Use the file-editing tools or a documented headless mode.")
	}
	if (["less", "more"].includes(executable)) {
		if (args.some((argument) => HELP_OR_VERSION_FLAGS.has(argument))) {
			return { valid: true }
		}
		return blocked(executable, "Use a bounded output command such as sed, head, or tail.")
	}
	if (executable === "man") {
		if (args.some((argument) => HELP_OR_VERSION_FLAGS.has(argument) || ["--path", "--where", "-w"].includes(argument))) {
			return { valid: true }
		}
		return blocked("man", "Use --help or request the relevant documentation.")
	}
	if (["btop", "htop", "screen", "tmux", "watch"].includes(executable)) {
		return blocked(executable, "Use a bounded, non-interactive status or inspection command.")
	}
	if (executable === "top") {
		const isBatchMode =
			args.includes("-b") || args.some((argument, index) => argument === "-l" && Number(args[index + 1]) > 0)
		if (!isBatchMode) {
			return blocked("top", "Use batch mode (-b) or a bounded sample count (-l 1).")
		}
	}

	if (SHELLS.has(executable)) {
		const normalizedArgs = args.map((argument) => argument.toLowerCase())
		const supportsShortOptionClusters = !["cmd", "powershell", "pwsh"].includes(executable)
		const persistentShellFlag = normalizedArgs.some(
			(argument) =>
				["--interactive", "--noexit", "-noexit", "/k"].includes(argument) ||
				(supportsShortOptionClusters && /^-[^-]*i/.test(argument)),
		)
		if (persistentShellFlag) {
			return blocked(executable, "Remove interactive/no-exit flags and provide a command or script that terminates.")
		}
		const commandFlagIndex = normalizedArgs.findIndex(
			(argument) =>
				["--command", "-command", "-c", "/c"].includes(argument) ||
				(supportsShortOptionClusters && /^-[^-]*c/.test(argument)),
		)
		if (commandFlagIndex !== -1 && args[commandFlagIndex + 1]) {
			return validateCommandInternal(args[commandFlagIndex + 1], depth + 1)
		}
		const hasScript = args.some((argument) => !argument.startsWith("-") && argument !== "/k")
		if (!hasScript) {
			return blocked(executable, "Provide a script path or a command flag such as -c.")
		}
	}

	if (INTERACTIVE_REPLS.has(executable)) {
		if (executable === "irb") {
			return blocked("irb", "Provide a non-interactive Ruby script instead.")
		}
		const evaluationFlags = new Set(["--eval", "--help", "--version", "-c", "-e", "-f", "-h", "-m", "-p", "-r", "-v"])
		const hasEvaluation = args.some(
			(argument, index) =>
				evaluationFlags.has(argument) && (index + 1 < args.length || HELP_OR_VERSION_FLAGS.has(argument)),
		)
		const hasScript = args.some((argument) => !argument.startsWith("-") && argument !== "-")
		if (!hasEvaluation && !hasScript) {
			return blocked(executable, "Provide a script/module or an evaluation argument.")
		}
	}

	if (executable === "sqlite3") {
		const positionalArguments = args.filter((argument) => !argument.startsWith("-"))
		if (positionalArguments.length <= 1) {
			return blocked("sqlite3", "Provide the database and query (or a .read command) on the command line.")
		}
	}
	if (executable === "mysql" && !args.some((argument) => argument === "-e" || argument.startsWith("--execute"))) {
		return blocked("mysql", "Provide a query with -e/--execute.")
	}
	if (executable === "psql" && !args.some((argument) => ["--command", "--file", "-c", "-f"].includes(argument))) {
		return blocked("psql", "Provide a query with -c or a script with -f.")
	}

	if (executable === "ssh") {
		const remoteCommand = findSshRemoteCommand(args)
		if (remoteCommand.length === 0) {
			const isNonInteractiveTunnel =
				args.includes("-N") && args.some((argument) => argument.toLowerCase().includes("batchmode=yes"))
			if (!isNonInteractiveTunnel) {
				return blocked("ssh", "Provide a remote command, or use -N with BatchMode=yes for a tunnel.")
			}
		} else {
			const remoteValidation = validateCommandInternal(remoteCommand.join(" "), depth + 1)
			if (!remoteValidation.valid) {
				return remoteValidation
			}
		}
	}

	if (executable === "git") {
		return validateGitCommand(args)
	}
	if (executable === "npm" && ["adduser", "login"].includes(args[0])) {
		return blocked(`npm ${args[0]}`, "Configure an authentication token non-interactively.")
	}
	if (
		["npm", "yarn", "pnpm", "bun"].includes(executable) &&
		["init", "create"].includes(args[0]) &&
		!args.some((argument) => argument === "--yes" || argument === "-y")
	) {
		return blocked(`${executable} ${args[0]}`, "Add --yes/-y or provide a package initializer with all required arguments.")
	}
	if (executable === "docker" && args[0] === "login" && !args.includes("--password-stdin")) {
		return blocked("docker login", "Pass credentials through --password-stdin.")
	}
	if (executable === "gh" && args[0] === "auth" && args[1] === "login" && !args.includes("--with-token")) {
		return blocked("gh auth login", "Provide a token through --with-token or the GH_TOKEN environment variable.")
	}

	return { valid: true }
}

function validateCommandInternal(command: string, depth: number): CommandValidationResult {
	if (depth > MAX_VALIDATION_DEPTH) {
		return {
			valid: false,
			error: "Command nesting is too deep to validate safely.",
		}
	}
	const trimmedCommand = command.trim()
	if (!trimmedCommand) {
		return { valid: true }
	}

	for (const substitution of extractCommandSubstitutions(trimmedCommand)) {
		const substitutionValidation = validateCommandInternal(substitution, depth + 1)
		if (!substitutionValidation.valid) {
			return substitutionValidation
		}
	}

	for (const segment of splitCommand(trimmedCommand)) {
		let ungroupedSegment = segment.trim()
		let removedGrouping = false
		while (
			(ungroupedSegment.startsWith("(") && ungroupedSegment.endsWith(")")) ||
			(ungroupedSegment.startsWith("{") && ungroupedSegment.endsWith("}"))
		) {
			ungroupedSegment = ungroupedSegment.slice(1, -1).trim()
			removedGrouping = true
		}
		const validation = removedGrouping
			? validateCommandInternal(ungroupedSegment, depth + 1)
			: validateSimpleCommand(tokenizeSubcommand(ungroupedSegment), depth)
		if (!validation.valid) {
			return validation
		}
	}
	return { valid: true }
}

function checkAllowedCommand(command: string): boolean {
	const envAllowed = process.env.LUMI_ALLOWED_INTERACTIVE_COMMANDS
	if (envAllowed) {
		const allowedPatterns = envAllowed.split(",").map((p) => p.trim())
		if (
			allowedPatterns.some((pat: string) => {
				const escaped = pat.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
				const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i")
				return regex.test(command)
			})
		) {
			return true
		}
	}

	if (vscode?.workspace) {
		try {
			const config = vscode.workspace.getConfiguration("lumi")
			const allowedCommands = config.get<string[]>("allowedInteractiveCommands") || []
			if (
				allowedCommands.some((pat: string) => {
					const escaped = pat.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
					const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i")
					return regex.test(command)
				})
			) {
				return true
			}
		} catch {
			// Ignore config lookup error
		}
	}

	return false
}

/**
 * Fail fast for command shapes that are known to wait indefinitely for a TTY.
 * Runtime prompt detection remains the second line of defense for tools whose
 * interactivity depends on credentials or local configuration.
 */
export function validateCommand(command: string): CommandValidationResult {
	if (checkAllowedCommand(command.trim())) {
		return { valid: true }
	}
	return validateCommandInternal(command, 0)
}

export function getSanitizerMode(): "blocking" | "advisory" | "disabled" {
	const envMode = process.env.LUMI_COMMAND_SANITIZER_MODE
	if (envMode === "blocking" || envMode === "advisory" || envMode === "disabled") {
		return envMode
	}

	if (vscode?.workspace) {
		try {
			const config = vscode.workspace.getConfiguration("lumi")
			return config.get<"blocking" | "advisory" | "disabled">("commandSanitizerMode") || "advisory"
		} catch {
			// Ignore config lookup error
		}
	}
	return "advisory"
}
