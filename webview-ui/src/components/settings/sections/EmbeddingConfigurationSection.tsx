import { ApiProvider } from "@shared/api"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface EmbeddingConfigurationSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
}

const EmbeddingConfigurationSection = ({ renderSectionHeader }: EmbeddingConfigurationSectionProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const { embeddingProvider, embeddingModelId, embeddingApiKey, embeddingOpenAiBaseUrl } = apiConfiguration || {}

	return (
		<div>
			{renderSectionHeader?.("embedding-config")}
			<Section>
				<div className="flex flex-col gap-4">
					<p className="text-xs text-(--vscode-descriptionForeground)">
						Configure the model used for generating embeddings in the Knowledge Graph. This is essential for semantic
						search and memory traversal.
					</p>

					<div className="flex flex-col gap-2">
						<label htmlFor="embedding-provider">
							<span style={{ fontWeight: 500 }}>Embedding Provider</span>
						</label>
						<VSCodeDropdown
							id="embedding-provider"
							onChange={(e: any) => {
								handleFieldsChange({ embeddingProvider: e.target.value as ApiProvider })
							}}
							style={{ width: "100%" }}
							value={embeddingProvider || "gemini"}>
							<VSCodeOption value="gemini">Google Gemini</VSCodeOption>
							<VSCodeOption value="openai">OpenAI</VSCodeOption>
						</VSCodeDropdown>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="embedding-model-id">
							<span style={{ fontWeight: 500 }}>Model ID</span>
						</label>
						<VSCodeTextField
							id="embedding-model-id"
							onInput={(e: any) => {
								handleFieldsChange({ embeddingModelId: e.target.value })
							}}
							placeholder={embeddingProvider === "openai" ? "text-embedding-3-small" : "gemini-embedding-2-preview"}
							style={{ width: "100%" }}
							value={
								embeddingModelId ||
								(embeddingProvider === "openai" ? "text-embedding-3-small" : "gemini-embedding-2-preview")
							}
						/>
					</div>

					{embeddingProvider === "openai" && (
						<div className="flex flex-col gap-2">
							<label htmlFor="embedding-base-url">
								<span style={{ fontWeight: 500 }}>OpenAI Base URL (Optional)</span>
							</label>
							<VSCodeTextField
								id="embedding-base-url"
								onInput={(e: any) => {
									handleFieldsChange({ embeddingOpenAiBaseUrl: e.target.value })
								}}
								placeholder="https://api.openai.com/v1"
								style={{ width: "100%" }}
								value={embeddingOpenAiBaseUrl || ""}
							/>
						</div>
					)}

					<div className="flex flex-col gap-2">
						<label htmlFor="embedding-api-key">
							<span style={{ fontWeight: 500 }}>Embedding API Key (Optional)</span>
						</label>
						<VSCodeTextField
							id="embedding-api-key"
							onInput={(e: any) => {
								handleFieldsChange({ embeddingApiKey: e.target.value })
							}}
							placeholder="Leave empty to use default provider key"
							style={{ width: "100%" }}
							type="password"
							value={embeddingApiKey || ""}
						/>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							If provided, this key will be used specifically for embedding requests. Otherwise, the primary API key
							for the selected provider will be used.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default EmbeddingConfigurationSection
