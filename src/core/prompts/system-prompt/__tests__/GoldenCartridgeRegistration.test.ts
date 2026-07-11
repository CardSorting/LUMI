import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { TaskState } from "@core/task/TaskState"
import { GOLDEN_CARTRIDGE_SKILL_NAME } from "@shared/golden-cartridge"
import { ModelFamily } from "@shared/prompts"
import { DietCodeDefaultTool, READ_ONLY_TOOLS } from "@shared/tools"
import { describe, it } from "mocha"
import { activateSkillTools } from "@/core/task/tools/handlers/UseSkillToolHandler"
import { DietCodeToolSet } from "../registry/DietCodeToolSet"
import { toolSpecFunctionDefinition } from "../spec"
import { registerDietCodeToolSets } from "../tools"
import { golden_cartridge_variants } from "../tools/golden_cartridge"
import type { PromptVariant, SystemPromptContext } from "../types"

const variant = {
	family: ModelFamily.GENERIC,
	tools: [DietCodeDefaultTool.PROJECT_MAP],
} as unknown as PromptVariant

const context = (available: boolean): SystemPromptContext =>
	({
		providerInfo: { providerId: "test", model: { id: "test", info: {} } },
		ide: "test",
		goldenCartridgeAvailable: available,
	}) as SystemPromptContext

describe("Golden Cartridge registration", () => {
	it("adds exactly one facade only when available and leaves existing tools unchanged", () => {
		registerDietCodeToolSets()
		const disabled = DietCodeToolSet.getEnabledToolSpecs(variant, context(false)).map((tool) => tool.id)
		const enabled = DietCodeToolSet.getEnabledToolSpecs(variant, context(true)).map((tool) => tool.id)
		assert.deepEqual(disabled, [DietCodeDefaultTool.PROJECT_MAP])
		assert.deepEqual(
			enabled.filter((id) => id !== DietCodeDefaultTool.GOLDEN_CARTRIDGE),
			disabled,
		)
		assert.equal(enabled.filter((id) => id === DietCodeDefaultTool.GOLDEN_CARTRIDGE).length, 1)
	})

	it("activation changes next-context state without mutating an already-created context", () => {
		const taskState = new TaskState()
		const issuedContext = context(taskState.goldenCartridgeActive)
		activateSkillTools(taskState, GOLDEN_CARTRIDGE_SKILL_NAME)
		assert.equal(issuedContext.goldenCartridgeAvailable, false)
		assert.equal(taskState.goldenCartridgeActive, true)
		const nextContext = context(taskState.goldenCartridgeActive)
		assert.equal(nextContext.goldenCartridgeAvailable, true)
	})

	it("activation does not change permission or completion state", () => {
		const taskState = new TaskState()
		const before = {
			didRejectTool: taskState.didRejectTool,
			doubleCheckCompletionPending: taskState.doubleCheckCompletionPending,
			completionLifecycleState: taskState.completionLifecycleState,
		}
		activateSkillTools(taskState, GOLDEN_CARTRIDGE_SKILL_NAME)
		assert.deepEqual(
			{
				didRejectTool: taskState.didRejectTool,
				doubleCheckCompletionPending: taskState.doubleCheckCompletionPending,
				completionLifecycleState: taskState.completionLifecycleState,
			},
			before,
		)
	})

	it("keeps the dependency boundary one-way and does not classify the facade as read-only", () => {
		assert.equal((READ_ONLY_TOOLS as readonly string[]).includes(DietCodeDefaultTool.GOLDEN_CARTRIDGE), false)
		const authorityFiles = [
			"src/core/task/tools/handlers/ProjectMapHandler.ts",
			"src/core/task/tools/handlers/ReadFileToolHandler.ts",
			"src/core/task/tools/handlers/ApplyPatchHandler.ts",
			"src/core/task/tools/handlers/ExecuteCommandToolHandler.ts",
			"src/core/task/tools/handlers/CognitiveMemorySnapshotHandler.ts",
			"src/core/task/tools/handlers/AttemptCompletionHandler.ts",
		]
		for (const file of authorityFiles) {
			const source = readFileSync(resolve(process.cwd(), file), "utf8")
			assert.doesNotMatch(source, /GoldenCartridge|golden-cartridge|golden_cartridge/, file)
		}
	})

	it("keeps the optional native schema compact", () => {
		const nativeSchema = toolSpecFunctionDefinition(golden_cartridge_variants[0], context(true))
		assert.ok(JSON.stringify(nativeSchema).length < 2_500)
	})
})
