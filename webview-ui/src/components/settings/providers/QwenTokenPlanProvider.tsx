import { qwenTokenPlanModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { ArrowRight, Check, CheckCircle2, Copy, Gift, ShieldCheck, Sparkles, Tag, Zap } from "lucide-react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

const PROMO_URL = "https://www.qwencloud.com/benefits/tokenplan?shareCode=subTask..68562019..12.."
const SHARE_CODE = "subTask..68562019..12.."

/**
 * Props for the QwenTokenPlanProvider component
 */
interface QwenTokenPlanProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Qwen Token Plan (Team Edition) provider configuration component.
 * Uses the compatible-mode OpenAI endpoint at:
 *   https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
 */
export const QwenTokenPlanProvider = ({ showModelOptions, isPopup, currentMode }: QwenTokenPlanProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [copied, setCopied] = useState(false)

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleCopyCode = () => {
		navigator.clipboard.writeText(SHARE_CODE)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="flex flex-col gap-3">
			<ApiKeyField
				initialValue={apiConfiguration?.qwenTokenPlanApiKey || ""}
				onChange={(value) => handleFieldChange("qwenTokenPlanApiKey", value)}
				providerName="Qwen Token Plan (Team Edition)"
				signupUrl={PROMO_URL}
			/>

			{/* World-Class Promotional CTA Card */}
			<div
				style={{
					background:
						"linear-gradient(135deg, rgba(99, 102, 241, 0.14) 0%, rgba(168, 85, 247, 0.14) 50%, rgba(236, 72, 153, 0.14) 100%)",
					border: "1px solid rgba(168, 85, 247, 0.4)",
					boxShadow: "0 4px 14px rgba(0, 0, 0, 0.09)",
					borderRadius: "8px",
					padding: "14px 16px",
					display: "flex",
					flexDirection: "column",
					gap: "10px",
					position: "relative",
					overflow: "hidden",
				}}>
				{/* Top Badge & Header */}
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
						<Gift style={{ width: 16, height: 16, color: "#a855f7" }} />
						<span
							style={{
								fontSize: "11px",
								fontWeight: 700,
								letterSpacing: "0.6px",
								textTransform: "uppercase",
								color: "var(--vscode-textPreformat-foreground, #a855f7)",
							}}>
							Limited-Time Offer
						</span>
					</div>
					<span
						style={{
							fontSize: "10px",
							fontWeight: 700,
							padding: "3px 8px",
							borderRadius: "12px",
							backgroundColor: "rgba(168, 85, 247, 0.25)",
							color: "var(--vscode-badge-foreground, #fff)",
							display: "inline-flex",
							alignItems: "center",
							gap: "4px",
							border: "1px solid rgba(168, 85, 247, 0.3)",
						}}>
						<Tag style={{ width: 11, height: 11 }} /> $4 OFF FIRST MONTH
					</span>
				</div>

				{/* Offer Title & Summary */}
				<div>
					<h4
						style={{
							margin: 0,
							fontSize: "14px",
							fontWeight: 700,
							color: "var(--vscode-foreground)",
							display: "flex",
							alignItems: "center",
							gap: "6px",
						}}>
						<Zap style={{ width: 15, height: 15, color: "#eab308" }} /> Unlock Qwen Token Plan
					</h4>
					<p
						style={{
							margin: "4px 0 0 0",
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							lineHeight: "1.45",
						}}>
						Get high-throughput access to Qwen 3 Coder flagship models. Enjoy high rate limits and dedicated context
						processing.
					</p>
				</div>

				{/* Key Benefits List */}
				<div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "2px" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "6px",
							fontSize: "11px",
							color: "var(--vscode-foreground)",
						}}>
						<CheckCircle2 style={{ width: 13, height: 13, color: "#22c55e", flexShrink: 0 }} />
						<span>
							<strong>256K Context Window</strong> for deep repository awareness
						</span>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "6px",
							fontSize: "11px",
							color: "var(--vscode-foreground)",
						}}>
						<CheckCircle2 style={{ width: 13, height: 13, color: "#22c55e", flexShrink: 0 }} />
						<span>
							<strong>Flagship MoE Architecture</strong> optimized for code & reasoning
						</span>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "6px",
							fontSize: "11px",
							color: "var(--vscode-foreground)",
						}}>
						<CheckCircle2 style={{ width: 13, height: 13, color: "#22c55e", flexShrink: 0 }} />
						<span>
							<strong>Instant $4 Discount</strong> auto-applied with referral code
						</span>
					</div>
				</div>

				{/* Share / Promo Code Bar */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						backgroundColor: "rgba(0, 0, 0, 0.15)",
						borderRadius: "5px",
						padding: "4px 8px",
						marginTop: "2px",
						border: "1px dashed rgba(168, 85, 247, 0.35)",
					}}>
					<span style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)" }}>
						Share Code: <code style={{ fontSize: "10px", fontWeight: 600 }}>{SHARE_CODE.slice(0, 18)}...</code>
					</span>
					<button
						onClick={handleCopyCode}
						style={{
							background: "none",
							border: "none",
							color: "var(--vscode-textLink-foreground)",
							cursor: "pointer",
							fontSize: "10px",
							fontWeight: 600,
							display: "flex",
							alignItems: "center",
							gap: "3px",
							padding: 0,
						}}
						type="button">
						{copied ? (
							<Check style={{ width: 11, height: 11, color: "#22c55e" }} />
						) : (
							<Copy style={{ width: 11, height: 11 }} />
						)}
						{copied ? "Copied!" : "Copy Code"}
					</button>
				</div>

				{/* Action CTA Link / Button */}
				<a
					href={PROMO_URL}
					rel="noreferrer"
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "8px",
						backgroundColor: "var(--vscode-button-background)",
						color: "var(--vscode-button-foreground)",
						padding: "8px 14px",
						borderRadius: "6px",
						fontSize: "12px",
						fontWeight: 700,
						textDecoration: "none",
						marginTop: "4px",
						boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
						transition: "all 0.15s ease",
					}}
					target="_blank">
					<Sparkles style={{ width: 14, height: 14 }} /> Claim $4 Discount & Sign Up{" "}
					<ArrowRight style={{ width: 14, height: 14 }} />
				</a>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					fontSize: "11px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				<ShieldCheck style={{ width: 13, height: 13, color: "#3b82f6" }} />
				<span>
					OpenAI Compatible Mode:{" "}
					<code style={{ fontSize: "10px" }}>
						https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
					</code>
				</span>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={qwenTokenPlanModels}
						onChange={(e: { target: { value: string } }) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />

					<p
						style={{
							fontSize: "12px",
							marginTop: 3,
							color: "var(--vscode-descriptionForeground)",
						}}>
						Enter any supported model ID directly, e.g. <code style={{ fontSize: "11px" }}>qwen3-7b-max</code> or{" "}
						<code style={{ fontSize: "11px" }}>Qwen3.8-Max-Preview</code>.
					</p>
				</>
			)}
		</div>
	)
}
