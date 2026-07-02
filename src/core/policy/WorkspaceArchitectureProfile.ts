import * as fs from "fs"
import * as path from "path"

export type WorkspaceArchitectureMode = "greenfield" | "joy-zoning" | "workspace-native"
export type WorkspaceArchitecturePreference = "auto" | "joy-zoning" | "workspace-native"

export interface JoyZoningSteeringThresholds {
	maxFunctionLines: number
	minBoundaryLines: number
	minBoundaryDecisions: number
	maxClassMethods: number
}

export interface WorkspaceArchitectureProfile {
	mode: WorkspaceArchitectureMode
	enforceCanonicalLayers: boolean
	joyZoningSteering: "canonical" | "blended"
	steeringThresholds: JoyZoningSteeringThresholds
	reason: string
}

export const DEFAULT_JOY_ZONING_STEERING_THRESHOLDS: JoyZoningSteeringThresholds = {
	maxFunctionLines: 80,
	minBoundaryLines: 20,
	minBoundaryDecisions: 2,
	maxClassMethods: 12,
}

const IMPLEMENTATION_DIRECTORIES = new Set([
	"app",
	"apps",
	"backend",
	"cmd",
	"frontend",
	"internal",
	"lib",
	"packages",
	"pkg",
	"src",
	"test",
	"tests",
	"web",
])

const IMPLEMENTATION_EXTENSIONS = new Set([
	".c",
	".cpp",
	".cs",
	".ex",
	".exs",
	".go",
	".java",
	".js",
	".jsx",
	".kt",
	".php",
	".py",
	".rb",
	".rs",
	".swift",
	".ts",
	".tsx",
	".vue",
])

interface WorkspaceArchitecturePolicyConfig {
	preference?: WorkspaceArchitecturePreference
	thresholds: JoyZoningSteeringThresholds
}

function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback
}

function readPolicyConfig(configPath: string): WorkspaceArchitecturePolicyConfig {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
			global?: {
				architectureMode?: WorkspaceArchitecturePreference
				joyZoningSteering?: Partial<JoyZoningSteeringThresholds>
			}
		}
		const preference = config.global?.architectureMode
		const steering = config.global?.joyZoningSteering
		return {
			preference:
				preference === "auto" || preference === "joy-zoning" || preference === "workspace-native"
					? preference
					: undefined,
			thresholds: {
				maxFunctionLines: positiveInteger(
					steering?.maxFunctionLines,
					DEFAULT_JOY_ZONING_STEERING_THRESHOLDS.maxFunctionLines,
				),
				minBoundaryLines: positiveInteger(
					steering?.minBoundaryLines,
					DEFAULT_JOY_ZONING_STEERING_THRESHOLDS.minBoundaryLines,
				),
				minBoundaryDecisions: positiveInteger(
					steering?.minBoundaryDecisions,
					DEFAULT_JOY_ZONING_STEERING_THRESHOLDS.minBoundaryDecisions,
				),
				maxClassMethods: positiveInteger(
					steering?.maxClassMethods,
					DEFAULT_JOY_ZONING_STEERING_THRESHOLDS.maxClassMethods,
				),
			},
		}
	} catch {
		// Invalid policy files are handled by StabilityPolicy. Detection stays conservative here.
	}
	return { thresholds: { ...DEFAULT_JOY_ZONING_STEERING_THRESHOLDS } }
}

function directoryContainsImplementation(directoryPath: string): boolean {
	try {
		return fs
			.readdirSync(directoryPath, { withFileTypes: true })
			.some((entry) => entry.isFile() && IMPLEMENTATION_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
	} catch {
		return false
	}
}

/**
 * Selects the architectural posture for a workspace.
 *
 * Existing projects are workspace-native unless they explicitly opt into
 * JoyZoning structural enforcement. Empty workspaces retain the canonical
 * greenfield posture. A legacy stability.config.json remains an opt-in so
 * existing JoyZoning projects keep their current behavior.
 */
export function detectWorkspaceArchitectureProfile(cwd?: string): WorkspaceArchitectureProfile {
	const defaultThresholds = { ...DEFAULT_JOY_ZONING_STEERING_THRESHOLDS }
	if (!cwd) {
		return {
			mode: "workspace-native",
			enforceCanonicalLayers: false,
			joyZoningSteering: "blended",
			steeringThresholds: defaultThresholds,
			reason: "Workspace root is unavailable; preserve local structure and apply blended JoyZoning steering.",
		}
	}

	const configPath = path.join(cwd, "stability.config.json")
	const hasStabilityConfig = fs.existsSync(configPath)
	const policyConfig = hasStabilityConfig
		? readPolicyConfig(configPath)
		: { thresholds: defaultThresholds, preference: undefined }
	const preference = policyConfig.preference

	if (preference === "workspace-native") {
		return {
			mode: "workspace-native",
			enforceCanonicalLayers: false,
			joyZoningSteering: "blended",
			steeringThresholds: policyConfig.thresholds,
			reason: "stability.config.json selects workspace-native structure with blended JoyZoning steering.",
		}
	}

	if (
		preference === "joy-zoning" ||
		(hasStabilityConfig && preference === undefined) ||
		fs.existsSync(path.join(cwd, "spider.spec.json"))
	) {
		return {
			mode: "joy-zoning",
			enforceCanonicalLayers: true,
			joyZoningSteering: "canonical",
			steeringThresholds: policyConfig.thresholds,
			reason:
				preference === "joy-zoning"
					? "stability.config.json explicitly selects JoyZoning architecture."
					: "Workspace policy files opt into JoyZoning structural enforcement.",
		}
	}

	try {
		const entries = fs.readdirSync(cwd, { withFileTypes: true })
		const hasImplementation = entries.some((entry) => {
			if (entry.name.startsWith(".")) return false
			if (entry.isDirectory()) {
				return (
					IMPLEMENTATION_DIRECTORIES.has(entry.name.toLowerCase()) ||
					directoryContainsImplementation(path.join(cwd, entry.name))
				)
			}
			return entry.isFile() && IMPLEMENTATION_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
		})

		if (!hasImplementation) {
			return {
				mode: "greenfield",
				enforceCanonicalLayers: true,
				joyZoningSteering: "canonical",
				steeringThresholds: policyConfig.thresholds,
				reason: "No established implementation structure was detected.",
			}
		}
	} catch {
		return {
			mode: "workspace-native",
			enforceCanonicalLayers: false,
			joyZoningSteering: "blended",
			steeringThresholds: policyConfig.thresholds,
			reason: "Workspace structure could not be inspected; preserve local structure and apply blended JoyZoning steering.",
		}
	}

	return {
		mode: "workspace-native",
		enforceCanonicalLayers: false,
		joyZoningSteering: "blended",
		steeringThresholds: policyConfig.thresholds,
		reason: "An established structure was detected; mirror it while applying blended JoyZoning steering.",
	}
}
