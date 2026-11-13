import { SetupForm } from "@/components/places/setup-form";

/** 16 장소 설정(새 장소). */
export default function NewPlaceScreen() {
	return <SetupForm mode="new" place={null} />;
}
