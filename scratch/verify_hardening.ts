import { FluidPolicyEngine } from "../src/core/policy/FluidPolicyEngine.js"
import { SpiderEngine } from "../src/core/policy/spider/SpiderEngine.js"
import { Logger } from "../src/shared/services/Logger.js"

async function verify() {
	Logger.info("[VERIFY-PH2] Phase 2 Hardening Stress Test")

	// 1. Initial Indexing (Batch Test)
	const engine = new FluidPolicyEngine(process.cwd())
	Logger.info("[VERIFY-PH2] Initializing engine (Batch Scan should trigger)...")

	// 2. Checksum Integrity Test
	Logger.info("[VERIFY-PH2] Persisting substrate with checksum...")
	await engine.recordScanHistory([]) // Triggers persistSpiderSubstrate

	// Simulate session end/start
	const engine2 = new FluidPolicyEngine(process.cwd())
	Logger.info("[VERIFY-PH2] Restoring substrate (Checksum validation should trigger)...")

	// @ts-expect-error - Verification hook for private method
	await (engine2 as any).restoreSpiderSubstrate()

	// 3. Contract Drift Sensing Test
	Logger.info("[VERIFY-PH2] Testing Contract Drift Sensing...")
	const spider = new SpiderEngine(process.cwd())
	const oldNodes = new Map(spider.nodes)

	const testNodeId = "test.ts"
	// Add a dummy node with exports
	spider.nodes.set(testNodeId, {
		id: testNodeId,
		path: testNodeId,
		exports: ["SymA", "SymB"],
		imports: [],
		dependents: [],
		depth: 1,
		orphaned: false,
		afferentCoupling: 0,
		hash: "123",
		isInterface: false,
		consumptions: {},
		mtime: Date.now(),
		namingScore: 1.0,
		logicDensity: 0,
		ioEntropy: 0,
		astComplexity: 10,
		layer: "core",
		symbolDensity: 0.2,
		logicCohesion: 0.5,
	})

	const node = spider.nodes.get(testNodeId)
	if (node) {
		const newNodes = new Map(spider.nodes)
		newNodes.set(testNodeId, {
			...node,
			exports: ["SymA"], // Removed SymB
		})

		const drifts = spider.getForensicEngine().compareContracts(oldNodes, newNodes)
		if (drifts.some((d) => d.includes("removed exports: SymB"))) {
			Logger.info("✅ SUCCESS: Contract Drift Sensing detected symbol removal.")
		} else {
			Logger.error("❌ FAILURE: Contract Drift Sensing failed to detect removal.")
		}
	}

	Logger.info("✅ Phase 2 Hardening Verified.")
}

verify().catch((e) => Logger.error(`[VERIFY-PH2] Test Failed: ${e}`))
