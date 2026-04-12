import * as disk from "@core/storage/disk"
import axios from "axios"
import { expect } from "chai"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { CodemarieEnv, Environment } from "@/config"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { CODEMARIE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/codemarie/recommended-models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import {
	refreshCodemarieRecommendedModels,
	resetCodemarieRecommendedModelsCacheForTests,
} from "../refreshCodemarieRecommendedModels"

describe("refreshCodemarieRecommendedModels", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		resetCodemarieRecommendedModelsCacheForTests()
		sandbox.stub(Logger, "log")
		sandbox.stub(Logger, "error")
	})

	afterEach(() => {
		resetCodemarieRecommendedModelsCacheForTests()
		sandbox.restore()
	})

	it("returns hardcoded models and skips upstream fetch when rollout flag is off", async () => {
		sandbox.stub(getFeatureFlagsService(), "getBooleanFlagEnabled").returns(false)
		const axiosGetStub = sandbox.stub(axios, "get")

		const result = await refreshCodemarieRecommendedModels()

		expect(result).to.deep.equal(CODEMARIE_RECOMMENDED_MODELS_FALLBACK)
		expect(axiosGetStub.called).to.equal(false)
	})

	it("fetches from upstream when rollout flag is on", async () => {
		sandbox.stub(getFeatureFlagsService(), "getBooleanFlagEnabled").callsFake((flag) => {
			return flag === FeatureFlag.CODEMARIE_RECOMMENDED_MODELS_UPSTREAM
		})
		sandbox.stub(CodemarieEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.codemarie-mock.bot",
			apiBaseUrl: "https://api.codemarie-mock.bot",
			mcpBaseUrl: "https://api.codemarie-mock.bot/v1/mcp",
		})
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp")
		sandbox.stub(fs, "writeFile").resolves()
		const axiosGetStub = sandbox.stub(axios, "get").resolves({
			data: {
				recommended: [{ id: "anthropic/claude-sonnet-4.6", description: "Remote recommended", tags: ["NEW"] }],
				free: [{ id: "z-ai/glm-5", description: "Remote free" }],
			},
		})

		const result = await refreshCodemarieRecommendedModels()

		expect(axiosGetStub.calledOnce).to.equal(true)
		expect(result).to.deep.equal({
			recommended: [
				{
					id: "anthropic/claude-sonnet-4.6",
					name: "anthropic/claude-sonnet-4.6",
					description: "Remote recommended",
					tags: ["NEW"],
				},
			],
			free: [
				{
					id: "z-ai/glm-5",
					name: "z-ai/glm-5",
					description: "Remote free",
					tags: [],
				},
			],
		})
	})

	it("uses hardcoded models when rollout flag is turned off after upstream cache is populated", async () => {
		const flagStub = sandbox.stub(getFeatureFlagsService(), "getBooleanFlagEnabled")
		flagStub.onFirstCall().returns(true)
		flagStub.onSecondCall().returns(false)
		sandbox.stub(CodemarieEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.codemarie-mock.bot",
			apiBaseUrl: "https://api.codemarie-mock.bot",
			mcpBaseUrl: "https://api.codemarie-mock.bot/v1/mcp",
		})
		sandbox.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp")
		sandbox.stub(fs, "writeFile").resolves()
		const axiosGetStub = sandbox.stub(axios, "get").resolves({
			data: {
				recommended: [{ id: "google/gemini-3.1-pro-preview", description: "Remote recommended", tags: ["NEW"] }],
				free: [{ id: "minimax/minimax-m2.5", description: "Remote free", tags: ["FREE"] }],
			},
		})

		const firstResult = await refreshCodemarieRecommendedModels()
		const secondResult = await refreshCodemarieRecommendedModels()

		expect(axiosGetStub.calledOnce).to.equal(true)
		expect(firstResult).to.not.deep.equal(CODEMARIE_RECOMMENDED_MODELS_FALLBACK)
		expect(secondResult).to.deep.equal(CODEMARIE_RECOMMENDED_MODELS_FALLBACK)
	})
})
