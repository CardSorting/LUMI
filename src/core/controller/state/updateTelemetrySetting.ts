import type { IController as Controller } from "@core/controller/types"
import { Empty } from "@shared/proto/dietcode/common"
import { TelemetrySettingRequest } from "@shared/proto/dietcode/state"
import { convertProtoTelemetrySettingToDomain } from "../../../shared/proto-conversions/state/telemetry-setting-conversion"

/**
 * Updates the telemetry setting
 * @param controller The controller instance
 * @param request The telemetry setting request
 * @returns Empty response
 */
export async function updateTelemetrySetting(controller: Controller, request: TelemetrySettingRequest): Promise<Empty> {
	const telemetrySetting = convertProtoTelemetrySettingToDomain(request.setting)
	await controller.updateTelemetrySetting(telemetrySetting)
	return Empty.create()
}
