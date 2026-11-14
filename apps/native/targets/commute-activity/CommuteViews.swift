import SwiftUI
import WidgetKit

// 잠금화면 카드와 다이내믹 아일랜드의 화면. 레이아웃과 값은 Figma "Betro App UI"에서 옮겼다.
// - 카드: `LiveActivity`(87:2420, 2026-11-11 모양), `NextLegRow`(114:1599), `LegBadge · S`(114:1598),
//   `BusBadge`(4:47), `LineBadge`(4:34), `StatusTag`(4:60)
// - 다이내믹 아일랜드: `iOS / 19 Dynamic Island`(49:18907)
// 색은 Figma 변수의 다크·라이트 값이고 `apps/native/theme/tokens.ts`와 같다.

// MARK: - 색

extension Color {
  /// `0xRRGGBB` 불투명 색.
  init(commuteHex hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

/// 다크·라이트 두 값이 있는 Figma 색 변수.
struct CommuteColorToken {
  let dark: UInt32
  let light: UInt32

  func color(_ scheme: ColorScheme) -> Color {
    Color(commuteHex: scheme == .dark ? dark : light)
  }
}

enum CommuteColors {
  static let bgControl = CommuteColorToken(dark: 0x27292D, light: 0xEEEEF0)
  static let bgSurfaceRaised = CommuteColorToken(dark: 0x1E1F22, light: 0xFFFFFF)
  static let iconPrimary = CommuteColorToken(dark: 0xF6F6F7, light: 0x0E0F10)
  static let iconSecondary = CommuteColorToken(dark: 0x90939A, light: 0x686B72)
  static let statusDelayed = CommuteColorToken(dark: 0xFF6B6B, light: 0xD23434)
  static let statusEstimated = CommuteColorToken(dark: 0xFFC145, light: 0x8F5E00)
  static let statusLive = CommuteColorToken(dark: 0x3DDC84, light: 0x0B7A3E)
  static let textAccent = CommuteColorToken(dark: 0xC6F432, light: 0x4F6A08)
  static let textOnAccent = CommuteColorToken(dark: 0x0E0F10, light: 0x0E0F10)
  static let textPrimary = CommuteColorToken(dark: 0xF6F6F7, light: 0x0E0F10)
  static let textSecondary = CommuteColorToken(dark: 0xBBBDC2, light: 0x505359)
  static let textTertiary = CommuteColorToken(dark: 0x90939A, light: 0x686B72)
  /// 노선색 배경의 흰 글자(`primitive/neutral-0`, 두 테마 같음).
  static let onTransit = Color(commuteHex: 0xFFFFFF)
}

// MARK: - 글자

/// Figma 텍스트 스타일. 자간은 크기 × % / 100(`theme/typography.ts`와 같은 계산).
/// 고정 크기라 "더 큰 텍스트"를 켜도 카드가 160pt를 넘지 않는다.
struct CommuteTextStyle {
  let fontName: String
  let size: CGFloat
  let lineHeight: CGFloat
  let tracking: CGFloat

  static let title1 = CommuteTextStyle(fontName: "NotoSansKR-Bold", size: 24, lineHeight: 32, tracking: -0.36)
  static let title3 = CommuteTextStyle(fontName: "NotoSansKR-Bold", size: 17, lineHeight: 24, tracking: -0.085)
  static let bodyM = CommuteTextStyle(fontName: "NotoSansKR-Regular", size: 15, lineHeight: 22, tracking: -0.045)
  static let labelM = CommuteTextStyle(fontName: "NotoSansKR-Medium", size: 14, lineHeight: 20, tracking: -0.028)
  static let labelS = CommuteTextStyle(fontName: "NotoSansKR-Medium", size: 13, lineHeight: 18, tracking: -0.026)
  static let caption = CommuteTextStyle(fontName: "NotoSansKR-Medium", size: 12, lineHeight: 16, tracking: 0)
  static let micro = CommuteTextStyle(fontName: "NotoSansKR-Bold", size: 11, lineHeight: 14, tracking: 0.11)
  /// `BusBadge` 라벨(4:36): 굵게 12, 줄 16, 자간 없음.
  static let busBadge = CommuteTextStyle(fontName: "NotoSansKR-Bold", size: 12, lineHeight: 16, tracking: 0)
  /// `LineBadge` 라벨(4:21): 굵게 11, 줄 14, 자간 없음.
  static let lineBadge = CommuteTextStyle(fontName: "NotoSansKR-Bold", size: 11, lineHeight: 14, tracking: 0)
}

extension Text {
  func commuteStyle(_ style: CommuteTextStyle, color: Color) -> Text {
    font(.custom(style.fontName, fixedSize: style.size))
      .kerning(style.tracking)
      .foregroundColor(color)
  }
}

enum CommuteLayout {
  static let cardPadding: CGFloat = 16
  static let cardGap: CGFloat = 4
  static let bodyGap: CGFloat = 8
  static let headerHeight: CGFloat = 16
  static let headerGap: CGFloat = 6
  static let headerIcon: CGFloat = 14
  static let titleHeight: CGFloat = 32
  static let titleGap: CGFloat = 6
  static let detailHeight: CGFloat = 24
  static let detailGap: CGFloat = 8
  static let nextLegHeight: CGFloat = 20
  static let nextLegGap: CGFloat = 4
  static let nextLegBadgeGap: CGFloat = 6
  static let suggestionHeight: CGFloat = 36
  static let suggestionPaddingX: CGFloat = 12
  static let suggestionPaddingY: CGFloat = 8
  static let suggestionGap: CGFloat = 8
  static let suggestionRadius: CGFloat = 12
  static let suggestionIcon: CGFloat = 24
  static let statusDot: CGFloat = 6
  static let statusGap: CGFloat = 5
  static let islandGap: CGFloat = 10
  static let islandTitleGap: CGFloat = 8
  static let islandMinimalIcon: CGFloat = 18
}

// MARK: - 노선 배지

/// 푸시 값에는 노선 이름과 수단만 있다. 버스는 노선 유형을 몰라 간선색(앱의 `badgeAt` 대체와 같다),
/// 지하철은 `packages/transit-static`의 노선 이름(`LINES.nameKo`)으로 Figma `LineBadge` 색과 라벨을 찾는다.
/// 모르는 노선(서해선·경강선·신림선 등)은 중립색에 이름 그대로.
struct CommuteBadgeStyle {
  let label: String
  let background: Color
  let foreground: Color
  /// 한 글자 숫자 라벨(1~9호선)은 원으로 그린다.
  let isRound: Bool
}

enum CommuteBadges {
  private struct SubwayLine {
    let label: String
    let color: UInt32
    /// 밝은 노선색이라 어두운 글자(Figma `LineBadge` 4:34의 9·수인분당·우이신설, `primitive/neutral-950` #0e0f10)를 쓴다.
    let darkText: Bool
  }

  static let busTrunk: UInt32 = 0x0068B7

  private static let subwayLines: [String: SubwayLine] = [
    "1호선": SubwayLine(label: "1", color: 0x0052A4, darkText: false),
    "2호선": SubwayLine(label: "2", color: 0x00A84D, darkText: false),
    "3호선": SubwayLine(label: "3", color: 0xEF7C1C, darkText: false),
    "4호선": SubwayLine(label: "4", color: 0x00A5DE, darkText: false),
    "5호선": SubwayLine(label: "5", color: 0x996CAC, darkText: false),
    "6호선": SubwayLine(label: "6", color: 0xCD7C2F, darkText: false),
    "7호선": SubwayLine(label: "7", color: 0x747F00, darkText: false),
    "8호선": SubwayLine(label: "8", color: 0xE6186C, darkText: false),
    "9호선": SubwayLine(label: "9", color: 0xBDB092, darkText: true),
    "경의중앙선": SubwayLine(label: "경의중앙", color: 0x77C4A3, darkText: false),
    "공항철도": SubwayLine(label: "공항", color: 0x0090D2, darkText: false),
    "경춘선": SubwayLine(label: "경춘", color: 0x178C72, darkText: false),
    "수인분당선": SubwayLine(label: "수인분당", color: 0xF5A200, darkText: true),
    "신분당선": SubwayLine(label: "신분당", color: 0xD4003B, darkText: false),
    "우이신설선": SubwayLine(label: "우이신설", color: 0xB7C452, darkText: true),
    "GTX-A": SubwayLine(label: "GTX-A", color: 0x9A6292, darkText: false),
  ]

  static func style(lineName: String, mode: String, scheme: ColorScheme) -> CommuteBadgeStyle {
    let trimmed = lineName.trimmingCharacters(in: .whitespaces)
    let label = trimmed.isEmpty ? "-" : trimmed
    if mode != "subway" {
      return CommuteBadgeStyle(
        label: label,
        background: Color(commuteHex: busTrunk),
        foreground: CommuteColors.onTransit,
        isRound: false
      )
    }
    guard let line = subwayLines[trimmed] else {
      return CommuteBadgeStyle(
        label: label,
        background: CommuteColors.bgControl.color(scheme),
        foreground: CommuteColors.textPrimary.color(scheme),
        isRound: false
      )
    }
    return CommuteBadgeStyle(
      label: line.label,
      background: Color(commuteHex: line.color),
      foreground: line.darkText ? CommuteColors.textOnAccent.color(scheme) : CommuteColors.onTransit,
      isRound: line.label.count == 1
    )
  }
}

/// `BusBadge`·`LineBadge`(22pt, `.regular`)와 `LegBadge · S`(16pt, `.small`).
struct CommuteLineBadge: View {
  enum Size {
    case regular
    case small
  }

  let lineName: String
  let mode: String
  let size: Size
  let scheme: ColorScheme

  private var height: CGFloat { size == .regular ? 22 : 16 }

  var body: some View {
    let style = CommuteBadges.style(lineName: lineName, mode: mode, scheme: scheme)
    if mode == "subway" {
      label(style, text: size == .regular ? .lineBadge : .micro)
        .padding(.horizontal, style.isRound ? 0 : (size == .regular ? 8 : 6))
        .frame(minWidth: height)
        .frame(height: height)
        .background(Capsule().fill(style.background))
    } else {
      label(style, text: size == .regular ? .busBadge : .micro)
        .padding(.horizontal, size == .regular ? 7 : 6)
        .frame(minWidth: size == .regular ? 40 : nil)
        .frame(height: height)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(style.background))
    }
  }

  private func label(_ style: CommuteBadgeStyle, text: CommuteTextStyle) -> some View {
    Text(verbatim: style.label)
      .commuteStyle(text, color: style.foreground)
      .lineLimit(1)
      .fixedSize()
  }
}

// MARK: - 조각

/// 한 줄 문구에서 정류장 이름만 말줄임한다. 나머지("· 08:12 도착")는 잘리지 않는다.
/// 정류장 이름을 문구에서 찾지 못하면 줄 끝을 말줄임한다.
struct CommuteStopText: View {
  let text: String
  let stopName: String
  let style: CommuteTextStyle
  let color: Color

