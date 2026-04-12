import { CompactService } from "../broccolidb/core/agent-context/CompactService.js"

async function testCompaction() {
	console.log("--- TEST: Context Compaction (Snipping) ---")

	const mockCtx: any = {
		aiService: {
			completeOneOff: async () => ({ text: "Summary of the technical discussion on auth flow." }),
		},
		workspace: { workspacePath: "/tmp" },
	}

	const compactor = new CompactService(mockCtx)

	const messages: any[] = Array.from({ length: 20 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `Message ${i} about some deep technical logic...`,
		uuid: `msg-${i}`,
	}))

	const result = await compactor.compactHistory(messages)

	if (result && result.keptMessages.length === 6) {
		console.log("✅ SUCCESS: Kept correct number of messages (30%).")
	} else {
		console.error("❌ FAILURE: Incorrect number of kept messages.", result?.keptMessages.length)
	}

	if (result?.boundaryMetadata.preservedSegment) {
		console.log("✅ SUCCESS: Relink metadata (preservedSegment) generated.")
		console.log("Boundary Metadata:", JSON.stringify(result.boundaryMetadata, null, 2))
	} else {
		console.error("❌ FAILURE: Missing relink metadata.")
	}

	const mediaStripped = compactor.stripMedia('Check this image: ![img](http://ex.com) and <img src="foo">')
	if (mediaStripped === "Check this image: [image] and [image]") {
		console.log("✅ SUCCESS: Media stripped correctly.")
	} else {
		console.error("❌ FAILURE: Media not stripped correctly:", mediaStripped)
	}

	console.log("--- COMPACTION TESTS COMPLETE ---")
}

testCompaction().catch(console.error)
