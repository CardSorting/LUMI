/**
 * List of email domains that are considered trusted testers for DietCode.
 */
const CLINE_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a DietCode bot user.
 * E.g. Emails ending with @dietcode.bot
 */
export function isDietCodeBotUser(email: string): boolean {
	return email.endsWith("@dietcode.bot")
}

export function isDietCodeInternalTester(email: string): boolean {
	return isDietCodeBotUser(email) || CLINE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
