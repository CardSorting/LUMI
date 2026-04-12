import { StorageService } from "../broccolidb/infrastructure/storage/StorageService.js"

async function testCAS() {
	console.log("--- TEST: Content-Addressable Storage (Deduplication) ---")

	const mockCtx: any = {
		workspace: { workspacePath: "./test_workspace" },
	}

	const storage = new StorageService(mockCtx)
	const content = "Sovereign Swarm Memory Content"

	console.log("[Test] Writing identical content twice...")
	const hash1 = await storage.writeBlob(content)
	const hash2 = await storage.writeBlob(content)

	console.log(`[Test] Hash 1: ${hash1}`)
	console.log(`[Test] Hash 2: ${hash2}`)

	if (hash1 === hash2) {
		console.log("✅ SUCCESS: Content deduplicated safely.")
	} else {
		console.error("❌ FAILURE: Hashes mismatched for identical content.")
	}

	const retrieved = await storage.readBlob(hash1)
	if (retrieved?.toString() === content) {
		console.log("✅ SUCCESS: Content retrieved correctly from CAS.")
	} else {
		console.error("❌ FAILURE: Content mismatch on retrieval.")
	}

	console.log("--- CAS TESTS COMPLETE ---")
}

testCAS().catch(console.error)
