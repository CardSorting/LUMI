import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/dietcode/common"
import { ExternalLinkIcon } from "lucide-react"
import { memo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface AuditArtifactQuickLinksProps {
	auditMetadata: TaskAuditMetadata
	className?: string
}

const ARTIFACT_LABELS: Record<string, string> = {
	sarif: "SARIF",
	report: "Report",
	manifest: "Manifest",
}

function artifactKind(path: string): string {
	if (path.includes("sarif")) return "sarif"
	if (path.includes("manifest")) return "manifest"
	return "report"
}

/** Compact workspace artifact links — mirrors GitHub Actions artifact download strip. */
export const AuditArtifactQuickLinks = memo(({ auditMetadata, className }: AuditArtifactQuickLinksProps) => {
	const paths = [
		auditMetadata.artifact_sarif_path,
		auditMetadata.artifact_report_path,
		auditMetadata.artifact_manifest_path,
	].filter(Boolean) as string[]

	const handleOpen = useCallback((relativePath: string) => {
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: relativePath })).catch((error) =>
			console.error("Failed to open audit artifact:", error),
		)
	}, [])

	if (paths.length === 0) {
		return null
	}

	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			<span className="text-[8px] uppercase tracking-wider font-bold text-description/60">Artifacts</span>
			{paths.map((path) => (
				<button
					className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-description/80 hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
					key={path}
					onClick={() => handleOpen(path)}
					title={path}
					type="button">
					<ExternalLinkIcon className="size-2.5" />
					{ARTIFACT_LABELS[artifactKind(path)] ?? "File"}
				</button>
			))}
		</div>
	)
})

AuditArtifactQuickLinks.displayName = "AuditArtifactQuickLinks"
