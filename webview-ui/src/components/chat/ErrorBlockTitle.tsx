import React from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"
import { DietCodeError, DietCodeErrorType } from "../../../../src/services/error/DietCodeError"
import { ProgressIndicator } from "./ChatRow"

interface ErrorBlockTitleProps {
	cost?: number
	apiReqCancelReason?: string
	apiRequestFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec?: number
		errorSnippet?: string
	}
}

export const ErrorBlockTitle = ({
	cost,
	apiReqCancelReason,
	apiRequestFailedMessage,
	retryStatus,
}: ErrorBlockTitleProps): [React.ReactElement, React.ReactElement] => {
	const getIconSpan = (iconName: string, colorClass: string) => (
		<div className="w-4 h-4 flex items-center justify-center">
			<VscIcon className={cn("text-base -mb-0.5", colorClass)} name={iconName} />
		</div>
	)

	const icon =
		apiReqCancelReason != null ? (
			apiReqCancelReason === "user_cancelled" ? (
				getIconSpan("error", "text-(--vscode-descriptionForeground)")
			) : (
				getIconSpan("error", "text-(--vscode-errorForeground)")
			)
		) : cost != null ? (
			getIconSpan("check", "text-(--vscode-charts-green)")
		) : apiRequestFailedMessage ? (
			getIconSpan("error", "text-(--vscode-descriptionForeground)")
		) : (
			<ProgressIndicator />
		)

	const title = (() => {
		const details = { title: "Working on it...", classNames: ["font-medium"] }
		if (apiReqCancelReason === "user_cancelled") {
			details.title = "Stopped"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiReqCancelReason != null) {
			details.title = "That didn't quite work"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (cost != null) {
			details.title = "Done."
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiRequestFailedMessage) {
			const dietcodeError = DietCodeError.parse(apiRequestFailedMessage)
			const titleText = dietcodeError?.isErrorType(DietCodeErrorType.Balance)
				? "You're out of credits"
				: "That didn't quite work"
			details.title = titleText
			details.classNames.push(
				dietcodeError?.isErrorType(DietCodeErrorType.Balance)
					? "font-medium text-(--vscode-errorForeground)"
					: "font-medium text-(--vscode-foreground)",
			)
		} else if (retryStatus) {
			details.title = "Taking another look…"
			details.classNames.push("text-(--vscode-foreground)")
		}

		return <span className={details.classNames.join(" ")}>{details.title}</span>
	})()

	return [icon, title]
}