  var body: some View {
    if !stopName.isEmpty, let range = text.range(of: stopName) {
      HStack(spacing: 0) {
        piece(String(text[..<range.lowerBound])).fixedSize().layoutPriority(1)
        piece(stopName).truncationMode(.tail)
        piece(String(text[range.upperBound...])).fixedSize().layoutPriority(1)
      }
    } else {
      piece(text).truncationMode(.tail)
    }
  }

  private func piece(_ value: String) -> some View {
    Text(verbatim: value).commuteStyle(style, color: color).lineLimit(1)
  }
}

/// `StatusTag`(4:60): 6pt 점과 Caption 글자.
struct CommuteStatusTag: View {
  let tag: String
  let label: String
  let scheme: ColorScheme

  private var color: Color {
    switch tag {
    case "delayed": CommuteColors.statusDelayed.color(scheme)
    case "estimated": CommuteColors.statusEstimated.color(scheme)
    default: CommuteColors.statusLive.color(scheme)
    }
  }

  var body: some View {
    HStack(spacing: CommuteLayout.statusGap) {
      Circle().fill(color).frame(width: CommuteLayout.statusDot, height: CommuteLayout.statusDot)
      Text(verbatim: label).commuteStyle(.caption, color: color).lineLimit(1).fixedSize()
    }
  }
}

/// 배지 + 상태 문장(Title/1). 상태 문장은 줄바꿈하지 않는다.
struct CommuteTitleRow: View {
  let model: CommuteLockModel
  let stopName: String
  let gap: CGFloat
  let scheme: ColorScheme

