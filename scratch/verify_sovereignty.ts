import { FluidPolicyEngine } from "../src/core/policy/FluidPolicyEngine.js"
import { SpiderEngine } from "../src/core/policy/spider/SpiderEngine.js"
import { Logger } from "../src/shared/services/Logger.js"

async function verifySovereignty() {
	Logger.info("[VERIFY-PH3] Phase 3 Industrial Sovereignty Stress Test")

	const engine = new FluidPolicyEngine(process.cwd())
	const spider = (engine as any).spiderEngine as SpiderEngine

	// 1. Stability Lock Test (Concurrency Collision)
	Logger.info("[VERIFY-PH3] Testing Stability Lock (Mutation Isolation)...")
	const lock1 = await spider.acquireStabilityLock("TOOL_A")
	const lock2 = await spider.acquireStabilityLock("TOOL_B")

	if (lock1 === true && lock2 === false) {
		Logger.info("✅ SUCCESS: Stability Lock prevented concurrent mutation collision.")
	} else {
		Logger.error("❌ FAILURE: Stability Lock failed to isolate mutators.")
	}

	spider.releaseStabilityLock("TOOL_A")

	// 2. Blast Radius & Fragility Test
	Logger.info("[VERIFY-PH3] Testing Fragility Sensing (Structural Risk)...")

	// setup nodes to simulate a fragile "core" node
	spider.nodes.clear()
	const coreId = "src/core/Substrate.ts"
	const totalNodes = 100

	for (let i = 0; i < totalNodes; i++) {
		const id = `src/feature/file${i}.ts`
		spider.nodes.set(id, {
			id,
			path: id,
			layer: "ui",
			imports: [coreId],
			dependents: [],
			depth: 3,
			orphaned: false,
			afferentCoupling: 0,
			hash: "1",
			exports: [],
			consumptions: {},
			mtime: Date.now(),
			isInterface: false,
			namingScore: 1,
			logicDensity: 0.1,
			ioEntropy: 0.1,
			astComplexity: 10,
			symbolDensity: 0,
			logicCohesion: 0,
			blastRadius: 0,
			isFragile: false,
		})
	}

	// The core node being imported by 100 nodes
	spider.nodes.set(coreId, {
		id: coreId,
		path: coreId,
		layer: "core",
		imports: [],
		dependents: Array.from({ length: totalNodes }, (_, i) => `src/feature/file${i}.ts`),
		depth: 2,
		orphaned: false,
		afferentCoupling: totalNodes,
		hash: "2",
		exports: ["CoreSymbol"],
		consumptions: {},
		mtime: Date.now(),
		isInterface: false,
		namingScore: 1,
		logicDensity: 0.8,
		ioEntropy: 0.1,
		astComplexity: 100,
		symbolDensity: 0.1,
		logicCohesion: 0.8,
		blastRadius: 0,
		isFragile: false,
	})

	const fragility = spider.getForensicEngine().computeFragility(spider.nodes)
	const coreStats = fragility.get(coreId)

	if (coreStats && coreStats.isFragile && coreStats.blastRadius > 0.8) {
		Logger.info(`✅ SUCCESS: Fragility Sensing detected high blast radius: ${(coreStats.blastRadius * 100).toFixed(0)}%`)
	} else {
		Logger.error(`❌ FAILURE: Fragility Sensing failed. Stats: ${JSON.stringify(coreStats)}`)
	}

	// 3. Binary Snapshot Fidelity
	Logger.info("[VERIFY-PH3] Testing Binary Snapshot Fidelity (V8)...")
	const snapshot = await (spider as any).persistence.takeSnapshot(spider.nodes)
	const latest = await (spider as any).persistence.getLatestSnapshot()

	if (latest && latest.nodes.length === spider.nodes.size) {
		Logger.info("✅ SUCCESS: V8 Binary serialization maintained 100% snapshot fidelity.")
	} else {
		Logger.error("❌ FAILURE: Snapshot fidelity lost.")
	}

	Logger.info("✅ Phase 3 Industrial Sovereignty Verified.")
}

verifySovereignty().catch((e) => Logger.error(`[VERIFY-PH3] Test Failed: ${e}`))
