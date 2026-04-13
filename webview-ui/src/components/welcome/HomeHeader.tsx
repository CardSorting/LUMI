import DietCodeLogoVariable from "@/assets/DietCodeLogoVariable"
import { useExtensionState } from "@/context/ExtensionStateContext"

const HomeHeader = () => {
	const { environment } = useExtensionState()

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
		</div>
	)
}

export default HomeHeader
