import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useDietCodeSignIn } from "@/context/DietCodeAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import DietCodeLogoVariable from "../../assets/DietCodeLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<DietCodeLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, handleSignIn } = useDietCodeSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<DietCodeLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				Sign up with LUMI
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<VscIcon className="" name="refresh" />
					</span>
				)}
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				By continuing, you agree to the <VSCodeLink href="https://dietcode.bot/tos">Terms of Service</VSCodeLink> and{" "}
				<VSCodeLink href="https://dietcode.bot/privacy">Privacy Policy.</VSCodeLink>
			</p>
		</div>
	)
}
