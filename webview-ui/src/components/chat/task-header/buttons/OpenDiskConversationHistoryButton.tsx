import { StringRequest } from "@shared/proto/dietcode/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskConversationHistoryButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const handleOpenDiskConversationHistory = () => {
		if (!taskId) {
			return
		}

		FileServiceClient.openDiskConversationHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<Button
			aria-label="Open conversation log file"
			className={cn("flex items-center", className)}
			disabled={!taskId}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				handleOpenDiskConversationHistory()
			}}
			size="icon"
			title="Open conversation log file"
			variant="icon">
			<ArrowDownToLineIcon />
		</Button>
	)
}

OpenDiskConversationHistoryButton.displayName = "OpenDiskConversationHistoryButton"
export default OpenDiskConversationHistoryButton
