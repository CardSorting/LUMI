import { cn } from "@heroui/react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"

const CopyTaskButton: React.FC<{
	taskText?: string
	className?: string
}> = ({ taskText, className }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		if (!taskText) {
			return
		}

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [taskText])

	return (
		<Button
			aria-label="Copy task text"
			className={cn("flex items-center", className)}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				handleCopy()
			}}
			size="icon"
			title="Copy task text"
			variant="icon">
			{copied ? <CheckIcon /> : <CopyIcon />}
		</Button>
	)
}

export default CopyTaskButton
