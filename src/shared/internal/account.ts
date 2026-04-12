/**
 * List of email domains that are considered trusted testers for Codemarie.
 */
const CLINE_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a Codemarie bot user.
 * E.g. Emails ending with @codemarie.bot
 */
export function isCodemarieBotUser(email: string): boolean {
	return email.endsWith("@codemarie.bot")
}

export function isCodemarieInternalTester(email: string): boolean {
	return isCodemarieBotUser(email) || CLINE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
