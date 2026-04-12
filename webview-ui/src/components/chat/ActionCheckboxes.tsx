import { useMemo, useState } from "react"
import styled from "styled-components"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"

const ActionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  margin-bottom: 16px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
`

const ActionItem = styled.div<{ disabled?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};
  pointer-events: ${(props) => (props.disabled ? "none" : "auto")};
  &:hover {
    background: var(--vscode-list-hoverBackground);
  }
`

const ActionDetails = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  flex: 1;
`

const ActionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const ActionLabel = styled(Label)`
  font-weight: 600;
  cursor: pointer;
  line-height: 1.4;
  font-size: 13px;
`

const ActionRationale = styled.span`
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  font-style: italic;
  opacity: 0.9;
`

const ActionDescription = styled.span`
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
`

const DependencyInfo = styled.span`
  font-size: 10px;
  color: var(--vscode-errorForeground);
  font-weight: 500;
  margin-top: 2px;
`

const BadgeContainer = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
`

const PriorityBadge = ({ priority }: { priority: "critical" | "recommended" | "optional" }) => {
	const variants = {
		critical: "danger",
		recommended: "default",
		optional: "outline",
	} as const
	return (
		<Badge className="text-[9px] uppercase px-1.5 py-0 h-4" variant={variants[priority]}>
			{priority}
		</Badge>
	)
}

const ImpactBadge = ({ impact }: { impact: "high" | "medium" | "low" }) => {
	const variants = {
		high: "danger",
		medium: "warning",
		low: "success",
	} as const
	return (
		<Badge className="text-[8px] uppercase px-1 py-0 h-3.5 opacity-80" variant={variants[impact]}>
			{impact} Impact
		</Badge>
	)
}

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

	const handleToggle = (id: string) => {
		let updated = localActions.map((a) => (a.id === id ? { ...a, isChecked: !a.isChecked } : a))

		updated = cascade(updated)
		setLocalActions(updated)
		onActionsChange(updated)
	}

	const handleToggleAll = () => {
		const allChecked = localActions.every((a) => a.isChecked)
		const updated = localActions.map((a) => ({ ...a, isChecked: !allChecked }))
		setLocalActions(cascade(updated))
		onActionsChange(updated)
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

	const allChecked = localActions.every((a) => a.isChecked)

	return (
		<ActionList>
			<div className="flex items-center justify-between mb-2">
				<div className="text-[11px] font-bold text-description uppercase tracking-wider">Proposed Actions</div>
				<div className="flex items-center gap-3">
					<div className="text-[11px] text-description italic">
						{localActions.filter((a) => a.isChecked).length} of {localActions.length} selected
					</div>
					<button
						className="text-[10px] uppercase font-bold text-button-foreground bg-button-background px-2 py-0.5 rounded-xs hover:bg-button-hover cursor-pointer border-none"
						onClick={handleToggleAll}
						type="button">
						{allChecked ? "Deselect All" : "Select All"}
					</button>
				</div>
			</div>
			{sortedActions.map((action) => {
				const depMet = isDependencyMet(action)
				const missingDeps =
					action.dependsOn?.filter((depId) => !localActions.find((a) => a.id === depId)?.isChecked) || []

				return (
					<ActionItem
						className={cn({ "opacity-75": !action.isChecked && depMet })}
						disabled={!depMet && !action.isChecked}
						key={action.id}>
						<div className="pt-0.5">
							<Switch
								checked={action.isChecked}
								disabled={!depMet}
								id={`action-${action.id}`}
								onCheckedChange={() => handleToggle(action.id)}
							/>
						</div>
						<ActionDetails onClick={() => depMet && handleToggle(action.id)}>
							<ActionHeader>
								<ActionLabel htmlFor={`action-${action.id}`}>{action.label}</ActionLabel>
								<BadgeContainer>
									<ImpactBadge impact={action.impact} />
									<PriorityBadge priority={action.priority} />
								</BadgeContainer>
							</ActionHeader>
							{action.rationale && <ActionRationale>Rationale: {action.rationale}</ActionRationale>}
							{action.description && <ActionDescription>{action.description}</ActionDescription>}
							{!depMet && missingDeps.length > 0 && (
								<DependencyInfo>
									<VscIcon className="mr-1" name="lock" />
									Requires:{" "}
									{missingDeps.map((id) => localActions.find((a) => a.id === id)?.label || id).join(", ")}
								</DependencyInfo>
							)}
						</ActionDetails>
					</ActionItem>
				)
			})}
		</ActionList>
	)
}
