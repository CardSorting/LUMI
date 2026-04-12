import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { VscIcon } from "@/components/ui/vsc-icon"

export function RemotelyConfiguredInputWrapper({ hidden, children }: React.PropsWithChildren<{ hidden: boolean }>) {
	return (
		<Tooltip>
			<TooltipContent hidden={hidden}>This setting is managed by your organization's remote configuration</TooltipContent>
			<TooltipTrigger>{children}</TooltipTrigger>
		</Tooltip>
	)
}

export const LockIcon = () => <VscIcon className="text-description text-sm" name="lock" />