  var body: some View {
    HStack(spacing: gap) {
      CommuteLineBadge(lineName: model.lineName, mode: model.mode, size: .regular, scheme: scheme)
      CommuteStopText(
        text: model.status,
        stopName: stopName,
        style: .title1,
        color: CommuteColors.textPrimary.color(scheme)
      )
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.updatesFrequently)
    }
    .frame(height: CommuteLayout.titleHeight)
  }
}

/// 남은 분(Title/3) + 상세(Body/M).
struct CommuteDetailRow: View {
  let model: CommuteLockModel
  let stopName: String
  let scheme: ColorScheme

  var body: some View {
    HStack(spacing: CommuteLayout.detailGap) {
      if let minutes = model.minutes {
        Text(verbatim: minutes)
          .commuteStyle(.title3, color: CommuteColors.textPrimary.color(scheme))
          .lineLimit(1)
          .fixedSize()
      }
      CommuteStopText(
        text: model.detail,
        stopName: stopName,
        style: .bodyM,
        color: CommuteColors.textSecondary.color(scheme)
      )
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(height: CommuteLayout.detailHeight)
  }
}

/// `NextLegRow`(114:1599): `LegBadge · S` + 승차 정류장과 시각. `more`가 있으면 줄 끝에 "외 N구간".
struct CommuteNextLegRow: View {
  let leg: CommuteLockNextLeg
  let stopName: String
  let more: String?
  let scheme: ColorScheme

