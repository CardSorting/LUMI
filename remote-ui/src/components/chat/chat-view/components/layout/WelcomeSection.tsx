import { EmptyRequest } from "@shared/proto/codemarie/common"
import type { Worktree } from "@shared/proto/codemarie/worktree"
import { TrackWorktreeViewOpenedRequest } from "@shared/proto/codemarie/worktree"
import { GitBranch } from "lucide-react"
import React, { useCallback, useEffect, useState } from "react"
import HistoryPreview from "@/components/history/HistoryPreview"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import HomeHeader from "@/components/welcome/HomeHeader"
import { SuggestedTasks } from "@/components/welcome/SuggestedTasks"
import CreateWorktreeModal from "@/components/worktrees/CreateWorktreeModal"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { WorktreeServiceClient } from "@/services/grpc-client"
import { WelcomeSectionProps } from "../../types/chatTypes"

/**
 * Welcome section shown when there's no active task
 * Includes home header, history preview, and suggested tasks
 */
export const WelcomeSection: React.FC<WelcomeSectionProps> = ({ showHistoryView, taskHistory, shouldShowQuickWins }) => {
	// Quick launch worktree modal
	const [showCreateWorktreeModal, setShowCreateWorktreeModal] = useState(false)
	const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
	const [currentWorktree, setCurrentWorktree] = useState<Worktree | null>(null)

	// Check if we're in a git repo and get current worktree info on mount
	useEffect(() => {
		WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			.then((result) => {
				const canUseWorktrees = result.isGitRepo && !result.isMultiRoot && !result.isSubfolder
				setIsGitRepo(canUseWorktrees)
				if (canUseWorktrees) {
					const current = result.worktrees.find((w) => w.isCurrent)
					setCurrentWorktree(current || null)
				}
			})
			.catch(() => setIsGitRepo(false))
	}, [])

	const { navigateToWorktrees, worktreesEnabled } = useExtensionState()

	// Handle click on home page worktree element with telemetry
	const handleWorktreeClick = useCallback(() => {
		WorktreeServiceClient.trackWorktreeViewOpened(TrackWorktreeViewOpenedRequest.create({ source: "home_page" })).catch(
			// biome-ignore lint/suspicious/noConsole: No Logger service available in remote-ui
			console.error,
		)
		navigateToWorktrees()
	}, [navigateToWorktrees])

	return (
		<div className="flex flex-col flex-1 w-full h-full p-0 m-0">
			<div className="overflow-y-auto flex flex-col pb-2.5">
				<HomeHeader shouldShowQuickWins={shouldShowQuickWins} />
				<div className="flex flex-col">
					{!shouldShowQuickWins && taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
					{/* Quick launch worktree button */}
					{isGitRepo && worktreesEnabled?.featureFlag && worktreesEnabled?.user && (
						<div className="flex flex-col items-center gap-3 mt-2 mb-4 px-5">
							{currentWorktree && (
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											className="flex flex-col items-center gap-0.5 text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer bg-transparent border-none p-1 rounded"
											onClick={handleWorktreeClick}
											type="button">
											<div className="flex items-center gap-1.5 text-xs">
												<GitBranch className="w-3 h-3 stroke-[2.5] flex-shrink-0" />
												<span className="break-all text-center">
													<span className="font-semibold">Current:</span>{" "}
													{currentWorktree.branch || "detached HEAD"}
												</span>
											</div>
											<span className="break-all text-center max-w-[300px]">{currentWorktree.path}</span>
										</button>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										View and manage git worktrees. Great for running parallel Codemarie tasks.
									</TooltipContent>
								</Tooltip>
							)}
						</div>
					)}
				</div>
			</div>
			<SuggestedTasks shouldShowQuickWins={shouldShowQuickWins} />

			{/* Quick launch worktree modal */}
			<CreateWorktreeModal
				onClose={() => setShowCreateWorktreeModal(false)}
				open={showCreateWorktreeModal}
				openAfterCreate={true}
			/>
		</div>
	)
}
