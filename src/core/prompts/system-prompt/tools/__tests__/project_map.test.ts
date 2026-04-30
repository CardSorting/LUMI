import { expect } from "chai"
import { DietCodeDefaultTool, READ_ONLY_TOOLS } from "@/shared/tools"
import { project_map_variants } from "../project_map"

describe("project_map tool spec", () => {
	it("registers project_map as a read-only planning tool", () => {
		expect(READ_ONLY_TOOLS).to.include(DietCodeDefaultTool.PROJECT_MAP)
	})

	it("exposes the expected optional planning inputs", () => {
		const spec = project_map_variants[0]
		const params = new Map(spec.parameters?.map((param) => [param.name, param]))

		expect(spec.id).to.equal(DietCodeDefaultTool.PROJECT_MAP)
		expect(spec.name).to.equal("project_map")
		expect(spec.description).to.include("Project Map")
		expect(spec.description).to.include("choices")
		for (const name of ["query", "path", "symbol", "maxFiles", "includeEvidence"]) {
			expect(params.get(name), `missing ${name}`).to.exist
			expect(params.get(name)?.required).to.equal(false)
		}
		expect(params.get("includeEvidence")?.type).to.equal("boolean")
	})
})
