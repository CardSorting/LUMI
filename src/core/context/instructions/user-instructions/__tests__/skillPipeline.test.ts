import * as assert from "assert"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { DEFAULT_ROADMAP_CONFIG, setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { validationPendingEnvelope } from "@/services/roadmap/RoadmapErrors"
import { blockingClosedGates, evaluateGateChecks } from "@/services/roadmap/RoadmapGateCatalog"
import { recommendNextAction } from "@/services/roadmap/RoadmapOperator"
import { BUNDLED_SKILL_NAME, setRoadmapExtensionRoot } from "@/services/roadmap/RoadmapSkillInstall"
import { BUNDLED_SKILL_URI_PREFIX } from "@/shared/skills"
import { ROADMAP_SKILL_EXECUTION_DIGEST } from "../roadmapSkillDigest"
import {
	filterEnabledSkills,
	filterPromptSkills,
	filterSubagentPromptSkills,
	getResolvedSkillsForCwd,
	getSkillsCacheMetrics,
	invalidateSkillsCache,
	resetSkillsCacheMetrics,
} from "../skillRuntime"
import { getSkillContent } from "../skills"

describe("Skill pipeline hardening", () => {
	let tmpRoot: string

	beforeEach(async () => {
		resetSkillsCacheMetrics()
		invalidateSkillsCache()
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-pipeline-"))
		setRoadmapExtensionRoot(tmpRoot)
		await fs.mkdir(path.join(tmpRoot, "optional-skills", "dietcode", "auto-rolling-roadmap"), { recursive: true })
		await fs.writeFile(
			path.join(tmpRoot, "optional-skills", "dietcode", "auto-rolling-roadmap", "SKILL.md"),
			`---
name: auto-rolling-roadmap
description: Roadmap steering skill
---

# Full reference body
${"x".repeat(5000)}
`,
			"utf8",
		)
		setRoadmapConfigOverride({ enabled: true, auto_install_skills: true })
	})

	afterEach(() => {
		setRoadmapConfigOverride(null)
		invalidateSkillsCache()
		sinon.restore()
	})

	it("does not load full roadmap SKILL.md during normal digest execution", async () => {
		const bundled = {
			name: BUNDLED_SKILL_NAME,
			description: "d",
			path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
			source: "bundled" as const,
		}
		const content = await getSkillContent(BUNDLED_SKILL_NAME, [bundled], { mode: "digest" })
		assert.ok(content)
		assert.strictEqual(content!.instructions, ROADMAP_SKILL_EXECUTION_DIGEST)
		assert.doesNotMatch(content!.instructions, /Full reference body/)
		assert.ok(content!.instructions.length < 2000, "digest must stay lean vs 900+ line reference")
	})

	it("loads full roadmap SKILL.md only when full_reference mode requested", async () => {
		const bundled = {
			name: BUNDLED_SKILL_NAME,
			description: "d",
			path: `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`,
			source: "bundled" as const,
		}
		const content = await getSkillContent(BUNDLED_SKILL_NAME, [bundled], { mode: "full" })
		assert.ok(content)
		assert.match(content!.instructions, /Full reference body/)
		assert.ok(content!.instructions.length > ROADMAP_SKILL_EXECUTION_DIGEST.length)
	})

	it("excludes bundled roadmap from prompt skills when steering is active", async () => {
		const skills = await getResolvedSkillsForCwd(tmpRoot)
		const promptSkills = filterPromptSkills(skills)
		assert.strictEqual(
			promptSkills.some((s) => s.name === BUNDLED_SKILL_NAME),
			false,
			"bundled roadmap must not appear in SKILLS when ROADMAP_STEERING is active",
		)
	})

	it("excludes disabled bundled skills via stable toggle key", async () => {
		const skills = await getResolvedSkillsForCwd(tmpRoot)
		const uriKey = `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`
		const enabled = filterEnabledSkills(skills, {}, {})
		assert.ok(enabled.some((s) => s.name === BUNDLED_SKILL_NAME))
		const disabled = filterEnabledSkills(skills, { [uriKey]: false }, {})
		assert.strictEqual(
			disabled.some((s) => s.name === BUNDLED_SKILL_NAME),
			false,
		)
	})

	it("reuses skill discovery cache across API turns", async () => {
		await getResolvedSkillsForCwd(tmpRoot)
		await getResolvedSkillsForCwd(tmpRoot)
		const metrics = getSkillsCacheMetrics()
		assert.ok(metrics.hits >= 1, "expected cache hit on second resolve")
	})

	it("invalidates cache on explicit invalidateSkillsCache", async () => {
		await getResolvedSkillsForCwd(tmpRoot)
		invalidateSkillsCache(tmpRoot)
		resetSkillsCacheMetrics()
		await getResolvedSkillsForCwd(tmpRoot)
		assert.strictEqual(getSkillsCacheMetrics().misses, 1)
	})

	it("subagent prompt skills exclude bundled roadmap when steering active", async () => {
		const skills = await getResolvedSkillsForCwd(tmpRoot)
		const subagentSkills = filterSubagentPromptSkills(skills)
		assert.strictEqual(
			subagentSkills.some((s) => s.name === BUNDLED_SKILL_NAME),
			false,
		)
	})

	it("validation_pending recommendNextAction does not prescribe validate/doctor/cockpit rituals", () => {
		const rec = recommendNextAction({ validation_pending: true, roadmap_exists: true })
		assert.strictEqual(rec.action, "continue_task")
		assert.doesNotMatch(rec.command, /roadmap\(action=['"]validate|doctor|cockpit/i)
	})

	it("validationPendingEnvelope does not prescribe doctor or validate tool calls", () => {
		const env = validationPendingEnvelope("/tmp/project")
		assert.doesNotMatch(env.diagnostic_command, /doctor/)
		assert.doesNotMatch(env.retry_command, /roadmap\(action=['"]validate/)
	})

	it("informational skill gates do not block completion", () => {
		const { closed } = evaluateGateChecks({
			config: DEFAULT_ROADMAP_CONFIG,
			workspace: tmpRoot,
			roadmap_path: path.join(tmpRoot, "ROADMAP.md"),
			roadmap_present: true,
			validation: { valid: true, schema_complete: true, code_soup_risk: "Low", now_item_count: 1, issues: [] },
			freshness: { stale: false },
			workspace_state: { validation_pending: false },
			bootstrap_complete: true,
			bootstrap_placeholder_count: 0,
			project_fingerprint: {},
			evidence_roadmap: {},
		})
		assert.strictEqual(
			closed.some((g) => g.id === "workspace_skill_installed"),
			false,
			"workspace_skill_installed must not exist as a gate",
		)
		const blocking = blockingClosedGates(closed, DEFAULT_ROADMAP_CONFIG)
		assert.strictEqual(
			blocking.some((g) => g.id.includes("skill")),
			false,
		)
	})

	it("resolves bundled skill from extension optional-skills path in dev layout", async () => {
		const skills = await getResolvedSkillsForCwd(tmpRoot)
		const bundled = skills.find((s) => s.name === BUNDLED_SKILL_NAME)
		assert.ok(bundled)
		assert.strictEqual(bundled!.path, `${BUNDLED_SKILL_URI_PREFIX}${BUNDLED_SKILL_NAME}`)
		assert.strictEqual(bundled!.source, "bundled")
	})
})
