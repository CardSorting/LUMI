import { StringRequest } from "@shared/proto/dietcode/common"
import { TaskFeedbackType } from "@shared/WebviewMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

interface TaskFeedbackButtonsProps {
	messageTs: number
	isFromHistory?: boolean
	classNames?: string
}

const TaskFeedbackButtons: React.FC<TaskFeedbackButtonsProps> = ({ messageTs, isFromHistory = false, classNames }) => {
	const [feedback, setFeedback] = useState<TaskFeedbackType | null>(null)
	const [shouldShow, setShouldShow] = useState<boolean>(true)

	useEffect(() => {
		try {
			const feedbackHistory = localStorage.getItem("taskFeedbackHistory") || "{}"
			const history = JSON.parse(feedbackHistory)
			if (history[messageTs]) {
				setShouldShow(false)
			}
		} catch (e) {
			console.error("Error checking feedback history:", e)
		}
	}, [messageTs])

	if (isFromHistory || !shouldShow) {
		return null
	}

	const handleFeedback = async (type: TaskFeedbackType) => {
		if (feedback !== null) {
			return
		}

		setFeedback(type)

		try {
			await TaskServiceClient.taskFeedback(
				StringRequest.create({
					value: type,
				}),
			)

			try {
				const feedbackHistory = localStorage.getItem("taskFeedbackHistory") || "{}"
				const history = JSON.parse(feedbackHistory)
				history[messageTs] = true
				localStorage.setItem("taskFeedbackHistory", JSON.stringify(history))
			} catch (e) {
				console.error("Error updating feedback history:", e)
			}
		} catch (error) {
			console.error("Error sending task feedback:", error)
		}
	}

	return (
		<div className={cn("flex items-center justify-end gap-0.5 shrink-0", classNames)}>
			<VSCodeButton
				appearance="icon"
				aria-label="This was helpful"
				disabled={feedback !== null}
				onClick={() => handleFeedback("thumbs_up")}
				title="This was helpful">
				<VscIcon className="text-muted-foreground" name={feedback === "thumbs_up" ? "thumbsup-filled" : "thumbsup"} />
			</VSCodeButton>
			<VSCodeButton
				appearance="icon"
				aria-label="This wasn't helpful"
				disabled={feedback !== null && feedback !== "thumbs_down"}
				onClick={() => handleFeedback("thumbs_down")}
				title="This wasn't helpful">
				<VscIcon
					className="text-muted-foreground"
					name={feedback === "thumbs_down" ? "thumbsdown-filled" : "thumbsdown"}
				/>
			</VSCodeButton>
		</div>
	)
}

export default TaskFeedbackButtons
