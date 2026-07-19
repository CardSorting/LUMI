import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { analyzeCommandFailure } from "./commandDiagnostics"
import {
	extractCommandSubstitutions,
	getSanitizerMode,
	splitCommand,
	tokenizeSubcommand,
	validateCommand,
} from "./commandSanitizer"

describe("commandSanitizer", () => {
	describe("splitCommand", () => {
		it("splits every executable boundary, including pipelines and newlines", () => {
			assert.deepEqual(splitCommand("echo 1 && echo 2"), ["echo 1", "echo 2"])
			assert.deepEqual(splitCommand("npm test || echo 'fail'"), ["npm test", "echo 'fail'"])
			assert.deepEqual(splitCommand("cat file | grep text; sort file"), ["cat file", "grep text", "sort file"])
			assert.deepEqual(splitCommand("npm install\nnpm test"), ["npm install", "npm test"])
		})

		it("respects quoting, escaping, and nested substitutions", () => {
			assert.deepEqual(splitCommand('echo "hello && world"'), ['echo "hello && world"'])
			assert.deepEqual(splitCommand("echo 'hello; world' && ls"), ["echo 'hello; world'", "ls"])
			assert.deepEqual(splitCommand("echo hello\\ \\&\\ world"), ["echo hello\\ \\&\\ world"])
			assert.deepEqual(splitCommand("echo $(printf 'a|b') | cat"), ["echo $(printf 'a|b')", "cat"])
		})
	})

	describe("tokenizeSubcommand", () => {
		it("tokenizes shell whitespace and quoted arguments", () => {
			assert.deepEqual(tokenizeSubcommand("python\t-c print"), ["python", "-c", "print"])
			assert.deepEqual(tokenizeSubcommand("python -c \"print('hello')\""), ["python", "-c", "print('hello')"])
			assert.deepEqual(tokenizeSubcommand("git commit -m 'initial commit'"), ["git", "commit", "-m", "initial commit"])
		})
	})

	describe("extractCommandSubstitutions", () => {
		it("extracts backticks and nested dollar substitutions", () => {
			assert.deepEqual(extractCommandSubstitutions("echo `date`"), ["date"])
			assert.deepEqual(extractCommandSubstitutions('git commit -m "$(date +%s)"'), ["date +%s"])
			assert.deepEqual(extractCommandSubstitutions("echo $(echo $(date))"), ["date", "echo $(date)"])
			assert.deepEqual(extractCommandSubstitutions("diff <(vim file) <(cat file)"), ["vim file", "cat file"])
		})

		it("ignores substitutions inside single quotes", () => {
			assert.deepEqual(extractCommandSubstitutions("echo 'use $(date) literally'"), [])
		})
	})

	describe("validateCommand", () => {
		it("blocks interactive programs in chains, pipelines, substitutions, and wrappers", () => {
			assert.equal(validateCommand("git status && vi config.json").valid, false)
			assert.equal(validateCommand("cat file.txt | less").valid, false)
			assert.equal(validateCommand("echo $(nano)").valid, false)
			assert.equal(validateCommand("env -i MODE=test node").valid, false)
			assert.equal(validateCommand("sudo -n -- vim file.txt").valid, false)
			assert.equal(validateCommand("time -f '%E' vim file.txt").valid, false)
			assert.equal(validateCommand("timeout 5s vim file.txt").valid, false)
			assert.equal(validateCommand("xargs -n 1 vim").valid, false)
			assert.equal(validateCommand("find . -exec vim {} \\;").valid, false)
			assert.equal(validateCommand("(echo ready; vim file.txt)").valid, false)
		})

		it("allows documented non-interactive editor and pager modes", () => {
			assert.equal(validateCommand("vim --version").valid, true)
			assert.equal(validateCommand("nvim --headless -c 'quit'").valid, true)
			assert.equal(validateCommand("man --where grep").valid, true)
		})

		it("requires sudo to fail fast instead of prompting", () => {
			assert.equal(validateCommand("sudo apt-get update").valid, false)
			assert.equal(validateCommand("sudo -n apt-get update").valid, true)
			assert.equal(validateCommand("sudo -nE apt-get update").valid, true)
			assert.equal(validateCommand("sudo -nu root apt-get update").valid, true)
		})

		it("validates nested shell command strings", () => {
			assert.equal(validateCommand("bash").valid, false)
			assert.equal(validateCommand("zsh -i").valid, false)
			assert.equal(validateCommand("bash -c 'vim file.txt'").valid, false)
			assert.equal(validateCommand("bash -lc 'vim file.txt'").valid, false)
			assert.equal(validateCommand("bash -c 'echo hello'").valid, true)
			assert.equal(validateCommand("cmd /k echo hello").valid, false)
			assert.equal(validateCommand("pwsh -NoExit -Command 'echo hello'").valid, false)
			assert.equal(validateCommand("pwsh -NonInteractive -Command 'echo hello'").valid, true)
			assert.equal(validateCommand("sh ./script.sh").valid, true)
		})

		it("blocks REPLs but allows scripts, modules, eval, and version checks", () => {
			assert.equal(validateCommand("python").valid, false)
			assert.equal(validateCommand("node").valid, false)
			assert.equal(validateCommand("python script.py").valid, true)
			assert.equal(validateCommand("python3 -m pip install requests").valid, true)
			assert.equal(validateCommand("node -e 'console.log(1)'").valid, true)
			assert.equal(validateCommand("node --version").valid, true)
		})

		it("requires non-interactive database queries", () => {
			assert.equal(validateCommand("sqlite3 mydb.db").valid, false)
			assert.equal(validateCommand("mysql -u root").valid, false)
			assert.equal(validateCommand("psql postgres://localhost/db").valid, false)
			assert.equal(validateCommand("sqlite3 mydb.db 'select 1'").valid, true)
			assert.equal(validateCommand("mysql -u root -e 'show databases'").valid, true)
			assert.equal(validateCommand("psql -d app -c 'select 1'").valid, true)
		})

		it("requires an SSH remote command and validates that command recursively", () => {
			assert.equal(validateCommand("ssh user@host").valid, false)
			assert.equal(validateCommand("ssh -i key.pem user@host").valid, false)
			assert.equal(validateCommand("ssh user@host 'vim file'").valid, false)
			assert.equal(validateCommand("ssh user@host 'ls -la'").valid, true)
			assert.equal(validateCommand("ssh -N -o BatchMode=yes -L 8080:localhost:80 user@host").valid, true)
		})

		it("handles Git global flags and interactive subcommands", () => {
			assert.equal(validateCommand("git commit").valid, false)
			assert.equal(validateCommand("git -C repo commit --amend").valid, false)
			assert.equal(validateCommand("git add --patch file").valid, false)
			assert.equal(validateCommand("git rebase -i main").valid, false)
			assert.equal(validateCommand("git rebase -iHEAD~2").valid, false)
			assert.equal(validateCommand("git commit -m 'feat: add file'").valid, true)
			assert.equal(validateCommand("git commit -am 'feat: add file'").valid, true)
			assert.equal(validateCommand("git -C repo commit --no-edit --amend").valid, true)
			assert.equal(validateCommand("git difftool --no-prompt").valid, true)
		})

		it("blocks full-screen monitors while allowing bounded snapshots", () => {
			assert.equal(validateCommand("watch npm test").valid, false)
			assert.equal(validateCommand("htop").valid, false)
			assert.equal(validateCommand("top").valid, false)
			assert.equal(validateCommand("top -b -n 1").valid, true)
			assert.equal(validateCommand("top -l 1").valid, true)
		})

		it("blocks common credential and initialization prompts", () => {
			assert.equal(validateCommand("npm login").valid, false)
			assert.equal(validateCommand("npm init").valid, false)
			assert.equal(validateCommand("npm create vite@latest").valid, false)
			assert.equal(validateCommand("pnpm create vite@latest").valid, false)
			assert.equal(validateCommand("docker login registry.example.com").valid, false)
			assert.equal(validateCommand("gh auth login").valid, false)
			assert.equal(validateCommand("npm init -y").valid, true)
			assert.equal(validateCommand("npm create vite@latest -y").valid, true)
			assert.equal(validateCommand("docker login --password-stdin registry.example.com").valid, true)
		})

		it("allows interactive/init/create commands dynamically via environment variable overrides", () => {
			const originalEnv = process.env.LUMI_ALLOWED_INTERACTIVE_COMMANDS
			try {
				process.env.LUMI_ALLOWED_INTERACTIVE_COMMANDS = "npm create*, git commit"
				assert.equal(validateCommand("npm create vite@latest .").valid, true)
				assert.equal(validateCommand("git commit").valid, true)
				assert.equal(validateCommand("npm init").valid, false)
			} finally {
				process.env.LUMI_ALLOWED_INTERACTIVE_COMMANDS = originalEnv
			}
		})
	})

	describe("getSanitizerMode", () => {
		it("returns environment variable overrides first", () => {
			const originalMode = process.env.LUMI_COMMAND_SANITIZER_MODE
			try {
				process.env.LUMI_COMMAND_SANITIZER_MODE = "disabled"
				assert.equal(getSanitizerMode(), "disabled")
				process.env.LUMI_COMMAND_SANITIZER_MODE = "blocking"
				assert.equal(getSanitizerMode(), "blocking")
			} finally {
				process.env.LUMI_COMMAND_SANITIZER_MODE = originalMode
			}
		})

		it("falls back to advisory by default", () => {
			const originalMode = process.env.LUMI_COMMAND_SANITIZER_MODE
			try {
				delete process.env.LUMI_COMMAND_SANITIZER_MODE
				assert.equal(getSanitizerMode(), "advisory")
			} finally {
				process.env.LUMI_COMMAND_SANITIZER_MODE = originalMode
			}
		})
	})
})

