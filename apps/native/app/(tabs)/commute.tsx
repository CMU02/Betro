import { Screen } from "@/components/ui/screen";
import { t } from "@/lib/i18n/t";

/** 출퇴근 탭. 4단계 계획에서 채운다. */
export default function CommuteTab() {
	return <Screen scroll title={t("tabs.commute")} />;
}
