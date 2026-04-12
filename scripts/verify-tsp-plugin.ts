import * as path from "path"
import { TspPolicyPlugin } from "../src/core/policy/TspPolicyPlugin"

const plugin = new TspPolicyPlugin()

const mockFiles: Record<string, string> = {
	"src/domain/ValidService.ts": `
		export class ValidService {
			execute() { return "ok" }
		}
	`,
	"src/domain/InvalidDomain.ts": `
		import { UIComponent } from "../ui/Component"
		import * as fs from "fs"

		export class First {}
		export class Second {}

		const x: any = 10
	`,
	"src/infrastructure/Repo.ts": `
		import { View } from "../ui/View"
		const a: any = {}
	`,
	"src/ui/View.ts": `
		import { Repo } from "../infrastructure/Repo"
	`,
	"src/plumbing/Utils.ts": `
		import { ValidService } from "../domain/ValidService"
	`,
	"src/domain/A.ts": `
		import { B } from "./B"
	`,
	"src/domain/B.ts": `
		import { A } from "./A"
	`,
}

function resolveMock(filePath: string): string | undefined {
	const relative = Object.keys(mockFiles).find((k) => filePath.endsWith(k))
	return relative ? mockFiles[relative] : undefined
}

console.log("🚀 Starting TspPolicyPlugin Verification...\n")

for (const [file, content] of Object.entries(mockFiles)) {
	const fullPath = path.resolve(process.cwd(), file)
	const result = plugin.validateSource(fullPath, content, resolveMock)

	console.log(`--- File: ${file} ---`)
	if (result.success) {
		console.log("✅ PASSED")
	} else {
		console.log("❌ FAILED")
		result.errors.forEach((e) => console.log(`   ${e}`))
	}
	console.log("")
}
