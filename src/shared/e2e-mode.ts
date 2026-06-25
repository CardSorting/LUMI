/** True when the extension runs inside Playwright E2E (VS Code launched with E2E_TEST=true). */
export function isE2ETestMode(): boolean {
	return process.env.E2E_TEST === "true"
}