describe("commandDiagnostics", () => {
	it("returns no diagnostic for success", () => {
		assert.deepEqual(analyzeCommandFailure("echo hello", 0, "hello"), {})
	})

	it("diagnoses a busy port without recommending an unconditional kill", () => {
		const suggestion = analyzeCommandFailure(
			"npm run dev",
			1,
			"Error: listen EADDRINUSE: address already in use :::3000",
		).suggestion
		assert.match(suggestion ?? "", /Port 3000 is already in use/)
		assert.doesNotMatch(suggestion ?? "", /kill -9/)
	})

	it("diagnoses common repository and executable blockers", () => {
		assert.match(
			analyzeCommandFailure("git add .", 1, "fatal: Unable to create '.git/index.lock': File exists").suggestion ?? "",
			/index lock/i,
		)
		assert.match(analyzeCommandFailure("foobar -v", 127, "bash: foobar: command not found").suggestion ?? "", /foobar/)
		assert.match(analyzeCommandFailure("./script.sh", 126, "Permission denied").suggestion ?? "", /Permission/)
	})

	it("uses the active Python interpreter in module guidance", () => {
		const suggestion = analyzeCommandFailure(
			"python3 app.py",
			1,
			"ModuleNotFoundError: No module named 'requests'",
		).suggestion
		assert.match(suggestion ?? "", /python3 -m pip/)
	})

	it("distinguishes package modules from local Node paths", () => {
		assert.match(
			analyzeCommandFailure("node index.js", 1, "Error: Cannot find module 'express'").suggestion ?? "",
			/dependency install/,
		)
		assert.match(
			analyzeCommandFailure("node index.js", 1, "Error: Cannot find module './missing.js'").suggestion ?? "",
			/local module/,
		)
	})

	it("diagnoses network, storage, TLS, and memory failures", () => {
		assert.match(analyzeCommandFailure("npm install", 1, "getaddrinfo ENOTFOUND registry").suggestion ?? "", /resolution/)
		assert.match(analyzeCommandFailure("npm test", 1, "ENOSPC: no space left on device").suggestion ?? "", /Storage/)
		assert.match(analyzeCommandFailure("curl https://example.test", 60, "certificate has expired").suggestion ?? "", /TLS/)
		assert.match(analyzeCommandFailure("node build.js", 1, "FATAL ERROR: heap out of memory").suggestion ?? "", /memory/)
	})
})
