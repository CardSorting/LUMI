import { ChevronRightIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { VscIcon } from "@/components/ui/vsc-icon"
import { cn } from "@/lib/utils"

interface AlignmentGuardProps {
	policyCompliance?: {
		isAligned: boolean
		reasoning: string
		violations?: string[]
	}
	architecturalLayers?: Record<string, "domain" | "core" | "infrastructure" | "ui" | "plumbing">
}

const layerLabel: Record<string, string> = {
	domain: "Domain",
	core: "Core",
	infrastructure: "Infra",
	ui: "UI",
	plumbing: "Utils",
}

export const AlignmentGuard = ({ policyCompliance, architecturalLayers }: AlignmentGuardProps) => {
	if (!policyCompliance && !architecturalLayers) return null

	const isAligned = policyCompliance?.isAligned ?? true

	return (
		<details className="lumi-inline-disclosure group mt-3 rounded-md border border-editor-group-border bg-code">
			<summary
				className={cn(
					"lumi-details-trigger list-none cursor-pointer flex items-center gap-2 px-2.5 py-2",
					"hover:bg-accent/10",
				)}>
				<span className="text-[11px] font-medium text-foreground flex-1 min-w-0">Fits your project?</span>
				{policyCompliance ? (
					<Badge className="text-[9px] font-normal shrink-0" variant={isAligned ? "success" : "danger"}>
						{isAligned ? "Looks good" : "Needs review"}
					</Badge>
				) : null}
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>

			<div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-editor-group-border/50 pt-2">
				{policyCompliance ? (
					<p className="text-xs text-foreground m-0 leading-snug">{policyCompliance.reasoning}</p>
				) : null}

				{policyCompliance?.violations && policyCompliance.violations.length > 0 ? (
					<ul className="m-0 p-2 rounded-md border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] list-none flex flex-col gap-1.5">
						{policyCompliance.violations.map((violation) => (
							<li className="flex items-start gap-1.5 text-xs text-error" key={violation}>
								<VscIcon className="shrink-0 pt-0.5" name="warning" />
								<span>{violation}</span>
							</li>
						))}
					</ul>
				) : null}

				{architecturalLayers && Object.keys(architecturalLayers).length > 0 ? (
					<div className="flex flex-wrap gap-1 pt-1 border-t border-editor-group-border/40">
						{Object.entries(architecturalLayers).map(([file, layer]) => (
							<span
								className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-editor-group-border text-muted-foreground max-w-full"
								key={file}
								title={file}>
								<span className="font-medium text-foreground/80">{layerLabel[layer] ?? layer}</span>
								<span className="truncate">{file.split("/").pop()}</span>
							</span>
						))}
					</div>
				) : null}
			</div>
		</details>
	)
}
