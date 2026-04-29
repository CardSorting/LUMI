import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface LayerConfig {
	optimalLogicDensity: number
	maxIOEntropy: number
	maxComplexity: number
}

export interface StabilityConfig {
	layers: Record<string, LayerConfig>
	global: {
		maxPathDepth: number
		enforceKebabCase: boolean
		activityThreshold: number
		integrityAlertThreshold: number
		supportedLayerTags?: string[]
		excludePaths?: string[]
		auditAggressiveness?: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE"
	}
}

/**
 * StabilityPolicy: The architectural constitution.
 * Loads and provides structural thresholds from stability.config.json.
 */
export class StabilityPolicy {
	private static instance: StabilityPolicy
	private config: StabilityConfig

	private constructor(cwd: string) {
		const configPath = path.resolve(cwd, "stability.config.json")
		if (fs.existsSync(configPath)) {
			try {
				this.config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			} catch (e) {
				Logger.error("[StabilityPolicy] Failed to parse config, using defaults:", e)
				this.config = this.getDefaults()
			}
		} else {
			this.config = this.getDefaults()
		}
	}

	public static getInstance(cwd: string): StabilityPolicy {
		if (!StabilityPolicy.instance) {
			StabilityPolicy.instance = new StabilityPolicy(cwd)
		}
		return StabilityPolicy.instance
	}

	public getLayerConfig(layer: string): LayerConfig {
		return this.config.layers[layer.toLowerCase()] || this.config.layers.plumbing
	}

	public getGlobalConfig() {
		return this.config.global
	}

	private getDefaults(): StabilityConfig {
		return {
			layers: {
				domain: { optimalLogicDensity: 0.15, maxIOEntropy: 0.0, maxComplexity: 5000 },
				core: { optimalLogicDensity: 0.05, maxIOEntropy: 0.0, maxComplexity: 3000 },
				infrastructure: { optimalLogicDensity: 0.05, maxIOEntropy: 1.0, maxComplexity: 10000 },
				plumbing: { optimalLogicDensity: 0.0, maxIOEntropy: 0.0, maxComplexity: 500 },
			},
			global: {
				maxPathDepth: 4,
				enforceKebabCase: false,
				activityThreshold: 5.0,
				integrityAlertThreshold: 70,
				supportedLayerTags: [".ts", ".tsx", ".js", ".jsx"],
				excludePaths: [],
				auditAggressiveness: "BALANCED",
			},
		}
	}
}
