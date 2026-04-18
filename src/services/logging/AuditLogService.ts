import fs from "node:fs/promises"
import path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { SensitiveDataMasker } from "@/shared/utils/SensitiveDataMasker"

export interface AuditEntry {
	ts: number
	command: string
	args: string[]
	duration?: number
	exitCode?: number
	error?: string
	metadata?: Record<string, any>
}

export class AuditLogService {
	private static instance: AuditLogService
	private logPath: string | null = null

	public static getInstance(): AuditLogService {
		if (!AuditLogService.instance) {
			AuditLogService.instance = new AuditLogService()
		}
		return AuditLogService.instance
	}

	public async initialize(configDir?: string): Promise<void> {
		const baseDir = configDir || HostProvider.get().globalStorageFsPath
		this.logPath = path.join(baseDir, "audit.log.jsonl")

		try {
			await fs.mkdir(path.dirname(this.logPath), { recursive: true })
		} catch {
			// Ignore
		}
	}

	public async log(entry: Omit<AuditEntry, "ts">): Promise<void> {
		if (!this.logPath) return

		const fullEntry: AuditEntry = {
			...entry,
			ts: Date.now(),
		}

		// Mask sensitive data in args and error messages
		fullEntry.args = fullEntry.args.map((arg) => SensitiveDataMasker.mask(arg))
		if (fullEntry.error) {
			fullEntry.error = SensitiveDataMasker.mask(fullEntry.error)
		}

		const line = JSON.stringify(fullEntry) + "\n"
		try {
			await fs.appendFile(this.logPath, line, "utf8")
		} catch {
			// Fail silently to avoid interrupting the main flow
		}
	}
}
