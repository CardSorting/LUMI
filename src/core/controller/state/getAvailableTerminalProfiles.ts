import type { IController as Controller } from "@core/controller/types"
import * as proto from "@/shared/proto"
import { getAvailableTerminalProfiles as getTerminalProfilesFromShell } from "../../../utils/shell"

export async function getAvailableTerminalProfiles(
	_controller: Controller,
	_request: proto.dietcode.EmptyRequest,
): Promise<proto.dietcode.TerminalProfiles> {
	const profiles = getTerminalProfilesFromShell()

	return proto.dietcode.TerminalProfiles.create({
		profiles: profiles.map((profile) => ({
			id: profile.id,
			name: profile.name,
			path: profile.path || "",
			description: profile.description || "",
		})),
	})
}
