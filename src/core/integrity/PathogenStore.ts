import * as fs from "fs"
import * as path from "path"

export interface Pathogen {
	id: string
	type: "FAILED_MOVE" | "AXIOM_VIOLATION" | "DRIFT_PATTERN"
	signature: string
	timestamp: number
	severity: number
}

/**
 * PathogenStore: The project's "Immune Memory".
 * Records failed architectural experiments to ensure they are never repeated.
 */
export class PathogenStore {
	private pathogens: Pathogen[] = []
	private storePath: string

	constructor(private cwd: string) {
		this.storePath = path.resolve(this.cwd, ".spider", "immune_memory.json")
		this.load()
	}

	public record(type: Pathogen["type"], signature: string, severity = 1) {
		this.pathogens.push({
			id: Math.random().toString(36).substring(7),
			type,
			signature,
			timestamp: Date.now(),
			severity
		})
		this.save()
	}

	public isPathogenic(signature: string): boolean {
		return this.pathogens.some(p => p.signature === signature)
	}

	public getPathogens() {
		return this.pathogens
	}

	private load() {
		if (fs.existsSync(this.storePath)) {
			try {
				this.pathogens = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
			} catch (e) {
				this.pathogens = []
			}
		}
	}

	private save() {
		const dir = path.dirname(this.storePath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.storePath, JSON.stringify(this.pathogens, null, 2))
	}
}
