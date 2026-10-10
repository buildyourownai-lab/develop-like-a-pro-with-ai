# 8장 · Vercel 계정 연결과 프로젝트 가져오기

책의 상세 지원 자료입니다. 책에 없는 추가 안내는 필요할 때만 사용합니다. 화면과 정책의 과거 확인 기록은 현재 지원·요금·실행 성공을 보증하지 않습니다. 현재 계정의 공식 안내를 함께 확인하세요.

## Vercel과 GitHub를 연결합니다

Vercel을 처음 사용한다면 계정을 만들고 로그인합니다.

개인용 **Hobby**는 무료이며, 이 책의 실습은 무료로 제공되는 사용량 안에서
끝납니다. 2026년 8월 확인 시점에 Hobby 가입과 배포에는 카드 정보가 필요하지
않았고, 카드는 유료 Pro로 올릴 때 입력하게 되어 있었습니다.

한 가지는 미리 알아두는 편이 좋습니다. Hobby는 개인·비상업 용도로 제한됩니다.
이 책의 실습은 Hobby에서 모두 할 수 있습니다. 만든 서비스로 수익을 내기로
결정한다면 그때 유료 요금제로 올립니다.

요금 정책은 바뀔 수 있습니다. 가입 화면이 결제 정보를 요구한다면 그 단계에서
멈추고 무엇을 요구하는지 확인합니다. 공식 안내는 다음 주소에 있습니다.

~~~url
https://vercel.com/docs/plans/hobby
~~~

저장소를 가져오는 화면에서 GitHub 계정을 고릅니다. Vercel에 GitHub 계정으로 가입했다면 해당 계정이 이미 목록에 있습니다. 계정이 없거나 다른 계정의 저장소가 필요하면 **Add GitHub Scope**로 추가합니다.

GitHub에서 Vercel이 어떤 저장소에 접근할 수 있게 할지 선택하는 화면이
나타날 수 있습니다.

모든 저장소에 접근 권한을 줄 필요는 없습니다. 이번에 필요한 것은
`apartment-explorer` 하나이므로, 가능하다면 **그 저장소만 선택해 접근을
허용**합니다.

![모든 저장소 대신 선택한 저장소에만 허용한 Vercel GitHub 접근 권한](https://www.studyailab.com/develop/guides/chapter-08/02-vercel-github-repository-permission.png)

[화면 8-4 | GitHub 계정을 연결한 뒤 모든 저장소가 아니라 필요한 저장소만 선택해 `apartment-explorer` 접근을 허용한 화면]

그림의 저자 계정에는 다른 실습 저장소도 함께 연결되어 있습니다. 독자는
자신이 만든 `apartment-explorer`만 선택하면 됩니다.

> [!원칙]
> **필요한 권한만 줍니다.**

---

## `apartment-explorer`를 Vercel로 가져옵니다

Vercel에서 새 프로젝트를 추가합니다.

GitHub 저장소 목록에서 `apartment-explorer`를 찾아 **Import**합니다.

![Vercel에서 apartment-explorer 가져오기](https://www.studyailab.com/develop/guides/chapter-08/03-vercel-import-apartment-explorer.png)

[화면 8-5 | Vercel에서 GitHub의 apartment-explorer 저장소를 찾아
Import하는 화면]

Vercel이 Next.js 프로젝트를 인식합니다. 하지만 배포 전에 국토교통부와
Kakao API에 필요한 Secret을 등록해야 합니다.

---
