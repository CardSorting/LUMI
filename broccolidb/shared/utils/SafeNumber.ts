/**
 * SafeNumber: Industrial-grade numeric formatting for substrate telemetry.
 * Prevents crashes by providing deterministic fallbacks for null, undefined, or NaN values.
 */
export class SafeNumber {
	/**
	 * Safely formats a number to a fixed decimal string.
	 * @param value The value to format.
	 * @param fractionDigits Number of digits after the decimal point.
	 * @param fallback The fallback string if the value is invalid.
	 */
	public static format(value: number | undefined | null, fractionDigits = 1, fallback = "0.0"): string {
		if (value === undefined || value === null || Number.isNaN(value)) {
			return fallback
		}
		try {
			return value.toFixed(fractionDigits)
		} catch (_e) {
			return fallback
		}
	}

	/**
	 * Safely formats a percentage (multiplier * 100).
	 */
	public static formatPercent(value: number | undefined | null, fractionDigits = 1, fallback = "0.0"): string {
		if (value === undefined || value === null || Number.isNaN(value)) {
			return fallback
		}
		return SafeNumber.format(value * 100, fractionDigits, fallback)
	}
}