  var body: some View {
    HStack(spacing: CommuteLayout.nextLegBadgeGap) {
      CommuteLineBadge(lineName: leg.lineName, mode: leg.mode, size: .small, scheme: scheme)
      CommuteStopText(
        text: leg.text,
        stopName: stopName,
        style: .labelM,
        color: CommuteColors.textSecondary.color(scheme)
      )
      .frame(maxWidth: .infinity, alignment: .leading)
      if let more {
        Text(verbatim: more)
          .commuteStyle(.labelM, color: CommuteColors.textTertiary.color(scheme))
          .lineLimit(1)
          .fixedSize()
          .layoutPriority(2)
      }
    }
    .frame(height: CommuteLayout.nextLegHeight)
  }
}

// MARK: - 잠금화면 카드

/// Figma `LiveActivity`(87:2420). 머리줄 → 지금 구간(배지·상태, 남은 분·상세) → 남은 구간 최대 2줄,
/// 제안이 있으면 남은 구간 줄 자리에 제안 줄. 모든 경우 160pt 이하
/// (16 + 16 + 4 + 56 + 8 + 20 + 4 + 20 + 16 = 160, 제안은 16 + 16 + 4 + 56 + 8 + 36 + 16 = 152).
struct CommuteLockScreenView: View {
  let model: CommuteLockModel
  let state: CommuteActivityAttributes.ContentState

  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: CommuteLayout.cardGap) {
      header
      VStack(alignment: .leading, spacing: CommuteLayout.bodyGap) {
        VStack(alignment: .leading, spacing: 0) {
          CommuteTitleRow(model: model, stopName: state.stopName, gap: CommuteLayout.titleGap, scheme: scheme)
          CommuteDetailRow(model: model, stopName: state.stopName, scheme: scheme)
        }
        if let suggestion = model.suggestion {
          suggestionRow(suggestion)
        } else if !model.nextLegs.isEmpty {
          nextLegRows
        }
      }
    }
    .padding(CommuteLayout.cardPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .activityBackgroundTint(CommuteColors.bgSurfaceRaised.color(scheme))
    .activitySystemActionForegroundColor(CommuteColors.textPrimary.color(scheme))
  }

