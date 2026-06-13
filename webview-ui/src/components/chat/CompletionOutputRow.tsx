import { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Int64Request } from "@shared/proto/dietcode/common"
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, ShieldCheckIcon } from "lucide-react"
import { memo, useState } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { CopyButton } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { QuoteButtonState } from "./chat-types"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	headClassNames?: string
	showActionRow?: boolean
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (value: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (value: boolean) => void
	messageTs: number
	auditMetadata?: TaskAuditMetadata
}

export const CompletionOutputRow = memo(
	({
		headClassNames,
		text,
		quoteButtonState,
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		handleQuoteClick,
		auditMetadata,
	}: CompletionOutputRowProps) => {
		const [isAuditExpanded, setIsAuditExpanded] = useState(false)
		const [copied, setCopied] = useState(false)

		const handleCopyChecksum = (e: React.MouseEvent, checksum: string) => {
			e.stopPropagation()
			navigator.clipboard.writeText(checksum)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}

		return (
			<div>
				<div className="rounded-sm border border-success/20 overflow-visible bg-success/10 p-2 pt-3">
					{/* Title */}
					<div className={cn(headClassNames, "justify-between px-1")}>
						<div className="flex gap-2 items-center">
							<CheckIcon className="size-3 text-success" />
							<span className="text-success font-bold">Task Completed</span>
						</div>
						<CopyButton className="text-success" textToCopy={text} />
					</div>
					{/* Content */}
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm">
							<MarkdownRow markdown={text} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>

					{/* Audit & Hardening Report Section */}
					{auditMetadata && (
						<div className="mt-3 border-t border-success/20 pt-3 text-[11px] font-sans">
							<button
								className="flex w-full items-center justify-between cursor-pointer select-none text-success/80 hover:text-success transition-colors py-1 px-1 rounded-sm hover:bg-success/5 border-0 bg-transparent text-left outline-none font-sans"
								onClick={() => setIsAuditExpanded(!isAuditExpanded)}
								type="button">
								<div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[9px]">
									<ShieldCheckIcon className="size-3 text-success animate-pulse" />
									<span>Architectural Hardening Report</span>
								</div>
								<div className="flex items-center">
									{isAuditExpanded ? (
										<ChevronDownIcon className="size-3.5 transition-transform" />
									) : (
										<ChevronRightIcon className="size-3.5 transition-transform" />
									)}
								</div>
							</button>

							{isAuditExpanded && (
								<div className="mt-2.5 grid grid-cols-2 gap-2.5 bg-black/10 dark:bg-white/5 p-3 rounded-sm border border-success/15 animate-fadeIn">
									{/* Intent */}
									<div className="flex flex-col gap-1">
										<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
											Intent Classification
										</span>
										<div className="mt-0.5 w-fit">
											<span
												className={cn(
													"px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest shadow-sm",
													auditMetadata.intent_classification === "FIX" &&
														"bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30",
													auditMetadata.intent_classification === "CREATE" &&
														"bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
													auditMetadata.intent_classification === "REFACTOR" &&
														"bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30",
													auditMetadata.intent_classification === "TEST" &&
														"bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30",
													auditMetadata.intent_classification === "INVESTIGATE" &&
														"bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30",
													(!auditMetadata.intent_classification ||
														auditMetadata.intent_classification === "GENERAL") &&
														"bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30",
												)}>
												{auditMetadata.intent_classification || "GENERAL"}
											</span>
										</div>
									</div>

									{/* Checksum */}
									<div className="flex flex-col gap-1">
										<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
											Result Checksum
										</span>
										<div className="flex items-center gap-1 mt-0.5">
											<span
												className="font-mono text-[9px] text-success/90 bg-success/10 px-1.5 py-0.5 rounded-xs truncate max-w-[100px]"
												title={auditMetadata.result_checksum}>
												{auditMetadata.result_checksum
													? auditMetadata.result_checksum.substring(0, 10)
													: "N/A"}
											</span>
											{auditMetadata.result_checksum && (
												<button
													className="hover:text-success text-success/60 p-0.5 rounded-xs transition-colors cursor-pointer"
													onClick={(e) =>
														handleCopyChecksum(e, auditMetadata.result_checksum as string)
													}
													title="Copy Checksum"
													type="button">
													{copied ? (
														<CheckIcon className="size-3 text-emerald-500" />
													) : (
														<CopyIcon className="size-3" />
													)}
												</button>
											)}
										</div>
									</div>

									{/* Entropy */}
									<div className="flex flex-col gap-1">
										<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
											Structural Entropy
										</span>
										<div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px]">
											<span className="font-bold">
												{auditMetadata.entropy_score !== undefined
													? auditMetadata.entropy_score.toFixed(2)
													: "0.00"}
											</span>
											<span
												className={cn(
													"text-[8px] px-1 rounded-xs font-sans font-extrabold tracking-wider",
													(auditMetadata.entropy_score ?? 0) > 0.6
														? "text-red-500 bg-red-500/10 border border-red-500/20"
														: (auditMetadata.entropy_score ?? 0) > 0.4
															? "text-amber-500 bg-amber-500/10 border border-amber-500/20"
															: "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20",
												)}>
												{(auditMetadata.entropy_score ?? 0) > 0.6
													? "CRITICAL"
													: (auditMetadata.entropy_score ?? 0) > 0.4
														? "WARNING"
														: "STABLE"}
											</span>
										</div>
									</div>

									{/* Intent Coverage */}
									<div className="flex flex-col gap-1">
										<span className="text-[9px] uppercase tracking-wider text-description/70 font-semibold">
											Intent Coverage
										</span>
										<div className="flex items-center gap-2 mt-1">
											<div className="w-16 bg-success/20 h-1.5 rounded-full overflow-hidden border border-success/10">
												<div
													className="bg-success h-full transition-all duration-500"
													style={{
														width: `${Math.min(100, (auditMetadata.intent_coverage ?? 0) * 100)}%`,
													}}
												/>
											</div>
											<span className="font-mono text-[9px] font-bold">
												{Math.round((auditMetadata.intent_coverage ?? 0) * 100)}%
											</span>
										</div>
									</div>

									{/* Violations / Hardening status */}
									<div className="col-span-2 mt-1 border-t border-success/10 pt-2.5">
										<div className="flex items-center gap-1.5">
											{auditMetadata.violations && auditMetadata.violations.length > 0 ? (
												<div className="w-full">
													<div className="flex items-center gap-1 text-red-500 font-extrabold text-[9px] uppercase tracking-wider">
														<AlertTriangleIcon className="size-3 animate-bounce" />
														<span>
															Policy Violations Detected ({auditMetadata.violations.length})
														</span>
													</div>
													<ul className="mt-1.5 list-disc list-inside text-[9.5px] text-red-600 dark:text-red-400 space-y-1 bg-red-500/5 p-2 rounded-xs border border-red-500/15 animate-fadeIn">
														{auditMetadata.violations.map((v: string) => (
															<li className="truncate font-mono" key={v} title={v}>
																{v
																	.replace("unresolved_work_marker:", "Unresolved Marker: ")
																	.replace(/_/g, " ")}
															</li>
														))}
													</ul>
												</div>
											) : (
												<div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-2.5 py-1.5 rounded-xs border border-emerald-500/15 w-full">
													<CheckIcon className="size-3.5 stroke-[3]" />
													<span className="font-bold text-[9.5px] uppercase tracking-wider">
														0 Violations — Fully Hardened & Compliant
													</span>
												</div>
											)}
										</div>
									</div>

									{/* Joy-Zoning compliance */}
									{auditMetadata.joy_zoning_violations && auditMetadata.joy_zoning_violations.length > 0 && (
										<div className="col-span-2 mt-1 border-t border-success/10 pt-2.5">
											<div className="flex items-center gap-1 text-amber-500 font-extrabold text-[9px] uppercase tracking-wider mb-1.5">
												<AlertTriangleIcon className="size-3" />
												<span>Architecture Layer Violations</span>
											</div>
											<ul className="list-disc list-inside text-[9.5px] text-amber-600 dark:text-amber-400 space-y-1 bg-amber-500/5 p-2 rounded-xs border border-amber-500/15">
												{auditMetadata.joy_zoning_violations.map((v: string) => (
													<li className="truncate font-mono" key={v} title={v}>
														{v}
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</div>
				{/* Action Buttons */}
				{showActionRow && (
					<CompletionOutputActionRow
						explainChangesDisabled={explainChangesDisabled}
						messageTs={messageTs}
						seeNewChangesDisabled={seeNewChangesDisabled}
						setExplainChangesDisabled={setExplainChangesDisabled}
						setSeeNewChangesDisabled={setSeeNewChangesDisabled}
					/>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"

const CompletionOutputActionRow = memo(
	({
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
	}: {
		seeNewChangesDisabled: boolean
		setSeeNewChangesDisabled: (value: boolean) => void
		explainChangesDisabled: boolean
		setExplainChangesDisabled: (value: boolean) => void
		messageTs: number
	}) => {
		return (
			<div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
				<SuccessButton
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(
							Int64Request.create({
								value: messageTs,
							}),
						).catch((err) => console.error("Failed to show task completion view changes:", err))
					}}
					style={{
						cursor: seeNewChangesDisabled ? "wait" : "pointer",
						width: "100%",
					}}>
					<VscIcon className="" name="new-file" style={{ marginRight: 6 }} />
					View Changes
				</SuccessButton>

				{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<SuccessButton
						disabled={explainChangesDisabled}
						onClick={() => {
							setExplainChangesDisabled(true)
							TaskServiceClient.explainChanges({
								metadata: {},
								messageTs,
							}).catch((err) => {
								console.error("Failed to explain changes:", err)
								setExplainChangesDisabled(false)
							})
						}}
						style={{
							cursor: explainChangesDisabled ? "wait" : "pointer",
							width: "100%",
						}}>
						<VscIcon className="" name="comment-discussion" style={{ marginRight: 6 }} />
						{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
					</SuccessButton>
				)}
			</div>
		)
	},
)
