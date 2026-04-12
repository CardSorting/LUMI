import { hrtime } from "node:process"
import { initializeCli } from "./src/index.js" // This might not work if not built, or I can use the dist

async function profile(name, fn) {
	const start = hrtime.bigint()
	const result = await fn()
	const end = hrtime.bigint()
	console.log(`${name}: ${Number(end - start) / 1_000_000}ms`)
	return result
}

// Mock some things to avoid side effects if possible
async function run() {
	process.env.IS_DEV = "true"
	console.log("--- Profiling initializeCli ---")
	try {
		await profile("initializeCli", () => initializeCli({ verbose: false }))
	} catch (e) {
		console.error("Error during profile:", e)
	}
	console.log("-------------------------------")
	process.exit(0)
}

run()