  private var header: some View {
    HStack(spacing: CommuteLayout.headerGap) {
      Image("IconRoute")
        .renderingMode(.template)
        .resizable()
        .frame(width: CommuteLayout.headerIcon, height: CommuteLayout.headerIcon)
        .foregroundColor(CommuteColors.iconSecondary.color(scheme))
      Text(verbatim: model.header)
        .commuteStyle(.caption, color: CommuteColors.textSecondary.color(scheme))
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 0)
      CommuteStatusTag(tag: model.tag, label: model.tagLabel, scheme: scheme)
    }
    .frame(height: CommuteLayout.headerHeight)
  }

  private var nextLegRows: some View {
    let stops = (state.nextLegs ?? []).map(\.stopName)
    let lastIndex = model.nextLegs.count - 1
    return VStack(alignment: .leading, spacing: CommuteLayout.nextLegGap) {
      ForEach(Array(model.nextLegs.enumerated()), id: \.offset) { index, leg in
        CommuteNextLegRow(
          leg: leg,
          stopName: index < stops.count ? stops[index] : "",
          more: index == lastIndex ? model.moreLegs : nil,
          scheme: scheme
        )
      }
    }
  }

  /// Figma `Suggestion`(123:2861): 36pt 상자, 화살표 아이콘 + Label/S 한 줄.
  private func suggestionRow(_ suggestion: String) -> some View {
    HStack(spacing: CommuteLayout.suggestionGap) {
      Image("IconArrowRightLeft")
        .renderingMode(.template)
        .resizable()
        .frame(width: CommuteLayout.suggestionIcon, height: CommuteLayout.suggestionIcon)
        .foregroundColor(CommuteColors.iconPrimary.color(scheme))
      Text(verbatim: suggestion)
        .commuteStyle(.labelS, color: CommuteColors.textPrimary.color(scheme))
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, CommuteLayout.suggestionPaddingX)
    .padding(.vertical, CommuteLayout.suggestionPaddingY)
    .frame(height: CommuteLayout.suggestionHeight)
    .background(
      RoundedRectangle(cornerRadius: CommuteLayout.suggestionRadius, style: .continuous)
        .fill(CommuteColors.bgControl.color(scheme))
    )
  }
}

// MARK: - 다이내믹 아일랜드

/// Figma `iOS / 19 Dynamic Island`(49:18907). 아일랜드 바탕은 늘 검정이라 다크 값을 쓴다.
@MainActor
enum CommuteIsland {
  static let scheme = ColorScheme.dark

  /// Expanded 윗줄: 배지 + 상태 문장. 카메라 옆에 들어가지 않으면 그 아래로 내려간다.
  static func expandedTop(model: CommuteLockModel, state: CommuteActivityAttributes.ContentState) -> some View {
    CommuteTitleRow(model: model, stopName: state.stopName, gap: CommuteLayout.islandTitleGap, scheme: scheme)
      .dynamicIsland(verticalPlacement: .belowIfTooWide)
  }

  /// Expanded 아랫줄: 남은 분·상세, 남은 구간 첫 줄.
  static func expandedBottom(model: CommuteLockModel, state: CommuteActivityAttributes.ContentState) -> some View {
    VStack(alignment: .leading, spacing: CommuteLayout.islandGap) {
      CommuteDetailRow(model: model, stopName: state.stopName, scheme: scheme)
      if let leg = model.nextLegs.first {
        CommuteNextLegRow(
          leg: leg,
          stopName: state.nextLegs?.first?.stopName ?? "",
          more: nil,
          scheme: scheme
        )
      }
    }
  }

  static func compactLeading(model: CommuteLockModel) -> some View {
    CommuteLineBadge(lineName: model.lineName, mode: model.mode, size: .regular, scheme: scheme)
  }

  @ViewBuilder
  static func compactTrailing(model: CommuteLockModel) -> some View {
    if let minutes = model.minutes {
      Text(verbatim: minutes)
        .commuteStyle(.labelM, color: CommuteColors.textPrimary.color(scheme))
        .lineLimit(1)
        .fixedSize()
    }
  }

  /// Minimal: 수단 아이콘(`Icon/bus-front` 3:67, `Icon/train-front` 3:56), `text/accent` 색.
  static func minimal(model: CommuteLockModel) -> some View {
    Image(model.mode == "subway" ? "IconTrainFront" : "IconBusFront")
      .renderingMode(.template)
      .resizable()
      .frame(width: CommuteLayout.islandMinimalIcon, height: CommuteLayout.islandMinimalIcon)
      .foregroundColor(CommuteColors.textAccent.color(scheme))
  }
}
