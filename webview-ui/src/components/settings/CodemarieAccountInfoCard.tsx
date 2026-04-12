import { EmptyRequest } from "@shared/proto/codemarie/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useCodemarieAuth } from "@/context/CodemarieAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

export const CodemarieAccountInfoCard = () => {
	const { codemarieUser } = useCodemarieAuth()
	const { navigateToAccount } = useExtensionState()
	const [isLoading, setIsLoading] = useState(false)

	const user = codemarieUser || undefined

	const handleLogin = () => {
		setIsLoading(true)
		AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			.catch((err) => console.error("Failed to get login URL:", err))
			.finally(() => {
				setIsLoading(false)
			})
	}

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				<div>
					<VSCodeButton className="mt-0" disabled={isLoading} onClick={handleLogin}>
						Sign Up with Codemarie
						{isLoading && (
							<span className="ml-1 animate-spin">
								<VscIcon className="" name="refresh" />
							</span>
						)}
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}
