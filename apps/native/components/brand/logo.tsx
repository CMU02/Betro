import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";

/** `colorClassName`의 토큰 색이 `currentColor`로 글리프에 들어간다. */
const GlyphSvg = withUniwind(Svg);

const GLYPH_SIZE = 26;
/** Figma Logo 워드마크: Noto Sans KR Black 24/32, 자간 -4%. Title/1과 굵기만 다르다. */
const WORDMARK_STYLE = {
	fontFamily: "NotoSansKR-Black",
	letterSpacing: -0.96,
} as const;

/** Figma `Logo`(6:327): 라임 사각형 안의 노선 모양 B와 실시간 점, 그리고 워드마크. */
export function Logo() {
	return (
		<View
			accessibilityLabel="betro"
			accessibilityRole="image"
			accessible
			className="flex-row items-center gap-2.5"
		>
			<View className="size-10 items-center justify-center rounded-md bg-accent-primary">
				<GlyphSvg
					colorClassName="accent-text-on-accent"
					height={GLYPH_SIZE}
					viewBox="0 0 26 26"
					width={GLYPH_SIZE}
				>
					<Path
						d="M5 13V21H14.5C15.5609 21 16.5783 20.5786 17.3284 19.8284C18.0786 19.0783 18.5 18.0609 18.5 17C18.5 15.9391 18.0786 14.9217 17.3284 14.1716C16.5783 13.4214 15.5609 13 14.5 13H13.5M5 13V5H13.5C14.5609 5 15.5783 5.42143 16.3284 6.17157C17.0786 6.92172 17.5 7.93913 17.5 9C17.5 10.0609 17.0786 11.0783 16.3284 11.8284C15.5783 12.5786 14.5609 13 13.5 13M5 13H13.5"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={3.2}
					/>
					<Path
						d="M20.5 8C21.8807 8 23 6.88071 23 5.5C23 4.11929 21.8807 3 20.5 3C19.1193 3 18 4.11929 18 5.5C18 6.88071 19.1193 8 20.5 8Z"
						fill="currentColor"
					/>
				</GlyphSvg>
			</View>
			<AppText style={WORDMARK_STYLE} variant="title1">
				betro
			</AppText>
		</View>
	);
}
