import { EmptyRequest } from "@shared/proto/dietcode/common"
import DietCodeLogoVariable from "@/assets/DietCodeLogoVariable"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowQuickWins?: boolean
}

const HomeHeader = ({ shouldShowQuickWins = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	const LogoComponent = DietCodeLogoVariable

	return (
		<div className="flex flex-col items-center mb-10 mt-12 animate-fade-slide-in">
			<div className="mb-8 relative">
				<div className="absolute inset-0 blur-3xl opacity-20 bg-premium-cola-gradient rounded-full" />
				<LogoComponent className="size-24 relative drop-shadow-2xl" environment={environment} />
			</div>
			<div className="text-center flex flex-col items-center justify-center px-8 gap-3">
				<h1 className="m-0 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-dietcode to-green-400 bg-clip-text text-transparent">
					Hi, I'm DietCode!
				</h1>
				<p className="text-description text-base max-w-[320px] leading-relaxed font-medium">
					I'm your agentic coding partner, ready to help you build, refactor, and explore your codebase.
				</p>
			</div>
			{shouldShowQuickWins && (
				<div className="mt-4">
					<button
						className="flex items-center gap-2 px-4 py-2 rounded-full border border-border-panel bg-white/2 hover:bg-list-background-hover transition-colors duration-150 ease-in-out text-code-foreground text-sm font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<VscIcon className="scale-90" name="play" />
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
