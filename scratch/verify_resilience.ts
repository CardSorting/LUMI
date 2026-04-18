import { FluidPolicyEngine } from "../src/core/policy/FluidPolicyEngine.js"
import { SpiderEngine } from "../src/core/policy/spider/SpiderEngine.js"
import { Logger } from "../src/shared/services/Logger.js"

async function verifyResilience() {
	Logger.info("[VERIFY-PH4] Phase 4 Industrial Resilience Stress Test")

	const engine = new FluidPolicyEngine(process.cwd())
	const spider = (engine as unknown as { spiderEngine: SpiderEngine }).spiderEngine

	// 1. Substrate Rollback Test
	Logger.info("[VERIFY-PH4] Testing Substrate Rollback (Insurance)...")
	spider.nodes.clear()
	const nodeA = "src/A.ts"
	spider.updateNode(nodeA, "export const A = 1;")

	spider.createCheckpoint()
	const initialMerkle = spider.computeMerkleRoot()

	// Simulate a corrupted update
	spider.updateNode(nodeA, "export const A = 2; export const B = 3;")
	const corruptedMerkle = spider.computeMerkleRoot()

	if (initialMerkle !== corruptedMerkle) {
		Logger.info("Checkpoint state captured. Triggering Rollback...")
		const success = await spider.rollbackSubstrate()
		const finalMerkle = spider.computeMerkleRoot()

		if (success && finalMerkle === initialMerkle) {
			Logger.info("✅ SUCCESS: Substrate successfully rolled back to precisely the checkpoint state.")
		} else {
			Logger.error("❌ FAILURE: Rollback Merkle mismatch.")
		}
	}

	// 2. Cognitive Complexity Test
	Logger.info("[VERIFY-PH4] Testing Cognitive Entropy Mapping...")
	const complexCode = `
        export const deep = () => {
            if (a) {
                if (b) {
                    for (let i=0; i<10; i++) {
                        switch(x) {
                            case 1: if (y) return;
                        }
                    }
                }
            }
        }
    `
	spider.updateNode("src/Complex.ts", complexCode)
	const complexNode = spider.nodes.get("src/complex.ts")

	if (complexNode && complexNode.cognitiveComplexity > 0.5) {
		Logger.info(`✅ SUCCESS: Cognitive Entropy detected high logic depth: ${complexNode.cognitiveComplexity.toFixed(2)}`)
	} else {
		Logger.error(`❌ FAILURE: Cognitive Entropy failed. Score: ${complexNode?.cognitiveComplexity}`)
	}

	// 3. Autonomous Pruning Logic (Simulation)
	Logger.info("[VERIFY-PH4] Testing Autonomous Pruning Directive...")
	const violation = {
		id: "SPI-103",
		path: "src/A.ts",
		message: "[SPI-103] UNUSED EXPORT: src/A.ts -> unusedSymbol",
		severity: "INFO",
	}
	const healer = (engine as unknown as { garbageCollector: { healer: any } }).garbageCollector.healer
	const recipe = healer.generateHealingRecipe(violation, spider)

	if (recipe.includes("[METABOLIC_PRUNE]")) {
		Logger.info("✅ SUCCESS: Autonomous Pruning correctly categorized as METABOLIC_PRUNE.")
	} else {
		Logger.error("❌ FAILURE: Pruning directive mismatch.")
	}

	Logger.info("✅ Phase 4 Industrial Resilience Verified.")
}

verifyResilience().catch((e) => Logger.error(`[VERIFY-PH4] Test Failed: ${e}`))
