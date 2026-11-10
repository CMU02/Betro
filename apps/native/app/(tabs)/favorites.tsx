import { Screen } from "@/components/ui/screen";
import { t } from "@/lib/i18n/t";

/** 즐겨찾기 탭. 2단계 계획에서 채운다. */
export default function FavoritesTab() {
	return <Screen scroll title={t("tabs.favorites")} />;
}
