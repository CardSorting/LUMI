import { EnvironmentSovereignty } from "../src/core/integrity/EnvironmentSovereignty"

async function benchmark() {
	console.log("🚀 Starting SEP Benchmark...")
	const es = new EnvironmentSovereignty(process.cwd())

	// 1. Fingerprint Test
	const start = performance.now()
	for (let i = 0; i < 1000; i++) {
		es.getFingerprint()
	}
	const end = performance.now()
	console.log(`✅ 1000 Fingerprints: ${(end - start).toFixed(2)}ms (Avg: ${((end - start) / 1000).toFixed(4)}ms each)`)

	// 2. Full Probe Test
	console.log("\n🧪 Running Full Probe...")
	const probeStart = performance.now()
	const lease1 = await es.validateEnvironment()
	const probeEnd = performance.now()
	console.log(`✅ Full Probe: ${(probeEnd - probeStart).toFixed(2)}ms`)
	console.log("Lease Details:", JSON.stringify(lease1.details, null, 2))

	// 3. Cached Check Test
	console.log("\n🧪 Running Cached Check...")
	const cacheStart = performance.now()
	const lease2 = await es.validateEnvironment()
	const cacheEnd = performance.now()
	console.log(`✅ Cached Check: ${(cacheEnd - cacheStart).toFixed(2)}ms`)

	if (lease2.fingerprint === lease1.fingerprint) {
		console.log("✅ Fingerprint stability confirmed.")
	}
}

benchmark().catch(console.error)
