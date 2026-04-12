export interface VertexCredentials {
	type?: string
	project_id?: string
	private_key_id?: string
	private_key?: string
	client_email?: string
	client_id?: string
	auth_uri?: string
	token_uri?: string
	auth_provider_x509_cert_url?: string
	client_x509_cert_url?: string
	universe_domain?: string
}

/**
 * Validates and parses Vertex AI Service Account JSON credentials.
 * @param jsonString The JSON string of the service account key.
 * @returns The parsed and validated credentials, or throws an error.
 */
export function validateAndParseVertexCredentials(jsonString: string): VertexCredentials {
	if (!jsonString || jsonString.trim() === "") {
		throw new Error("Service account JSON is empty")
	}

	try {
		const credentials = JSON.parse(jsonString) as VertexCredentials

		if (credentials.type !== "service_account") {
			throw new Error("Invalid credential type. Expected 'service_account'")
		}

		if (!credentials.project_id || credentials.project_id.trim() === "") {
			throw new Error("Missing or empty 'project_id' in service account JSON")
		}

		if (!credentials.private_key || credentials.private_key.trim() === "") {
			throw new Error("Missing or empty 'private_key' in service account JSON")
		}

		// Basic check for PEM format
		if (!credentials.private_key.includes("BEGIN PRIVATE KEY")) {
			throw new Error("Invalid 'private_key' format. Expected a PEM-encoded private key")
		}

		if (!credentials.client_email || credentials.client_email.trim() === "") {
			throw new Error("Missing or empty 'client_email' in service account JSON")
		}

		// Basic email validation
		if (!credentials.client_email.includes("@") || !credentials.client_email.includes(".")) {
			throw new Error("Invalid 'client_email' format")
		}

		return credentials
	} catch (error: any) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON format: ${error.message}`)
		}
		throw error
	}
}

/**
 * Safely extracts the project ID from a Vertex AI JSON string if possible.
 * Does not throw if parsing fails.
 * @param jsonString The JSON string to parse.
 * @returns The project ID or undefined.
 */
export function getProjectIdFromJson(jsonString: string | undefined): string | undefined {
	if (!jsonString) return undefined
	try {
		const credentials = JSON.parse(jsonString)
		return credentials.project_id
	} catch {
		return undefined
	}
}
