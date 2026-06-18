import { StringArrayRequest } from "@shared/proto/dietcode/common"
import { TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatSize } from "@/utils/format"

const DeleteTaskButton: React.FC<{
	taskId?: string
	taskSize?: number
	className?: string
}> = ({ taskId, className, taskSize }) => (
	<Button
		aria-label="Delete this chat"
		className={cn("flex items-center", className)}
		disabled={!taskId}
		onClick={(e) => {
			e.preventDefault()
			e.stopPropagation()
			taskId && TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [taskId] }))
		}}
		size="xs"
		title={taskSize ? `Delete chat (${formatSize(taskSize)})` : "Delete this chat"}
		variant="icon">
		<TrashIcon />
	</Button>
)
DeleteTaskButton.displayName = "DeleteTaskButton"

export default DeleteTaskButton
