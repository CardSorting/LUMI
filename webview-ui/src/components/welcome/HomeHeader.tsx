import DietCodeLogoVariable from "@/assets/DietCodeLogoVariable"
import { LumiAmbientOrb } from "@/components/common/LumiAmbientOrb"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { resolveOrbMood, useLumiSessionComfort } from "@/hooks/useLumiSessionComfort"

const HomeHeader = () => {
	const { environment } = useExtensionState()
	const { isStill, calmTier } = useLumiSessionComfort()

	const LogoComponent = DietCodeLogoVariable

	return (
		<div className="flex flex-col items-center mb-14 mt-16 animate-fade-slide-in">
			<LumiAmbientOrb calmTier={calmTier} className="mb-9" mood={resolveOrbMood("idle", isStill)}>
				<LogoComponent className="size-24 relative drop-shadow-xl" environment={environment} />
			</LumiAmbientOrb>
			<div className="text-center flex flex-col items-center justify-center px-8 gap-4">
				<h1 className="m-0 text-3xl font-semibold tracking-tight bg-gradient-to-r from-lumi to-lumi-cyan bg-clip-text text-transparent">
					Hi, I'm LUMI
				</h1>
				<p className="text-description text-base max-w-[340px] leading-relaxed">
					Your coding companion for everyday projects — working with your files, inside your workspace.
				</p>
				<p className="text-description/55 text-sm leading-relaxed">Take your time.</p>
			</div>
		</div>
	)
}

export default HomeHeader
