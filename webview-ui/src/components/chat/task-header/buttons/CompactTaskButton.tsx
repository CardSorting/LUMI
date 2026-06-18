import { FoldVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const CompactTaskButton: React.FC<{
	className?: string
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className }) => {
	return (
		<Button
			aria-label="Free up conversation space"
			className={cn("flex items-center [&_svg]:size-3 shrink-0", className)}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				onClick(e)
			}}
			size="icon"
			title="Free up conversation space"
			variant="icon">
			<FoldVerticalIcon />
		</Button>
	)
}

export default CompactTaskButton
