# CI와 저장소 보안 설정

## 지금 켜져 있는 것

| 항목 | 위치 | 내용 |
|---|---|---|
| CI | `.github/workflows/ci.yml` | `develop`·`main` 대상 PR과 push에서 실행. 린트(PR에서 바뀐 파일만) → 타입 체크 → 테스트 + 커버리지(lcov). 커버리지는 `coverage-lcov` 아티팩트로 14일 보관 |
| 브랜치 보호 | GitHub 설정 (`develop`, `main`) | PR로만 머지, `Lint, types, tests` 체크 통과 필수, force push·삭제 금지. 관리자는 급할 때 우회할 수 있다 |
| CodeQL | GitHub 기본 설정(default setup) | JavaScript/TypeScript 보안 분석. PR과 기본 브랜치 push, 매주 실행. 워크플로우 파일이 `main`에 들어간 뒤 저장소 설정에서 `Actions` 언어도 추가한다(그 전에는 API가 "언어가 없다"며 거부한다) |
| Dependabot | `.github/dependabot.yml` + 저장소 설정 | 취약점 알림과 보안 업데이트 PR. Bun 의존성은 매주 월요일(minor·patch는 PR 하나로 묶음), Actions는 매월. 대상 브랜치는 `develop` |
| Secret scanning | 저장소 설정 | 커밋된 키 탐지와 push protection(키가 든 push를 막음) |

### 린트를 바뀐 파일에만 거는 이유

처음 프로젝트를 만들 때 들어온 코드(`packages/ui`, `apps/web`, `apps/server`)와 `.claude/skills`에 Ultracite 위반이 남아 있다(2026-11-09 기준 약 415개). 전체를 검사하면 CI가 바로 실패하므로, PR이 건드린 파일만 검사한다. 파일을 고칠 때마다 그 파일이 규칙을 지키게 되어 점점 줄어든다. 한 번에 정리하려면 `bun run fix`로 자동 수정한 뒤 남은 것만 손으로 고치고, CI의 `--changed --since=...`를 빼면 된다.

### 체크 이름을 바꿀 때

브랜치 보호가 `Lint, types, tests`라는 이름으로 체크를 요구한다. `ci.yml`의 job `name`을 바꾸면 브랜치 보호의 필수 체크 이름도 같이 바꿔야 한다. 안 그러면 PR이 체크를 영원히 기다린다.

## Windows에서 로컬 테스트가 2개 실패하는 문제

`bun test`를 Windows에서 돌리면 아래 두 테스트가 실패한다. CI(Linux)에서는 통과한다.

- `renderThemeCss > matches the committed generated file`: `core.autocrlf=true`로 체크아웃된 CRLF 파일과 비교해서 생긴다.
- `screens and components contain no hard-coded Korean copy`: 제외 정규식이 `/` 경로만 보는데 Windows glob은 `\`를 돌려준다.

## SonarQube Cloud

### 지금 상태 (2026-11-09)

SonarQube Cloud가 **Automatic Analysis**로 연결돼 있다(조직 `cmu02`, 프로젝트 `CMU02_Betro`, 공개). PR마다 `SonarCloud Code Analysis` 체크가 붙고, `develop` 대상 PR도 분석된다. 브랜치 보호의 필수 체크는 아니라서 실패해도 머지는 막히지 않는다.

Automatic Analysis는 SonarCloud가 코드를 직접 가져가 분석하므로 **테스트 커버리지가 없다**. 커버리지까지 보려면 아래 절차로 CI 분석으로 바꾼다.

### 다음 단계: CI 분석으로 바꾸기

협업자가 생기거나 커버리지·복잡도를 수치로 관리하고 싶어지면 바꾼다. CI가 이미 `coverage/lcov.info`를 만들고 히스토리 전체를 체크아웃하므로 아래만 하면 된다.

1. SonarQube Cloud 프로젝트 설정 › Analysis Method에서 **Automatic Analysis를 끈다**. CI 분석과 같이 켜 둘 수 없다.
2. 분석 방식으로 **GitHub Actions**를 고른다.
3. 조직 키 `cmu02`와 프로젝트 키 `CMU02_Betro`가 화면과 같은지 확인한다.
4. 토큰을 만들어 저장소 시크릿으로 넣는다. 값이 화면이나 셸 기록에 남지 않도록 입력 프롬프트를 쓴다.

   ```sh
   gh secret set SONAR_TOKEN
   ```

5. 저장소 루트에 `sonar-project.properties`를 만든다.

   ```properties
   sonar.organization=cmu02
   sonar.projectKey=CMU02_Betro
   sonar.projectName=Betro
   sonar.sourceEncoding=UTF-8

   sonar.sources=apps,packages
   sonar.tests=apps,packages
   sonar.test.inclusions=**/*.test.ts,**/*.test.tsx
   sonar.exclusions=**/node_modules/**,**/*.test.ts,**/*.test.tsx,**/dist/**,**/.next/**,**/.expo/**,**/.turbo/**,apps/native/ios/**,apps/native/android/**,**/*.generated.*,**/*-env.d.ts,**/env.d.ts,packages/db/src/migrations/**

   sonar.javascript.lcov.reportPaths=coverage/lcov.info
   ```

6. `ci.yml`의 `verify` job에 `env`와 마지막 단계를 추가한다. 시크릿이 없으면(포크 PR 등) 건너뛴다. 버전은 추가할 때 [릴리스 목록](https://github.com/SonarSource/sonarqube-scan-action/releases)에서 다시 확인하고 커밋 SHA로 고정한다.

   ```yaml
   jobs:
     verify:
       env:
         SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
       steps:
         # ... 기존 단계 ...
         - name: SonarQube Cloud scan
           if: env.SONAR_TOKEN != ''
           uses: SonarSource/sonarqube-scan-action@e805d875275f728fac1885b413934be6d7c63f65 # v8.4.1
   ```

7. Sonar 품질 게이트를 머지 조건으로 쓰려면 브랜치 보호의 필수 체크에 `SonarCloud Code Analysis`를 추가한다.

## 다음 단계: 앱 빌드

네이티브 빌드는 이 CI에 넣지 않는다. 빌드 시간이 길고 서명 키가 필요하므로 EAS Workflows(`.eas/workflows/`)로 따로 만든다.
