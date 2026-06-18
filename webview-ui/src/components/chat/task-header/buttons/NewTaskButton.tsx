import { SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	return (
		<Button
			aria-label="Start a new chat"
			className={cn("flex items-center", className)}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				onClick()
			}}
			size="icon"
			title="Start a new chat"
			variant="icon">
			<SquarePen className="size-3.5" strokeWidth={2} />
		</Button>
	)
}

export default NewTaskButton
