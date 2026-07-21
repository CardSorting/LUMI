import { ModelsApiConfiguration, ApiProvider as ProtoApiProvider } from "@shared/proto/dietcode/models"
import { expect } from "chai"
import { describe, it } from "mocha"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "../api-configuration-conversion"

describe("API configuration protobuf conversion", () => {
	it("round-trips the xai-oauth provider and credential", () => {
		const proto = convertApiConfigurationToProto({
			planModeApiProvider: "xai-oauth",
			actModeApiProvider: "xai-oauth",
			planModeApiModelId: "grok-4",
			actModeApiModelId: "grok-4",
			xaiApiKey: "xai-token",
		})

		expect(proto.planModeApiProvider).to.equal(ProtoApiProvider.XAI_OAUTH)
		expect(proto.actModeApiProvider).to.equal(ProtoApiProvider.XAI_OAUTH)
		expect(proto.xaiApiKey).to.equal("xai-token")

		const wireRoundTrip = ModelsApiConfiguration.fromJSON(ModelsApiConfiguration.toJSON(proto))
		const restored = convertProtoToApiConfiguration(wireRoundTrip)

		expect(restored.planModeApiProvider).to.equal("xai-oauth")
		expect(restored.actModeApiProvider).to.equal("xai-oauth")
		expect(restored.planModeApiModelId).to.equal("grok-4")
		expect(restored.actModeApiModelId).to.equal("grok-4")
		expect(restored.xaiApiKey).to.equal("xai-token")
	})

	it("preserves embedding fields used by partial settings updates", () => {
		const proto = convertApiConfigurationToProto({
			embeddingProvider: "gemini",
			embeddingModelId: "gemini-embedding-2-preview",
			embeddingApiKey: "embedding-token",
			embeddingOpenAiBaseUrl: "https://example.test/v1",
		})
		const restored = convertProtoToApiConfiguration(proto)

		expect(restored).to.include({
			embeddingProvider: "gemini",
			embeddingModelId: "gemini-embedding-2-preview",
			embeddingApiKey: "embedding-token",
			embeddingOpenAiBaseUrl: "https://example.test/v1",
		})
	})

	it("round-trips the Cerebras provider and API key", () => {
		const proto = convertApiConfigurationToProto({
			planModeApiProvider: "cerebras",
			actModeApiProvider: "cerebras",
			planModeApiModelId: "zai-glm-4.7",
			actModeApiModelId: "gpt-oss-120b",
			cerebrasApiKey: "csk-test",
		})

		expect(proto.planModeApiProvider).to.equal(ProtoApiProvider.CEREBRAS)
		expect(proto.actModeApiProvider).to.equal(ProtoApiProvider.CEREBRAS)
		expect(proto.cerebrasApiKey).to.equal("csk-test")

		const wireRoundTrip = ModelsApiConfiguration.fromJSON(ModelsApiConfiguration.toJSON(proto))
		const restored = convertProtoToApiConfiguration(wireRoundTrip)

		expect(restored).to.include({
			planModeApiProvider: "cerebras",
			actModeApiProvider: "cerebras",
			planModeApiModelId: "zai-glm-4.7",
			actModeApiModelId: "gpt-oss-120b",
			cerebrasApiKey: "csk-test",
		})
	})

	it("round-trips the Zai and Qwen Token Plan providers and credentials", () => {
		const proto = convertApiConfigurationToProto({
			planModeApiProvider: "zai",
			actModeApiProvider: "qwen-token-plan",
			zaiApiKey: "zai-key-123",
			zaiApiLine: "china",
			qwenTokenPlanApiKey: "qwen-key-456",
		})

		expect(proto.planModeApiProvider).to.equal(ProtoApiProvider.ZAI)
		expect(proto.actModeApiProvider).to.equal(ProtoApiProvider.QWEN_TOKEN_PLAN)
		expect(proto.zaiApiKey).to.equal("zai-key-123")
		expect(proto.zaiApiLine).to.equal("china")
		expect(proto.qwenTokenPlanApiKey).to.equal("qwen-key-456")

		const wireRoundTrip = ModelsApiConfiguration.fromJSON(ModelsApiConfiguration.toJSON(proto))
		const restored = convertProtoToApiConfiguration(wireRoundTrip)

		expect(restored).to.include({
			planModeApiProvider: "zai",
			actModeApiProvider: "qwen-token-plan",
			zaiApiKey: "zai-key-123",
			zaiApiLine: "china",
			qwenTokenPlanApiKey: "qwen-key-456",
		})
	})
})
