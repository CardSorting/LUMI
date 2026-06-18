import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"

const priorityLabel = {
	critical: "Important",
	recommended: "Suggested",
	optional: "Optional",
} as const

const priorityVariant = {
	critical: "danger",
	recommended: "default",
	optional: "outline",
} as const

const PriorityBadge = ({ priority }: { priority: "critical" | "recommended" | "optional" }) => (
	<Badge className="text-[9px] px-1.5 py-0 h-4 font-normal" variant={priorityVariant[priority]}>
		{priorityLabel[priority]}
	</Badge>
)

interface Action {
	id: string
	label: string
	description?: string
	rationale?: string
	priority: "critical" | "recommended" | "optional"
	impact: "high" | "medium" | "low"
	dependsOn?: string[]
	isChecked: boolean
}

interface ActionCheckboxesProps {
	actions: Action[]
	onActionsChange: (actions: Action[]) => void
}

export const ActionCheckboxes = ({ actions, onActionsChange }: ActionCheckboxesProps) => {
	const [localActions, setLocalActions] = useState<Action[]>(actions)

	const sortedActions = useMemo(() => {
		const priorityMap = { critical: 0, recommended: 1, optional: 2 }
		return [...localActions].sort((a, b) => priorityMap[a.priority] - priorityMap[b.priority])
	}, [localActions])

	const isDependencyMet = (action: Action) => {
		if (!action.dependsOn || action.dependsOn.length === 0) return true
		return action.dependsOn.every((depId) => localActions.find((a) => a.id === depId)?.isChecked)
	}

	const cascade = (currentActions: Action[]): Action[] => {
		let changed = false
		const next = currentActions.map((a) => {
			if (a.isChecked && a.dependsOn?.some((depId) => !currentActions.find((ca) => ca.id === depId)?.isChecked)) {
				changed = true
				return { ...a, isChecked: false }
			}
			return a
		})
		return changed ? cascade(next) : next
	}

	const handleToggle = (id: string) => {
		const updated = cascade(localActions.map((a) => (a.id === id ? { ...a, isChecked: !a.isChecked } : a)))
		setLocalActions(updated)
		onActionsChange(updated)
	}

	const handleToggleAll = () => {
		const allChecked = localActions.every((a) => a.isChecked)
		const updated = cascade(localActions.map((a) => ({ ...a, isChecked: !allChecked })))
		setLocalActions(updated)
		onActionsChange(updated)
	}

	const allChecked = localActions.every((a) => a.isChecked)
	const selectedCount = localActions.filter((a) => a.isChecked).length

	return (
		<div className="mt-3 flex flex-col gap-2 rounded-md border border-editor-group-border bg-code p-2.5">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[11px] font-medium text-muted-foreground m-0">Pick the steps you want</p>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-[10px] text-muted-foreground tabular-nums">
						{selectedCount}/{localActions.length}
					</span>
					<button
						className="text-[10px] text-link bg-transparent border-0 p-0 cursor-pointer hover:underline"
						onClick={handleToggleAll}
						type="button">
						{allChecked ? "Clear all" : "Select all"}
					</button>
				</div>
			</div>

			{sortedActions.map((action) => {
				const depMet = isDependencyMet(action)
				const missingDeps =
					action.dependsOn?.filter((depId) => !localActions.find((a) => a.id === depId)?.isChecked) || []

				return (
					<div
						className={cn(
							"flex items-start gap-2 rounded-sm px-1 py-1.5",
							!depMet && !action.isChecked && "opacity-50 pointer-events-none",
							!action.isChecked && depMet && "opacity-80",
						)}
						key={action.id}>
						<div className="pt-0.5 shrink-0">
							<Switch
								checked={action.isChecked}
								disabled={!depMet}
								id={`action-${action.id}`}
								onCheckedChange={() => handleToggle(action.id)}
							/>
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-start justify-between gap-2">
								<Label
									className="text-xs font-medium leading-snug cursor-pointer"
									htmlFor={`action-${action.id}`}>
									{action.label}
								</Label>
								<PriorityBadge priority={action.priority} />
							</div>
							{action.description && (
								<p className="text-[11px] text-muted-foreground m-0 mt-0.5 leading-snug">{action.description}</p>
							)}
							{action.rationale && (
								<p className="text-[10px] text-link/80 m-0 mt-0.5 italic leading-snug">{action.rationale}</p>
							)}
							{!depMet && missingDeps.length > 0 && (
								<p className="text-[10px] text-error m-0 mt-1 flex items-center gap-1">
									<VscIcon name="lock" />
									First do:{" "}
									{missingDeps.map((id) => localActions.find((a) => a.id === id)?.label || id).join(", ")}
								</p>
							)}
						</div>
					</div>
				)
			})}
		</div>
	)
}
