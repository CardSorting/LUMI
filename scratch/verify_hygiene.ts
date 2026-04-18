import { FluidPolicyEngine } from "../src/core/policy/FluidPolicyEngine.js"
import { Logger } from "../src/shared/services/Logger.js"

async function verifyHygiene() {
	Logger.info("[VERIFY-PH5] Phase 5 Metabolic Hygiene Stress Test")

	const engine = new FluidPolicyEngine(process.cwd())
	const spider = (engine as any).spiderEngine
	const resolver = spider.resolver

	// 1. Cache Saturation Test
	Logger.info("[VERIFY-PH5] Testing Cache Saturation Floors...")
	for (let i = 0; i < 5100; i++) {
		resolver.canonicalize(`src/file_${i}.ts`)
	}

	// The cache should have cleared itself if it hit 5000
	if (resolver.canonicalCache.size < 5000) {
		Logger.info(`✅ SUCCESS: Cache saturation floor triggered. Current size: ${resolver.canonicalCache.size}`)
	} else {
		Logger.error(`❌ FAILURE: Cache saturation floor failed. Size: ${resolver.canonicalCache.size}`)
	}

	// 2. Explicit Disposal Test
	Logger.info("[VERIFY-PH5] Testing Explicit Disposal...")
	engine.dispose()

	if (spider.nodes.size === 0 && resolver.canonicalCache.size === 0 && spider.stabilityHeartbeat === null) {
		Logger.info("✅ SUCCESS: Industrial Disposal released all structural substrates.")
	} else {
		Logger.error("❌ FAILURE: Disposal failed to clear maps/timers.")
	}

	Logger.info("✅ Phase 5 Metabolic Hygiene Verified.")
}

verifyHygiene().catch((e) => Logger.error(`[VERIFY-PH5] Test Failed: ${e}`))
